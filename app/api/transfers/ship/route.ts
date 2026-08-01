import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';
import { cookies } from 'next/headers';
import { checkSubscriptionAllows } from '@/lib/api/subscription-guard';
import { resolveTransferSettings, canShip, canTransitionTo } from '@/lib/transfers/rules';
import type { TransferLine, TransferStatus, UserRole } from '@/lib/types';

/**
 * Expédie un transfert : le stock SORT du magasin source.
 *
 * À partir d'ici et jusqu'à la réception, la marchandise est « en transit » :
 * elle n'appartient plus au stock de la source et pas encore à celui de la
 * destination. C'est volontaire — sans ça, la même marchandise resterait
 * vendable dans la boutique qui l'a déjà expédiée.
 *
 * TOUT se joue dans une seule transaction : relecture du statut, contrôle des
 * quantités disponibles, décrément et changement d'état. Sans ça, deux clics
 * simultanés sur « Expédier » sortiraient le stock deux fois.
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
        { error: "Votre rôle ne permet pas d'expédier un transfert" },
        { status: 403 }
      );
    }

    const transferRef = adminDb.doc(`tenants/${tenantId}/transfers/${transferId}`);

    const result = await adminDb.runTransaction(async tx => {
      const snap = await tx.get(transferRef);
      if (!snap.exists) return { error: 'Transfert introuvable', status: 404 };

      const t = snap.data() as {
        status: TransferStatus; fromStoreId: string; toStoreId: string; lines: TransferLine[];
      };

      // Relu DANS la transaction : entre l'affichage de la page et le clic,
      // quelqu'un a pu annuler ou expédier ce même transfert.
      if (!canTransitionTo(t.status, 'SHIPPED')) {
        return { error: `Ce transfert ne peut pas être expédié (${t.status})`, status: 409 };
      }

      // Expédier, c'est faire sortir du stock : il faut avoir accès au
      // magasin SOURCE, pas seulement être impliqué dans le transfert.
      if (Array.isArray(callerStoreIds) && !callerStoreIds.includes(t.fromStoreId)) {
        return { error: "Vous n'avez pas accès au magasin source", status: 403 };
      }

      // Les documents d'inventaire ont un identifiant auto-généré (pas une
      // clé composée) : on les retrouve donc par requête, comme le fait le
      // checkout POS. Ces requêtes sont exécutées HORS transaction car
      // Firestore n'autorise pas les requêtes à l'intérieur ; le décrément,
      // lui, reste transactionnel via tx.get() sur les références obtenues.
      const found = await Promise.all(
        t.lines.map(l =>
          adminDb
            .collection(`tenants/${tenantId}/inventory`)
            .where('productId', '==', l.productId)
            .where('storeId', '==', t.fromStoreId)
            .limit(1)
            .get()
        )
      );

      const missing = t.lines.filter((_, i) => found[i].empty);
      if (missing.length > 0) {
        return {
          error: `Aucun stock enregistré pour : ${missing.map(m => m.productName || m.productId).join(', ')}`,
          status: 409,
        };
      }

      const invRefs = found.map(f => f.docs[0].ref);
      // Relecture transactionnelle : c'est elle qui garantit qu'une autre
      // opération (vente, second clic) n'a pas modifié la quantité entre la
      // requête ci-dessus et l'écriture ci-dessous.
      const invSnaps = await Promise.all(invRefs.map(r => tx.get(r)));

      const insufficient: string[] = [];
      const updates: { ref: FirebaseFirestore.DocumentReference; before: number; after: number; line: TransferLine }[] = [];

      t.lines.forEach((line, i) => {
        const before = (invSnaps[i].data()?.quantity as number) || 0;
        if (before < line.quantity) {
          insufficient.push(`${line.productName || line.productId} (${before} disponible)`);
          return;
        }
        updates.push({ ref: invRefs[i], before, after: before - line.quantity, line });
      });

      // On refuse en bloc plutôt que d'expédier partiellement : un transfert
      // à moitié parti serait ingérable côté réception et côté comptes.
      if (insufficient.length > 0) {
        return { error: `Stock insuffisant : ${insufficient.join(', ')}`, status: 409 };
      }

      for (const u of updates) {
        tx.update(u.ref, { quantity: u.after });

        tx.set(adminDb.collection(`tenants/${tenantId}/inventory_movements`).doc(), {
          tenantId,
          productId: u.line.productId,
          storeId: t.fromStoreId,
          type: 'TRANSFER_OUT',
          quantity: -u.line.quantity,
          previousQuantity: u.before,
          newQuantity: u.after,
          transferId,
          reason: `Transfert vers un autre magasin`,
          createdAt: FieldValue.serverTimestamp(),
        });
      }

      tx.update(transferRef, {
        status: 'SHIPPED',
        shippedBy: decoded.uid,
        shippedAt: FieldValue.serverTimestamp(),
      });

      return { success: true };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Transfer ship error:', error);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
