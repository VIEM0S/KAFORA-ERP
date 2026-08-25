import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';
import { cookies } from 'next/headers';

interface ReceiveLine {
  productId: string;
  quantityReceivedNow: number; // quantité reçue lors de CETTE réception (peut être partielle)
}

// Réceptionne tout ou partie d'un bon de commande fournisseur :
//  - incrémente le stock (inventory) du magasin de destination
//  - crée un mouvement de stock ('IN') par produit, pour garder l'historique
//  - met à jour purchasePrice du produit avec le dernier coût d'achat connu
//  - marque la ligne du PO comme reçue (quantityReceived cumulatif)
//  - passe le PO à RECEIVED si tout est reçu, sinon PARTIALLY_RECEIVED
//
// Tout se fait dans une transaction Firestore (lectures avant écritures),
// même logique défensive que /api/pos/checkout pour éviter les races sur le stock.
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
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const {
      tenantId, purchaseOrderId, lines,
    }: { tenantId: string; purchaseOrderId: string; lines: ReceiveLine[] } = await request.json();

    if (!tenantId || !purchaseOrderId || !Array.isArray(lines) || lines.length === 0) {
      return NextResponse.json({ error: 'Données manquantes' }, { status: 400 });
    }
    if (tenantId !== callerTenantId) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const poRef = adminDb.doc(`tenants/${tenantId}/purchase_orders/${purchaseOrderId}`);
    const poSnap = await poRef.get();
    if (!poSnap.exists) return NextResponse.json({ error: 'Bon de commande introuvable' }, { status: 404 });
    const po = poSnap.data()!;
    if (!['DRAFT', 'SENT', 'PARTIALLY_RECEIVED'].includes(po.status)) {
      return NextResponse.json({ error: `Impossible de réceptionner un bon ${po.status}` }, { status: 409 });
    }
    const storeId = po.storeId as string;

    type POLine = { productId: string; productName: string; productSku: string; quantityOrdered: number; quantityReceived: number; unitCost: number; total: number };
    const poItems: POLine[] = po.items;

    // Valider les quantités reçues demandées par rapport au reste à recevoir
    const receiveMap = new Map(lines.map(l => [l.productId, Math.max(0, Math.floor(Number(l.quantityReceivedNow) || 0))]));
    for (const item of poItems) {
      const qty = receiveMap.get(item.productId) || 0;
      const remaining = item.quantityOrdered - item.quantityReceived;
      if (qty > remaining) {
        return NextResponse.json(
          { error: `Quantité reçue (${qty}) supérieure au reste attendu (${remaining}) pour "${item.productName}"` },
          { status: 400 }
        );
      }
    }

    // ── Trouver/préparer les docs d'inventaire concernés ─────────────────────
    const invRefs: Record<string, { ref: FirebaseFirestore.DocumentReference; exists: boolean }> = {};
    for (const item of poItems) {
      const qtyNow = receiveMap.get(item.productId) || 0;
      if (qtyNow <= 0) continue;
      const invSnap = await adminDb
        .collection(`tenants/${tenantId}/inventory`)
        .where('productId', '==', item.productId)
        .where('storeId', '==', storeId)
        .limit(1)
        .get();
      if (invSnap.empty) {
        // Pas encore de ligne d'inventaire pour ce produit/magasin : on la crée
        invRefs[item.productId] = { ref: adminDb.collection(`tenants/${tenantId}/inventory`).doc(), exists: false };
      } else {
        invRefs[item.productId] = { ref: invSnap.docs[0].ref, exists: true };
      }
    }

    let updatedItems: POLine[] = [];
    let movementsToWrite: Array<{ productId: string; productName: string; qty: number; previousQuantity: number; newQuantity: number; unitCost: number }> = [];

    await adminDb.runTransaction(async (tx) => {
      // Réinitialisés à chaque (re)exécution du callback (retry Firestore).
      updatedItems = [];
      movementsToWrite = [];

      // Fix (idempotence double-soumission) : `poItems` (avec
      // `quantityReceived` cumulatif) était lu une seule fois avant la
      // transaction et jamais revérifié ici — seul l'inventaire l'était.
      // Deux réceptions concurrentes sur le même bon de commande pouvaient
      // chacune passer la validation "quantité ≤ reste attendu" sur une
      // valeur déjà obsolète, et la seconde écrasait le cumul de la première.
      // On relit le PO ici et on revalide avant d'écrire.
      const freshPoSnap = await tx.get(poRef);
      const freshPo = freshPoSnap.data()!;
      if (!['DRAFT', 'SENT', 'PARTIALLY_RECEIVED'].includes(freshPo.status)) {
        throw new Error(`Impossible de réceptionner un bon ${freshPo.status} — probablement déjà réceptionné entre-temps.`);
      }
      const freshPoItems: POLine[] = freshPo.items;
      for (const item of freshPoItems) {
        const qty = receiveMap.get(item.productId) || 0;
        const remaining = item.quantityOrdered - item.quantityReceived;
        if (qty > remaining) {
          throw new Error(
            `Quantité reçue (${qty}) supérieure au reste attendu (${remaining}) pour "${item.productName}" — probablement déjà réceptionné entre-temps.`
          );
        }
      }

      // ── Lectures d'abord ────────────────────────────────────────────────
      // Coût d'achat actuel de chaque produit : nécessaire au calcul du coût
      // moyen pondéré (voir plus bas).
      const currentCosts: Record<string, number | null> = {};
      for (const item of freshPoItems) {
        const prodSnap = await tx.get(adminDb.doc(`tenants/${tenantId}/products/${item.productId}`));
        const raw = prodSnap.data()?.purchasePrice;
        currentCosts[item.productId] = raw == null ? null : Number(raw);
      }

      const freshQtys: Record<string, number> = {};
      for (const item of freshPoItems) {
        const inv = invRefs[item.productId];
        if (!inv) continue;
        if (inv.exists) {
          const fresh = await tx.get(inv.ref);
          freshQtys[item.productId] = fresh.data()?.quantity || 0;
        } else {
          freshQtys[item.productId] = 0;
        }
      }

      // ── Écritures ────────────────────────────────────────────────────────
      for (const item of freshPoItems) {
        const qtyNow = receiveMap.get(item.productId) || 0;
        const newQuantityReceived = item.quantityReceived + qtyNow;
        updatedItems.push({ ...item, quantityReceived: newQuantityReceived });

        if (qtyNow <= 0) continue;
        const inv = invRefs[item.productId];
        const previousQuantity = freshQtys[item.productId] || 0;
        const newQuantity = previousQuantity + qtyNow;

        if (inv.exists) {
          tx.update(inv.ref, { quantity: newQuantity, updatedAt: FieldValue.serverTimestamp() });
        } else {
          tx.set(inv.ref, {
            tenantId, productId: item.productId, storeId,
            quantity: newQuantity, minQuantity: 0, maxQuantity: null, reorderPoint: null,
            lastStockCheck: FieldValue.serverTimestamp(),
          });
        }
        movementsToWrite.push({
          productId: item.productId, productName: item.productName,
          qty: qtyNow, previousQuantity, newQuantity, unitCost: item.unitCost,
        });

        // ── Coût moyen pondéré (CUMP) ─────────────────────────────────────
        //
        // Le code écrasait auparavant le prix d'achat par le DERNIER coût
        // reçu. Conséquence : 100 sacs achetés à 5 000, plus 10 reçus à
        // 8 000, et les 110 se retrouvaient valorisés à 8 000 — une valeur de
        // stock surévaluée de 300 000 FCFA, et une marge sous-estimée sur les
        // 100 anciens sacs.
        //
        // Le coût moyen pondéré est l'une des méthodes de valorisation
        // retenues en comptabilité OHADA ; le « dernier coût » n'en est pas
        // une. Formule : (stock ancien × coût ancien + reçu × coût reçu)
        // divisé par le stock total.
        //
        // Les ventes DÉJÀ enregistrées ne sont pas affectées : leur coût est
        // figé dans cost_summary au moment de la vente.
        const previousCost = currentCosts[item.productId];
        const weightedCost =
          previousCost == null || previousQuantity <= 0
            // Aucun coût connu, ou plus de stock : le coût reçu fait
            // référence, sans moyenne à calculer.
            ? item.unitCost
            : Math.round(
                (previousQuantity * previousCost + qtyNow * item.unitCost) / newQuantity
              );

        tx.update(adminDb.doc(`tenants/${tenantId}/products/${item.productId}`), {
          purchasePrice: weightedCost,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      const allReceived = updatedItems.every(i => i.quantityReceived >= i.quantityOrdered);
      const anyReceived = updatedItems.some(i => i.quantityReceived > 0);
      const newStatus = allReceived ? 'RECEIVED' : anyReceived ? 'PARTIALLY_RECEIVED' : freshPo.status;

      tx.update(poRef, {
        items: updatedItems,
        status: newStatus,
        updatedAt: FieldValue.serverTimestamp(),
        receivedAt: allReceived ? FieldValue.serverTimestamp() : freshPo.receivedAt || null,
      });
    });

    // ── Mouvements de stock (hors transaction, comme dans checkout) ─────────
    await Promise.all(movementsToWrite.map(m =>
      adminDb.collection(`tenants/${tenantId}/inventory_movements`).add({
        tenantId, productId: m.productId, productName: m.productName, storeId,
        type: 'IN', quantity: m.qty,
        previousQuantity: m.previousQuantity,
        newQuantity: m.newQuantity,
        purchaseOrderId,
        unitCost: m.unitCost,
        reason: `Réception bon de commande ${po.reference}`,
        createdBy: callerUid,
        createdAt: FieldValue.serverTimestamp(),
      })
    ));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Receive purchase order error:', error);
    const msg = error instanceof Error ? error.message : 'Erreur interne';
    const isConflict = msg.includes('déjà réceptionné entre-temps');
    return NextResponse.json({ error: isConflict ? msg : 'Erreur interne' }, { status: isConflict ? 409 : 500 });
  }
}
