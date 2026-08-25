import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';
import { cookies } from 'next/headers';
import { checkSubscriptionAllows } from '@/lib/api/subscription-guard';
import { resolveTransferSettings, canShip, canTransitionTo } from '@/lib/transfers/rules';
import type { TransferLine, TransferStatus, UserRole } from '@/lib/types';

/**
 * Confirme la réception d'un transfert : le stock ENTRE au magasin destination.
 *
 * C'est la contrepartie de l'expédition. Tant que cette confirmation n'a pas
 * lieu, la marchandise reste « en transit » et n'est vendable nulle part —
 * ce qui est exactement le comportement voulu pour du stock sur la route.
 */
export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('__session')?.value;
    if (!sessionCookie) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const decoded = await adminAuth.verifySessionCookie(sessionCookie, true);
    const tenantId = decoded.tenantId as string;
    const callerRole = decoded.role as UserRole;
    const callerStoreIds = decoded.storeIds as string[] | null | undefined;

    const blocked = await checkSubscriptionAllows(tenantId, 'write');
    if (blocked) {
      return NextResponse.json({ error: blocked.error }, { status: blocked.status });
    }

    const { transferId } = (await request.json()) as { transferId?: string };
    if (!transferId) {
      return NextResponse.json({ error: 'Transfert manquant' }, { status: 400 });
    }

    const tenantSnap = await adminDb.doc(`tenants/${tenantId}`).get();
    const settings = resolveTransferSettings(tenantSnap.data()?.transferSettings);
    if (!canShip(callerRole, settings)) {
      return NextResponse.json(
        { error: 'Votre rôle ne permet pas de confirmer une réception' },
        { status: 403 }
      );
    }

    const transferRef = adminDb.doc(`tenants/${tenantId}/transfers/${transferId}`);
    const snapBefore = await transferRef.get();
    if (!snapBefore.exists) {
      return NextResponse.json({ error: 'Transfert introuvable' }, { status: 404 });
    }
    const before = snapBefore.data() as {
      status: TransferStatus; toStoreId: string; lines: TransferLine[];
    };

    // Confirmer une réception, c'est faire entrer du stock : il faut avoir
    // accès au magasin DESTINATION.
    if (Array.isArray(callerStoreIds) && !callerStoreIds.includes(before.toStoreId)) {
      return NextResponse.json(
        { error: "Vous n'avez pas accès au magasin destination" },
        { status: 403 }
      );
    }

    // Requêtes hors transaction (Firestore ne les autorise pas dedans).
    // Un produit peut n'avoir aucune ligne d'inventaire dans le magasin
    // destination : c'est le cas normal d'un article qu'il ne vendait pas
    // encore. On créera alors la ligne.
    const found = await Promise.all(
      before.lines.map(l =>
        adminDb
          .collection(`tenants/${tenantId}/inventory`)
          .where('productId', '==', l.productId)
          .where('storeId', '==', before.toStoreId)
          .limit(1)
          .get()
      )
    );

    const result = await adminDb.runTransaction(async tx => {
      // Relu dans la transaction : empêche une double réception (donc un
      // stock crédité deux fois) si l'on clique deux fois ou si deux
      // personnes confirment en même temps.
      const snap = await tx.get(transferRef);
      const t = snap.data() as { status: TransferStatus; toStoreId: string; lines: TransferLine[] };
      if (!canTransitionTo(t.status, 'RECEIVED')) {
        return { error: `Ce transfert ne peut pas être reçu (${t.status})`, status: 409 };
      }

      const existing = await Promise.all(
        found.map((f, i) => (f.empty ? null : tx.get(f.docs[0].ref)))
      );

      t.lines.forEach((line, i) => {
        if (found[i].empty) {
          // Première entrée de ce produit dans ce magasin.
          const newRef = adminDb.collection(`tenants/${tenantId}/inventory`).doc();
          tx.set(newRef, {
            tenantId,
            productId: line.productId,
            storeId: t.toStoreId,
            quantity: line.quantity,
            minQuantity: 0,
          });
          tx.set(adminDb.collection(`tenants/${tenantId}/inventory_movements`).doc(), {
            tenantId,
            productId: line.productId,
            productName: line.productName,
            storeId: t.toStoreId,
            type: 'TRANSFER_IN',
            quantity: line.quantity,
            previousQuantity: 0,
            newQuantity: line.quantity,
            transferId,
            reason: "Réception d'un transfert",
            createdAt: FieldValue.serverTimestamp(),
          });
          return;
        }

        const prev = (existing[i]?.data()?.quantity as number) || 0;
        tx.update(found[i].docs[0].ref, { quantity: prev + line.quantity });
        tx.set(adminDb.collection(`tenants/${tenantId}/inventory_movements`).doc(), {
          tenantId,
          productId: line.productId,
          productName: line.productName,
          storeId: t.toStoreId,
          type: 'TRANSFER_IN',
          quantity: line.quantity,
          previousQuantity: prev,
          newQuantity: prev + line.quantity,
          transferId,
          reason: "Réception d'un transfert",
          createdAt: FieldValue.serverTimestamp(),
        });
      });

      tx.update(transferRef, {
        status: 'RECEIVED',
        receivedBy: decoded.uid,
        receivedAt: FieldValue.serverTimestamp(),
      });

      return { success: true };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Transfer receive error:', error);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
