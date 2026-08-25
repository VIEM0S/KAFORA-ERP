import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';
import { cookies } from 'next/headers';
import { checkSubscriptionAllows } from '@/lib/api/subscription-guard';
import { resolveTransferSettings, canApprove, canShip, canTransitionTo } from '@/lib/transfers/rules';
import type { TransferLine, TransferStatus, UserRole } from '@/lib/types';

/**
 * Approuve, refuse ou annule un transfert.
 *
 * Le cas sensible est l'annulation d'un transfert DÉJÀ EXPÉDIÉ : le stock est
 * sorti de la source et n'est jamais entré à destination. Si on se contentait
 * de changer le statut, la marchandise disparaîtrait purement et simplement
 * des comptes. On la rend donc à la source, avec un mouvement de stock qui
 * garde la trace de l'aller et du retour.
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

    const { transferId, action, reason } = (await request.json()) as {
      transferId?: string; action?: 'APPROVE' | 'REJECT' | 'CANCEL'; reason?: string;
    };
    if (!transferId || !action || !['APPROVE', 'REJECT', 'CANCEL'].includes(action)) {
      return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });
    }

    const tenantSnap = await adminDb.doc(`tenants/${tenantId}`).get();
    const settings = resolveTransferSettings(tenantSnap.data()?.transferSettings);

    // Approuver/refuser relève des rôles d'approbation ; annuler relève des
    // rôles d'expédition (celui qui peut envoyer peut renoncer à envoyer).
    const allowed =
      action === 'CANCEL' ? canShip(callerRole, settings) : canApprove(callerRole, settings);
    if (!allowed) {
      return NextResponse.json({ error: 'Votre rôle ne permet pas cette action' }, { status: 403 });
    }

    const transferRef = adminDb.doc(`tenants/${tenantId}/transfers/${transferId}`);
    const snapBefore = await transferRef.get();
    if (!snapBefore.exists) {
      return NextResponse.json({ error: 'Transfert introuvable' }, { status: 404 });
    }
    const before = snapBefore.data() as {
      status: TransferStatus; fromStoreId: string; toStoreId: string; lines: TransferLine[];
    };

    if (Array.isArray(callerStoreIds)) {
      const involved =
        callerStoreIds.includes(before.fromStoreId) || callerStoreIds.includes(before.toStoreId);
      if (!involved) {
        return NextResponse.json({ error: "Vous n'avez pas accès à ces magasins" }, { status: 403 });
      }
    }

    const target: TransferStatus =
      action === 'APPROVE' ? 'APPROVED' : action === 'REJECT' ? 'REJECTED' : 'CANCELLED';

    // Restitution nécessaire ? Uniquement si le stock est déjà sorti.
    const needsRestock = action === 'CANCEL' && before.status === 'SHIPPED';
    const found = needsRestock
      ? await Promise.all(
          before.lines.map(l =>
            adminDb
              .collection(`tenants/${tenantId}/inventory`)
              .where('productId', '==', l.productId)
              .where('storeId', '==', before.fromStoreId)
              .limit(1)
              .get()
          )
        )
      : [];

    const result = await adminDb.runTransaction(async tx => {
      const snap = await tx.get(transferRef);
      const t = snap.data() as {
        status: TransferStatus; fromStoreId: string; lines: TransferLine[];
      };

      if (!canTransitionTo(t.status, target)) {
        return { error: `Action impossible depuis l'état « ${t.status} »`, status: 409 };
      }
      // L'état a pu changer entre la lecture initiale et la transaction :
      // on ne restitue que si le transfert est TOUJOURS expédié.
      if (needsRestock && t.status !== 'SHIPPED') {
        return { error: 'État modifié entre-temps, réessayez', status: 409 };
      }

      if (needsRestock) {
        const existing = await Promise.all(
          found.map(f => (f.empty ? null : tx.get(f.docs[0].ref)))
        );
        t.lines.forEach((line, i) => {
          const prev = (existing[i]?.data()?.quantity as number) || 0;
          if (found[i] && !found[i].empty) {
            tx.update(found[i].docs[0].ref, { quantity: prev + line.quantity });
          } else {
            const ref = adminDb.collection(`tenants/${tenantId}/inventory`).doc();
            tx.set(ref, {
              tenantId, productId: line.productId, storeId: t.fromStoreId,
              quantity: line.quantity, minQuantity: 0,
            });
          }
          tx.set(adminDb.collection(`tenants/${tenantId}/inventory_movements`).doc(), {
            tenantId,
            productId: line.productId,
            productName: line.productName,
            storeId: t.fromStoreId,
            type: 'TRANSFER_CANCEL',
            quantity: line.quantity,
            previousQuantity: prev,
            newQuantity: prev + line.quantity,
            transferId,
            reason: "Annulation d'un transfert expédié — retour au magasin source",
            createdAt: FieldValue.serverTimestamp(),
          });
        });
      }

      tx.update(transferRef, {
        status: target,
        ...(action === 'APPROVE'
          ? { approvedBy: decoded.uid, approvedAt: FieldValue.serverTimestamp() }
          : {}),
        ...(action === 'REJECT' ? { rejectionReason: reason?.trim() || null } : {}),
      });

      return { success: true, restocked: needsRestock };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error('Transfer decide error:', error);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
