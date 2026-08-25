import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';
import { cookies } from 'next/headers';

interface ReturnItemInput {
  productId: string;
  quantity: number;
  restock: boolean; // true = article en bon état, remis en stock ; false = défectueux/jeté
}

// Traite un retour client sur une vente déjà finalisée :
//  - recalcule le montant remboursé à partir des VRAIS prix de la vente d'origine
//    (jamais depuis le client, même logique que checkout)
//  - vérifie qu'on ne rembourse pas plus que ce qui a été acheté (returnedQuantity cumulatif)
//  - réintègre le stock uniquement pour les articles marqués "restock"
//  - marque la vente REFUNDED ou PARTIALLY_REFUNDED
//  - Manager+ uniquement (comme l'annulation de vente dans firestore.rules)
export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('__session')?.value;
    if (!sessionCookie) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const decoded = await adminAuth.verifySessionCookie(sessionCookie, true);
    const callerRole = decoded.role as string;
    const callerTenantId = decoded.tenantId as string;
    const callerUid = decoded.uid as string;

    if (!['OWNER', 'ADMIN', 'MANAGER'].includes(callerRole)) {
      return NextResponse.json({ error: 'Accès refusé (Manager+ requis)' }, { status: 403 });
    }

    const {
      tenantId, saleId, items, reason, refundMethod, processedByName,
    }: {
      tenantId: string; saleId: string; items: ReturnItemInput[];
      reason: string; refundMethod: 'CASH' | 'ORIGINAL_PAYMENT_METHOD';
      processedByName?: string;
    } = await request.json();

    if (!tenantId || !saleId || !Array.isArray(items) || items.length === 0 || !reason?.trim()) {
      return NextResponse.json({ error: 'Données manquantes (motif du retour requis)' }, { status: 400 });
    }
    if (tenantId !== callerTenantId) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }
    // « Avoir en magasin » a été retiré : l'option existait, la valeur était
    // enregistrée, et RIEN ne créait d'avoir. Le client repartait persuadé
    // d'avoir un crédit chez le commerçant, sans aucune trace exploitable.
    // Mieux vaut ne pas proposer une fonction que d'en simuler une.
    if (!['CASH', 'ORIGINAL_PAYMENT_METHOD'].includes(refundMethod)) {
      return NextResponse.json({ error: 'Mode de remboursement invalide' }, { status: 400 });
    }

    const saleRef = adminDb.doc(`tenants/${tenantId}/sales/${saleId}`);
    const saleSnap = await saleRef.get();
    if (!saleSnap.exists) return NextResponse.json({ error: 'Vente introuvable' }, { status: 404 });
    const sale = saleSnap.data()!;
    if (!['COMPLETED', 'PARTIALLY_REFUNDED'].includes(sale.status)) {
      return NextResponse.json({ error: `Impossible de retourner une vente ${sale.status}` }, { status: 409 });
    }

    // ── Récupérer les lignes de la vente d'origine (source de vérité prix) ──
    const saleItemsSnap = await adminDb.collection(`tenants/${tenantId}/sales/${saleId}/sale_items`).get();
    const saleItemsByProduct = new Map(saleItemsSnap.docs.map(d => [d.data().productId as string, { ref: d.ref, ...d.data() } as {
      ref: FirebaseFirestore.DocumentReference; productId: string; productName: string;
      quantity: number; unitPrice: number; discount: number; tax: number; returnedQuantity?: number;
    }]));

    const returnLines: Array<{
      productId: string; productName: string; quantity: number; unitPrice: number; total: number; restocked: boolean;
    }> = [];
    let refundAmount = 0;

    for (const it of items) {
      const original = saleItemsByProduct.get(it.productId);
      if (!original) {
        return NextResponse.json({ error: `Produit ${it.productId} absent de la vente d'origine` }, { status: 400 });
      }
      const qty = Math.max(1, Math.floor(Number(it.quantity) || 0));
      const alreadyReturned = original.returnedQuantity || 0;
      const purchasable = original.quantity - alreadyReturned;
      if (qty > purchasable) {
        return NextResponse.json(
          { error: `Quantité à retourner (${qty}) supérieure à la quantité restituable (${purchasable}) pour "${original.productName}"` },
          { status: 400 }
        );
      }
      // Prix unitaire net (remise + taxe déjà appliquées) recalculé à partir de la ligne d'origine
      const netUnitPrice = (original.unitPrice * (1 - (original.discount || 0) / 100)) * (1 + (original.tax || 0) / 100);
      // Arrondi à l'unité : le franc CFA n'a pas de centimes, et un
      // remboursement à décimales ne peut pas être rendu en caisse.
      const lineTotal = Math.round(netUnitPrice * qty);
      refundAmount += lineTotal;
      returnLines.push({
        productId: it.productId, productName: original.productName,
        quantity: qty, unitPrice: original.unitPrice, total: lineTotal,
        restocked: !!it.restock,
      });
    }
    refundAmount = Math.round(refundAmount);

    // ── Trouver les docs inventory pour les articles à réintégrer ────────────
    const invRefs: Record<string, { ref: FirebaseFirestore.DocumentReference }> = {};
    for (const l of returnLines) {
      if (!l.restocked) continue;
      const invSnap = await adminDb
        .collection(`tenants/${tenantId}/inventory`)
        .where('productId', '==', l.productId)
        .where('storeId', '==', sale.storeId)
        .limit(1)
        .get();
      if (!invSnap.empty) invRefs[l.productId] = { ref: invSnap.docs[0].ref };
    }

    // ── Crédit lié à la vente d'origine ──────────────────────────────────────
    //
    // Un retour sur une vente à crédit doit D'ABORD réduire la dette : rendre
    // des espèces à un client qui doit encore de l'argent revient à le payer
    // pour une marchandise qu'il n'a jamais réglée.
    //
    // Requête hors transaction : Firestore ne les autorise pas à l'intérieur.
    const creditSnap = await adminDb
      .collection(`tenants/${tenantId}/credits`)
      .where('saleId', '==', saleId)
      .limit(1)
      .get();
    const creditRef = creditSnap.empty ? null : creditSnap.docs[0].ref;
    const customerRef = sale.customerId
      ? adminDb.doc(`tenants/${tenantId}/customers/${sale.customerId}`)
      : null;

    const returnRef = adminDb.collection(`tenants/${tenantId}/sale_returns`).doc();

    /** Part du remboursement imputée sur la dette, et part rendue en espèces. */
    let creditReduction = 0;
    let cashRefund = refundAmount;

    await adminDb.runTransaction(async (tx) => {
      // ── Lectures ────────────────────────────────────────────────────────
      const freshQtys: Record<string, number> = {};
      for (const l of returnLines) {
        const inv = invRefs[l.productId];
        if (!inv) continue;
        const fresh = await tx.get(inv.ref);
        freshQtys[l.productId] = fresh.data()?.quantity || 0;
      }

      // Fix (même course que sur customer.creditUsed) : `returnedQuantity`
      // était lu une seule fois avant la transaction (saleItemsByProduct,
      // capturé plus haut) et jamais revérifié ici. Deux retours concurrents
      // sur la même vente pouvaient chacun passer le contrôle "quantité
      // restituable" sur une valeur déjà obsolète, et rembourser à deux
      // reprises plus que ce qui a réellement été acheté. On relit chaque
      // ligne de vente fraîchement et on revalide avant d'écrire.
      const freshReturnedQty: Record<string, number> = {};
      for (const l of returnLines) {
        const original = saleItemsByProduct.get(l.productId)!;
        const freshItemSnap = await tx.get(original.ref);
        const already = Number(freshItemSnap.data()?.returnedQuantity) || 0;
        freshReturnedQty[l.productId] = already;
        const purchasable = original.quantity - already;
        if (l.quantity > purchasable) {
          throw new Error(
            `Quantité à retourner (${l.quantity}) supérieure à la quantité restituable (${purchasable}) pour "${original.productName}" — un autre retour a probablement été traité entre-temps.`
          );
        }
      }

      // ── Écritures ────────────────────────────────────────────────────────
      for (const l of returnLines) {
        const original = saleItemsByProduct.get(l.productId)!;
        tx.update(original.ref, {
          returnedQuantity: FieldValue.increment(l.quantity),
        });
        const inv = invRefs[l.productId];
        if (inv) {
          tx.update(inv.ref, {
            quantity: (freshQtys[l.productId] || 0) + l.quantity,
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      }

      const totalOriginalQty = Array.from(saleItemsByProduct.values()).reduce((s, i) => s + i.quantity, 0);
      const totalReturnedQty = Array.from(saleItemsByProduct.values()).reduce((s, i) => {
        const extra = returnLines.find(l => l.productId === i.productId)?.quantity || 0;
        const already = freshReturnedQty[i.productId] ?? (i.returnedQuantity || 0);
        return s + already + extra;
      }, 0);
      const newSaleStatus = totalReturnedQty >= totalOriginalQty ? 'REFUNDED' : 'PARTIALLY_REFUNDED';

      // ── Imputation sur la dette avant tout remboursement en espèces ──────
      const freshCredit = creditRef ? await tx.get(creditRef) : null;
      const freshCustomer = customerRef ? await tx.get(customerRef) : null;

      creditReduction = 0;
      cashRefund = refundAmount;

      if (freshCredit?.exists) {
        const soldeAvant = (freshCredit.data()?.solde as number) || 0;
        creditReduction = Math.min(refundAmount, soldeAvant);
        cashRefund = refundAmount - creditReduction;

        if (creditReduction > 0) {
          const soldeApres = soldeAvant - creditReduction;
          tx.update(freshCredit.ref, {
            solde: soldeApres,
            status: soldeApres === 0 ? 'PAID' : (freshCredit.data()?.status || 'PENDING'),
            updatedAt: FieldValue.serverTimestamp(),
          });

          // Libération du plafond, à hauteur de ce qui a été imputé.
          if (freshCustomer?.exists) {
            const used = (freshCustomer.data()?.creditUsed as number) || 0;
            tx.update(freshCustomer.ref, {
              creditUsed: Math.max(0, used - creditReduction),
              updatedAt: FieldValue.serverTimestamp(),
            });
          }
        }
      }

      tx.update(saleRef, { status: newSaleStatus, updatedAt: FieldValue.serverTimestamp() });

      tx.set(returnRef, {
        tenantId, saleId, saleReference: sale.reference || saleId,
        storeId: sale.storeId, customerId: sale.customerId || null,
        items: returnLines,
        refundAmount, refundMethod, reason: reason.trim(),
        // Ventilation : ce qui a effacé de la dette, et ce qui est réellement
        // sorti du tiroir. Sans cette distinction, le rapprochement de caisse
        // déduirait la totalité du remboursement, y compris la part qui n'a
        // jamais quitté la caisse.
        creditReduction,
        cashRefund,
        status: 'COMPLETED',
        processedBy: callerUid,
        processedByName: processedByName || null,
        createdAt: FieldValue.serverTimestamp(),
      });
    });

    // ── Mouvements de stock + alerte (hors transaction) ──────────────────────
    const writes: Promise<unknown>[] = [];
    for (const l of returnLines) {
      if (!l.restocked) continue;
      writes.push(
        adminDb.collection(`tenants/${tenantId}/inventory_movements`).add({
          tenantId, productId: l.productId, productName: l.productName, storeId: sale.storeId,
          type: 'IN', quantity: l.quantity,
          reason: `Retour client — vente ${sale.reference || saleId}`,
          saleReturnId: returnRef.id,
          createdBy: callerUid,
          createdAt: FieldValue.serverTimestamp(),
        })
      );
    }
    // Alerte visible par les managers, comme les autres événements sensibles (cf. AlertType 'REFUND')
    writes.push(
      adminDb.collection(`tenants/${tenantId}/alerts`).add({
        tenantId, type: 'REFUND', severity: refundAmount > 50000 ? 'HIGH' : 'MEDIUM',
        title: 'Retour client traité',
        message: `Remboursement de ${refundAmount} sur la vente ${sale.reference || saleId} — motif : ${reason.trim()}`,
        reference: 'sale_returns', referenceId: returnRef.id,
        isRead: false, isResolved: false, resolvedBy: null, resolvedAt: null,
        createdAt: FieldValue.serverTimestamp(),
      })
    );
    await Promise.all(writes);

    return NextResponse.json({ success: true, id: returnRef.id, refundAmount });
  } catch (error) {
    console.error('Create return error:', error);
    const msg = error instanceof Error ? error.message : 'Erreur interne';
    const isConflict = msg.startsWith('Quantité à retourner');
    return NextResponse.json({ error: isConflict ? msg : 'Erreur interne' }, { status: isConflict ? 409 : 500 });
  }
}
