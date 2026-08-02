import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';
import { writeAuditLog } from '@/lib/firebase/audit-log';
import { cookies } from 'next/headers';

// Annule une vente complétée et restaure le stock.
// Migré depuis une écriture client (Firestore SDK + firestore.rules) vers
// cette route Admin SDK pour rester cohérent avec checkout/receive/returns :
// le serveur revérifie tout (statut, quantités déjà retournées) au lieu de
// faire confiance à ce que le client calcule et envoie.
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

    const { tenantId, saleId, motif }: { tenantId: string; saleId: string; motif: string } = await request.json();
    if (!tenantId || !saleId || !motif?.trim()) {
      return NextResponse.json({ error: 'Motif d\'annulation requis' }, { status: 400 });
    }
    if (tenantId !== callerTenantId) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const saleRef = adminDb.doc(`tenants/${tenantId}/sales/${saleId}`);
    const saleSnap = await saleRef.get();
    if (!saleSnap.exists) return NextResponse.json({ error: 'Vente introuvable' }, { status: 404 });
    const sale = saleSnap.data()!;
    // On ne peut annuler qu'une vente encore intacte : si des articles ont déjà
    // été retournés (PARTIALLY_REFUNDED), une annulation complète restaurerait
    // deux fois le stock déjà réintégré par le retour — donc interdit.
    if (sale.status !== 'COMPLETED') {
      return NextResponse.json({ error: `Impossible d'annuler une vente ${sale.status}` }, { status: 409 });
    }

    const itemsSnap = await adminDb.collection(`tenants/${tenantId}/sales/${saleId}/sale_items`).get();
    const items = itemsSnap.docs.map(d => d.data() as { productId: string; quantity: number; productName: string });

    // ── Trouver les docs inventory du bon magasin pour chaque produit ─────────
    // (le code client d'origine cherchait par productId seul, sans filtrer par
    // storeId — risque de restaurer le stock du mauvais magasin en multi-store)
    const invRefs: Record<string, FirebaseFirestore.DocumentReference> = {};
    for (const item of items) {
      if (!item.productId) continue;
      const invSnap = await adminDb
        .collection(`tenants/${tenantId}/inventory`)
        .where('productId', '==', item.productId)
        .where('storeId', '==', sale.storeId)
        .limit(1)
        .get();
      if (!invSnap.empty) invRefs[item.productId] = invSnap.docs[0].ref;
    }

    // ── Crédit lié à cette vente ─────────────────────────────────────────────
    //
    // Annuler une vente à crédit sans toucher au crédit laissait le client
    // débiteur d'une vente qui n'existe plus, et son plafond consommé
    // d'autant. Au bout de quelques annulations, un bon client se retrouve
    // bloqué en caisse sans que personne ne comprenne pourquoi.
    //
    // La requête est faite ICI : Firestore n'autorise pas les requêtes à
    // l'intérieur d'une transaction.
    const creditSnap = await adminDb
      .collection(`tenants/${tenantId}/credits`)
      .where('saleId', '==', saleId)
      .limit(1)
      .get();
    const creditRef = creditSnap.empty ? null : creditSnap.docs[0].ref;
    const customerRef = sale.customerId
      ? adminDb.doc(`tenants/${tenantId}/customers/${sale.customerId}`)
      : null;

    let movementsToWrite: Array<{ productId: string; qty: number; previousQuantity: number; newQuantity: number }> = [];

    await adminDb.runTransaction(async (tx) => {
      // Réinitialisé à chaque (re)exécution du callback : Firestore peut
      // relancer une transaction en cas de contention, et ce tableau est
      // rempli plus bas — sans ce reset, un retry accumulerait des
      // mouvements en double.
      movementsToWrite = [];

      // ── Lectures d'abord ────────────────────────────────────────────────
      // Fix (idempotence double-clic) : le statut de la vente était lu une
      // seule fois avant la transaction (ligne ~38) et jamais revérifié ici.
      // Deux requêtes d'annulation concurrentes sur la même vente passaient
      // toutes les deux le contrôle initial et restauraient chacune le stock
      // séparément — la même vente se retrouvait annulée "deux fois", avec
      // un stock restauré en double. On relit le statut ici, à l'intérieur
      // de la transaction, pour que seule la première annulation aboutisse.
      const freshSaleSnap = await tx.get(saleRef);
      if (freshSaleSnap.data()?.status !== 'COMPLETED') {
        throw new Error('Cette vente a déjà été annulée ou modifiée entre-temps.');
      }

      const freshQtys: Record<string, number> = {};
      for (const [productId, ref] of Object.entries(invRefs)) {
        const fresh = await tx.get(ref);
        freshQtys[productId] = fresh.data()?.quantity || 0;
      }

      // Lectures du crédit et du client, avant toute écriture.
      const freshCredit = creditRef ? await tx.get(creditRef) : null;
      const freshCustomer = customerRef ? await tx.get(customerRef) : null;

      // ── Écritures ────────────────────────────────────────────────────────
      for (const item of items) {
        const ref = invRefs[item.productId];
        if (!ref) continue;
        const previousQuantity = freshQtys[item.productId] || 0;
        const newQuantity = previousQuantity + item.quantity;
        tx.update(ref, { quantity: newQuantity, updatedAt: FieldValue.serverTimestamp() });
        movementsToWrite.push({ productId: item.productId, qty: item.quantity, previousQuantity, newQuantity });
      }

      // ── Crédit : on solde et on libère le plafond ────────────────────────
      if (freshCredit?.exists) {
        const creditData = freshCredit.data() as { solde?: number; status?: string };
        const soldeRestant = creditData.solde || 0;

        tx.update(freshCredit.ref, {
          solde: 0,
          status: 'CANCELLED',
          motifAnnulation: motif.trim(),
          updatedAt: FieldValue.serverTimestamp(),
        });

        // On ne libère que le solde RESTANT, pas le montant initial : si le
        // client a déjà remboursé une partie, ces versements ont déjà réduit
        // son encours. Libérer le total le créditerait à tort.
        if (freshCustomer?.exists && soldeRestant > 0) {
          const used = (freshCustomer.data()?.creditUsed as number) || 0;
          tx.update(freshCustomer.ref, {
            creditUsed: Math.max(0, used - soldeRestant),
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      }

      tx.update(saleRef, {
        status: 'CANCELLED',
        motifAnnulation: motif.trim(),
        cancelledBy: callerUid,
        cancelledAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    // ── Mouvements de stock (hors transaction, comme checkout/receive/returns) ─
    await Promise.all(movementsToWrite.map(m =>
      adminDb.collection(`tenants/${tenantId}/inventory_movements`).add({
        tenantId, productId: m.productId, storeId: sale.storeId,
        type: 'IN', quantity: m.qty,
        previousQuantity: m.previousQuantity, newQuantity: m.newQuantity,
        reason: `Annulation vente #${saleId.slice(0, 8).toUpperCase()} — ${motif.trim()}`,
        saleId,
        createdBy: callerUid,
        createdAt: FieldValue.serverTimestamp(),
      })
    ));

    await writeAuditLog({
      tenantId, userId: callerUid, action: 'SALE_CANCELLED',
      entity: 'sales', entityId: saleId, details: motif.trim(),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Cancel sale error:', error);
    const msg = error instanceof Error ? error.message : 'Erreur interne';
    const isAlreadyCancelled = msg.startsWith('Cette vente a déjà été annulée');
    return NextResponse.json(
      { error: isAlreadyCancelled ? msg : 'Erreur interne' },
      { status: isAlreadyCancelled ? 409 : 500 }
    );
  }
}
