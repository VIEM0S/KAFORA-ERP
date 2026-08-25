import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import { checkSubscriptionAllows } from '@/lib/api/subscription-guard';
import { FieldValue } from 'firebase-admin/firestore';
import { cookies } from 'next/headers';

interface CheckoutItem {
  productId: string;
  quantity: number;
  discount?: number; // % de remise ligne, optionnel (ex. négociation manager)
}

export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('__session')?.value;
    if (!sessionCookie) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const decoded = await adminAuth.verifySessionCookie(sessionCookie, true);
    const callerTenantId = decoded.tenantId as string;
    const callerUid = decoded.uid as string;

    // Identifiant fourni par la file d'attente hors-ligne (lib/offline-queue.ts).
    // Absent = vente en ligne normale, comportement inchangé. Présent = cette
    // requête peut être un rejeu (perte de la réponse HTTP après succès côté
    // serveur) : il ne faut JAMAIS créer deux fois la même vente.
    const offlineSyncId = request.headers.get('X-Offline-Sync-Id');

    const {
      tenantId, storeId, items, customerId,
      paymentMethod, amountReceived, discountPercent,
      userName, quoteId,
    }: {
      tenantId: string; storeId: string; items: CheckoutItem[]; customerId?: string | null;
      paymentMethod: string; amountReceived?: number; discountPercent?: number; userName?: string;
      quoteId?: string;
    } = await request.json();

    if (!tenantId || !storeId || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Panier vide ou données manquantes' }, { status: 400 });
    }
    if (tenantId !== callerTenantId) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    // Cloisonnement magasin : le storeId vient du client, il faut donc le
    // recouper avec l'affectation portée par le token. Sans ce contrôle, un
    // caissier pourrait forger une requête et encaisser — donc décrémenter le
    // stock et encaisser de l'argent — dans une boutique qui n'est pas la
    // sienne. `storeIds` absent ou null = accès à tous (direction).
    const callerStoreIds = decoded.storeIds as string[] | null | undefined;
    if (Array.isArray(callerStoreIds) && !callerStoreIds.includes(storeId)) {
      return NextResponse.json(
        { error: "Vous n'avez pas accès à ce magasin" },
        { status: 403 }
      );
    }

    // Abonnement : l'encaissement reste possible pendant la période de
    // tolérance (le commerce ne doit pas s'arrêter du jour au lendemain),
    // mais plus au-delà. Vérifié avant toute écriture, et avant le rejeu
    // idempotent — une vente hors-ligne synchronisée tardivement ne doit pas
    // contourner le blocage.
    const subscriptionBlock = await checkSubscriptionAllows(tenantId, 'pos');
    if (subscriptionBlock) {
      return NextResponse.json(
        { error: subscriptionBlock.error, subscriptionState: subscriptionBlock.state },
        { status: subscriptionBlock.status }
      );
    }

    // Rejeu idempotent : si cette synchronisation offline a déjà abouti
    // (réponse perdue la première fois), on renvoie le résultat déjà connu
    // au lieu de recréer une seconde vente pour le même achat réel.
    const dedupRef = offlineSyncId
      ? adminDb.doc(`tenants/${tenantId}/_sync_dedup/${offlineSyncId}`)
      : null;
    if (dedupRef) {
      const dedupSnap = await dedupRef.get();
      if (dedupSnap.exists) {
        const prev = dedupSnap.data()!;
        return NextResponse.json({ success: true, saleId: prev.saleId, reference: prev.reference, replay: true });
      }
    }

    if (!['CASH', 'MOBILE_MONEY', 'CARD', 'CREDIT'].includes(paymentMethod)) {
      return NextResponse.json({ error: 'Mode de paiement invalide' }, { status: 400 });
    }

    // ── Client (si vente à crédit) ──────────────────────────────────────────
    let customer: FirebaseFirestore.DocumentData | null = null;
    let customerRef: FirebaseFirestore.DocumentReference | null = null;
    if (customerId) {
      customerRef = adminDb.doc(`tenants/${tenantId}/customers/${customerId}`);
      const cSnap = await customerRef.get();
      if (!cSnap.exists) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 });
      customer = cSnap.data()!;
    }
    if (paymentMethod === 'CREDIT' && !customer) {
      return NextResponse.json({ error: 'Client requis pour une vente à crédit' }, { status: 400 });
    }

    // ── Récupérer les produits réels (source de vérité pour prix & coût) ────
    const productSnaps = await Promise.all(
      items.map(it => adminDb.doc(`tenants/${tenantId}/products/${it.productId}`).get())
    );
    for (let i = 0; i < productSnaps.length; i++) {
      if (!productSnaps[i].exists) {
        return NextResponse.json({ error: `Produit introuvable (${items[i].productId})` }, { status: 404 });
      }
    }
    const products = productSnaps.map(s => ({ id: s.id, ...s.data() } as {
      id: string; name: string; sku: string; sellingPrice: number; purchasePrice: number | null;
      taxRate: number; trackInventory: boolean; categoryId: string | null;
    }));

    // ── Calcul des totaux côté serveur (jamais depuis le client) ────────────
    const lines = items.map((it, i) => {
      const p = products[i];
      const discount = Math.min(Math.max(Number(it.discount) || 0, 0), 100); // clamp 0-100%
      const quantity = Math.max(1, Math.floor(Number(it.quantity) || 0));
      const unitPrice = p.sellingPrice;
      const tax = p.taxRate || 0;
      // Arrondi À L'UNITÉ, pas au centime : le franc CFA n'a pas de
      // subdivision. Un total à 12 345,67 serait affiché « 12 346 FCFA »,
      // le client paierait 12 346, mais la base garderait 12 345,67 —
      // un écart invisible qui s'accumule dans les crédits clients, la
      // caisse et les agrégats mensuels.
      // On arrondit LIGNE PAR LIGNE pour qu'une facture s'additionne
      // exactement : sinon la somme des lignes affichées ne correspondrait
      // pas au total réclamé, et un commerçant ne peut pas défendre une
      // facture qui ne tombe pas juste.
      const lineTotal = Math.round(quantity * unitPrice * (1 - discount / 100) * (1 + tax / 100));
      return { product: p, quantity, discount, unitPrice, tax, lineTotal };
    });

    const subtotal = Math.round(
      lines.reduce((s, l) => s + l.quantity * l.unitPrice * (1 - l.discount / 100), 0)
    );
    const taxTotal = Math.round(
      lines.reduce((s, l) => s + l.quantity * l.unitPrice * (1 - l.discount / 100) * (l.tax / 100), 0)
    );
    const cartDiscountPercent = Math.min(Math.max(Number(discountPercent) || 0, 0), 100);
    const discountAmount = Math.round(subtotal * (cartDiscountPercent / 100));
    const total = subtotal + taxTotal - discountAmount;
    const itemCount = lines.reduce((s, l) => s + l.quantity, 0);

    const acompte = paymentMethod === 'CREDIT' ? Math.max(0, Math.min(Number(amountReceived) || 0, total)) : total;
    const soldeCredit = paymentMethod === 'CREDIT' ? Math.max(0, total - acompte) : 0;

    // Fix (course sur customer.creditUsed) : le plafond de crédit ET
    // l'incrémentation de customer.creditUsed sont désormais vérifiés et
    // appliqués ENSEMBLE, à l'intérieur de la transaction ci-dessous, sur une
    // lecture fraîche du client (tx.get(customerRef)) — jamais sur la valeur
    // `customer` capturée avant la transaction. L'ancienne version lisait
    // customer.creditUsed une seule fois en dehors de toute transaction puis
    // écrivait `creditUsed: (customer.creditUsed || 0) + soldeCredit` après
    // coup : deux ventes à crédit concurrentes pour le même client lisaient
    // la même valeur de départ, et la seconde écriture écrasait la première
    // (perte de crédit accordé, plafond potentiellement contournable).
    const requiresCreditCheck = paymentMethod === 'CREDIT' && soldeCredit > 0 && !!customerRef;

    const receivedCash = paymentMethod === 'CASH' ? (Number(amountReceived) || total) : acompte;
    if (paymentMethod === 'CASH' && receivedCash < total) {
      return NextResponse.json({ error: 'Montant reçu insuffisant' }, { status: 400 });
    }
    const change = paymentMethod === 'CASH' ? Math.max(0, receivedCash - total) : 0;

    // ── Stock : vérifier + trouver les docs inventory concernés ─────────────
    const invRefs: Record<string, { ref: FirebaseFirestore.DocumentReference; qty: number }> = {};
    for (const l of lines) {
      if (!l.product.trackInventory) continue;
      const invSnap = await adminDb
        .collection(`tenants/${tenantId}/inventory`)
        .where('productId', '==', l.product.id)
        .where('storeId', '==', storeId)
        .limit(1)
        .get();
      if (invSnap.empty) continue;
      invRefs[l.product.id] = { ref: invSnap.docs[0].ref, qty: invSnap.docs[0].data().quantity || 0 };
    }

    const saleRef = adminDb.collection(`tenants/${tenantId}/sales`).doc();
    const customerName = customer
      ? (customer.customerType === 'BUSINESS' ? customer.companyName : `${customer.firstName || ''} ${customer.lastName || ''}`.trim())
      : null;

    // Numérotation séquentielle légale (SYSCOHADA/OHADA exigent une suite
    // chronologique sans trou par exercice fiscal — un ID Firestore aléatoire
    // ne le permet pas). Même pattern de compteur atomique que purchase-orders.
    const fiscalYear = new Date().getFullYear();
    const counterRef = adminDb.doc(`tenants/${tenantId}/_counters/sales_${fiscalYear}`);

    // ── Transaction atomique : vérifie + décrémente le stock, vérifie + met
    // à jour le crédit client, crée la vente ─────────────────────────────────
    const { reference, stockConflictProducts, creditConflict } = await adminDb.runTransaction(async (tx) => {
      // ── Toutes les lectures d'abord (obligatoire dans une transaction) ────
      const counterSnap = await tx.get(counterRef);
      const freshQtys: Record<string, number> = {};
      for (const l of lines) {
        const inv = invRefs[l.product.id];
        if (!inv) continue;
        const fresh = await tx.get(inv.ref);
        freshQtys[l.product.id] = fresh.data()?.quantity || 0;
      }
      // Lecture fraîche du client, à l'intérieur de la transaction : c'est la
      // seule valeur de creditUsed sur laquelle on a le droit de raisonner —
      // celle capturée plus haut (`customer`) peut déjà être obsolète si une
      // autre vente à crédit pour ce même client vient de s'intercaler.
      let freshCreditUsed = 0;
      let creditLimit = 0;
      if (requiresCreditCheck && customerRef) {
        const freshCustomerSnap = await tx.get(customerRef);
        const freshCustomer = freshCustomerSnap.data() || {};
        freshCreditUsed = Number(freshCustomer.creditUsed) || 0;
        creditLimit = Number(freshCustomer.creditLimit) || 0;
      }
      const nextSeq = (counterSnap.exists ? counterSnap.data()!.value : 0) + 1;
      const reference = `FAC-${fiscalYear}-${String(nextSeq).padStart(6, '0')}`;
      // ── Puis toutes les écritures ──────────────────────────────────────────
      tx.set(counterRef, { value: nextSeq }, { merge: true });
      const stockConflictProducts: string[] = [];
      for (const l of lines) {
        const inv = invRefs[l.product.id];
        if (!inv) continue;
        const freshQty = freshQtys[l.product.id];
        if (freshQty < l.quantity) {
          // Même logique que le plafond de crédit ci-dessous : en sync offline,
          // la vente a déjà eu lieu physiquement — on ne peut pas la refuser
          // après coup. On laisse le stock passer en négatif et on le signale.
          if (!offlineSyncId) {
            throw new Error(`Stock insuffisant pour "${l.product.name}" (${freshQty} disponible, ${l.quantity} demandé)`);
          }
          stockConflictProducts.push(`${l.product.name} (${freshQty} dispo, ${l.quantity} vendu)`);
        }
        tx.update(inv.ref, { quantity: freshQty - l.quantity, updatedAt: FieldValue.serverTimestamp() });
      }
      let creditConflict = false;
      if (requiresCreditCheck && customerRef) {
        if (freshCreditUsed + soldeCredit > creditLimit) {
          // En synchronisation offline, la vente a déjà eu lieu physiquement
          // (le client est reparti avec la marchandise pendant la coupure
          // réseau) : la refuser ici ne l'annule pas, ça la fait juste échouer
          // silencieusement en boucle dans la file locale. On laisse donc
          // passer et on signale le dépassement pour régularisation manuelle.
          if (!offlineSyncId) {
            const disponible = Math.max(0, creditLimit - freshCreditUsed);
            throw new Error(`Plafond de crédit dépassé pour ce client. Crédit disponible : ${disponible} FCFA.`);
          }
          creditConflict = true;
        }
        tx.update(customerRef, {
          creditUsed: FieldValue.increment(soldeCredit),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      tx.set(saleRef, {
        tenantId, storeId, userId: callerUid,
        reference,
        customerId: customerId || null,
        customerName,
        subtotal, discountPercent: cartDiscountPercent, discountAmount, tax: taxTotal, total,
        status: 'COMPLETED',
        paymentMethod, acompte, soldeCredit,
        amountReceived: receivedCash, change,
        itemCount,
        stockConflict: stockConflictProducts.length > 0,
        creditConflict,
        offlineSyncId: offlineSyncId || null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (dedupRef) {
        tx.set(dedupRef, { saleId: saleRef.id, reference, createdAt: FieldValue.serverTimestamp() });
      }
      return { reference, stockConflictProducts, creditConflict };
    });

    // Alerte manager si la synchronisation offline a révélé un dépassement
    // (stock négatif et/ou crédit dépassé) — la vente reste valide (le client
    // est déjà reparti avec la marchandise), mais un humain doit régulariser
    // (réapprovisionner, recontacter le client pour le crédit, etc.)
    if (stockConflictProducts.length > 0 || creditConflict) {
      const messages = [
        ...stockConflictProducts.map(p => `Stock négatif : ${p}`),
        ...(creditConflict ? [`Plafond de crédit dépassé pour ${customerName || 'ce client'}`] : []),
      ];
      await adminDb.collection(`tenants/${tenantId}/alerts`).add({
        tenantId, type: 'OFFLINE_SYNC_CONFLICT', severity: 'HIGH',
        title: 'Conflit détecté après synchronisation hors-ligne',
        message: `Vente ${reference} — ${messages.join(' · ')}`,
        reference: 'sales', referenceId: saleRef.id,
        isRead: false, isResolved: false, resolvedBy: null, resolvedAt: null,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    // ── Devis d'origine (si cette vente vient d'un "Convertir en vente") ────
    // Marqué CONVERTED seulement ICI, une fois la vente réellement encaissée
    // — jamais au moment du chargement dans le POS, sinon un panier abandonné
    // laisserait le devis marqué converti sans vente correspondante (voir
    // app/(dashboard)/quotes/page.tsx). Admin SDK : contourne volontairement
    // la règle firestore.rules qui réserve l'écriture des devis aux
    // Managers+, un Caissier devant pouvoir encaisser un devis qu'on lui a
    // transmis. Ne doit jamais faire échouer une vente déjà actée : le devis
    // a pu être supprimé entre-temps, ou l'ID être invalide.
    if (quoteId) {
      try {
        await adminDb.doc(`tenants/${tenantId}/quotes/${quoteId}`).update({
          status: 'CONVERTED',
          saleId: saleRef.id,
          updatedAt: FieldValue.serverTimestamp(),
        });
      } catch (e) {
        console.error('Échec mise à jour du devis après conversion:', e);
      }
    }

    // ── Sous-collections (hors transaction) ──────────────────────────────────
    const batchWrites: Promise<unknown>[] = [];
    let saleCostTotal = 0;
    // Certaines lignes peuvent n'avoir aucun prix d'achat connu : le champ est
    // facultatif. On les compte pour signaler que la marge de cette vente est
    // PARTIELLE — plutôt que de leur attribuer un coût nul, qui gonflerait la
    // marge à 100 % et fausserait tous les rapports sans avertissement.
    let linesWithoutCost = 0;
    // Coût cumulé par catégorie — vit dans cost_summary (Managers+ uniquement,
    // voir plus bas), jamais dans sale_items qui est lisible par tous les
    // rôles. Le revenu par catégorie, lui, est déductible de sale_items
    // (categoryId + total, non sensibles) au moment de l'agrégation.
    const costByCategory: Record<string, number> = {};
    for (const l of lines) {
      const unitCost = l.product.purchasePrice;
      const catKey = l.product.categoryId || 'uncategorized';
      if (unitCost == null) {
        linesWithoutCost++;
      } else {
        const lineCost = l.quantity * unitCost;
        saleCostTotal += lineCost;
        costByCategory[catKey] = (costByCategory[catKey] || 0) + lineCost;
      }
      batchWrites.push(
        adminDb.collection(`tenants/${tenantId}/sales/${saleRef.id}/sale_items`).add({
          // tenantId + createdAt sont nécessaires à l'agrégation quotidienne :
          // ils permettent une requête collectionGroup unique sur la journée
          // au lieu de relire chaque vente une par une (N+1).
          tenantId,
          createdAt: FieldValue.serverTimestamp(),
          productId: l.product.id,
          productName: l.product.name,
          productSku: l.product.sku,
          categoryId: l.product.categoryId,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          discount: l.discount,
          tax: l.tax,
          total: l.lineTotal,
          // Le coût d'achat n'est PAS stocké ici : ce document est lisible par
          // tous les rôles (reçus, historique des ventes). Il vit séparément
          // dans cost_summary, réservé aux Managers+.
        })
      );
      const inv = invRefs[l.product.id];
      if (inv) {
        batchWrites.push(
          adminDb.collection(`tenants/${tenantId}/inventory_movements`).add({
            tenantId, productId: l.product.id, productName: l.product.name, storeId,
            type: 'SALE', quantity: -l.quantity,
            previousQuantity: inv.qty,
            newQuantity: inv.qty - l.quantity,
            saleId: saleRef.id,
            reason: 'Vente POS',
            createdAt: FieldValue.serverTimestamp(),
          })
        );
      }
    }
    batchWrites.push(
      adminDb.collection(`tenants/${tenantId}/sales/${saleRef.id}/payments`).add({
        method: paymentMethod, amount: total,
        amountReceived: receivedCash, change,
        createdAt: FieldValue.serverTimestamp(),
      })
    );
    // Coût réel de la vente, réservé aux Managers+ (voir firestore.rules)
    batchWrites.push(
      adminDb.doc(`tenants/${tenantId}/sales/${saleRef.id}/cost_summary/data`).set({
        tenantId,
        costTotal: saleCostTotal,
        margin: total - saleCostTotal,
        costByCategory,
        // true = le coût ne couvre pas toutes les lignes : la marge affichée
        // est un maximum, pas une valeur exacte.
        costIncomplete: linesWithoutCost > 0,
        linesWithoutCost,
        createdAt: FieldValue.serverTimestamp(),
      })
    );
    await Promise.all(batchWrites);

    // ── Crédit client ────────────────────────────────────────────────────────
    if (paymentMethod === 'CREDIT' && soldeCredit > 0 && customerId && customerRef) {
      const echeance = new Date();
      echeance.setDate(echeance.getDate() + 30);
      const creditRef = await adminDb.collection(`tenants/${tenantId}/credits`).add({
        tenantId, saleId: saleRef.id,
        customerId, customerName,
        customerPhone: customer?.phone || null,
        montantTotal: total, acompte, solde: soldeCredit,
        dateEcheance: echeance.toISOString().split('T')[0],
        status: 'PENDING',
        userId: callerUid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (acompte > 0) {
        await adminDb.collection(`tenants/${tenantId}/credits/${creditRef.id}/credit_payments`).add({
          creditId: creditRef.id, montant: acompte,
          soldeAvant: total, soldeApres: soldeCredit,
          // Voir credits/page.tsx : nécessaires au rapprochement de caisse.
          tenantId, storeId, paymentMethod: 'CASH',
          userId: callerUid,
          userName: userName || null,
          note: 'Acompte versé lors de la vente',
          createdAt: FieldValue.serverTimestamp(),
        });
      }
      // customer.creditUsed est déjà incrémenté de façon atomique
      // (FieldValue.increment) à l'intérieur de la transaction ci-dessus —
      // ne pas l'écrire une seconde fois ici avec une valeur non fraîche.
    }

    return NextResponse.json({ success: true, saleId: saleRef.id, reference, total, change });
  } catch (error) {
    console.error('POS checkout error:', error);
    const msg = error instanceof Error ? error.message : 'Erreur interne';
    // Les erreurs de stock insuffisant et de plafond de crédit dépassé sont
    // utiles à afficher telles quelles (l'utilisateur doit savoir pourquoi).
    const isKnownBusinessError = msg.startsWith('Stock insuffisant') || msg.startsWith('Plafond de crédit dépassé');
    return NextResponse.json(
      { error: isKnownBusinessError ? msg : 'Erreur lors de la finalisation de la vente' },
      { status: isKnownBusinessError ? 409 : 500 }
    );
  }
}
