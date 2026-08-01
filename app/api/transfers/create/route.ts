import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';
import { cookies } from 'next/headers';
import { checkSubscriptionAllows } from '@/lib/api/subscription-guard';
import { resolveTransferSettings } from '@/lib/transfers/rules';
import type { TransferLine, UserRole } from '@/lib/types';

/**
 * Crée une demande de transfert entre deux magasins.
 *
 * Aucun stock ne bouge ici : la sortie a lieu à l'expédition, l'entrée à la
 * réception. Créer une demande n'engage rien et peut donc être fait sans
 * risque par un responsable de magasin.
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

    if (callerRole === 'CASHIER') {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const blocked = await checkSubscriptionAllows(tenantId, 'write');
    if (blocked) {
      return NextResponse.json({ error: blocked.error }, { status: blocked.status });
    }

    const { fromStoreId, toStoreId, lines, note } = (await request.json()) as {
      fromStoreId?: string; toStoreId?: string; lines?: TransferLine[]; note?: string;
    };

    if (!fromStoreId || !toStoreId || !Array.isArray(lines) || lines.length === 0) {
      return NextResponse.json({ error: 'Champs manquants' }, { status: 400 });
    }
    if (fromStoreId === toStoreId) {
      return NextResponse.json(
        { error: 'Les magasins source et destination doivent être différents' },
        { status: 400 }
      );
    }
    // Quantités : entiers strictement positifs. Une quantité négative
    // inverserait le sens du transfert au moment du mouvement de stock.
    for (const l of lines) {
      if (!l.productId || !Number.isInteger(l.quantity) || l.quantity <= 0) {
        return NextResponse.json({ error: 'Quantité invalide' }, { status: 400 });
      }
    }

    // Cloisonnement : on doit avoir accès à AU MOINS UN des deux magasins.
    // Un responsable peut demander à recevoir du stock d'une boutique qu'il
    // ne gère pas — c'est le principe même d'une demande — mais il ne peut
    // pas orchestrer un transfert entre deux magasins qui ne le concernent
    // pas. (storeIds absent ou null = direction, accès à tout.)
    if (Array.isArray(callerStoreIds)) {
      const involved = callerStoreIds.includes(fromStoreId) || callerStoreIds.includes(toStoreId);
      if (!involved) {
        return NextResponse.json({ error: "Vous n'avez pas accès à ces magasins" }, { status: 403 });
      }
    }

    // Les deux magasins doivent exister dans CE tenant : sans cette
    // vérification, un identifiant forgé pointerait vers un autre client.
    const [fromSnap, toSnap, tenantSnap] = await Promise.all([
      adminDb.doc(`tenants/${tenantId}/stores/${fromStoreId}`).get(),
      adminDb.doc(`tenants/${tenantId}/stores/${toStoreId}`).get(),
      adminDb.doc(`tenants/${tenantId}`).get(),
    ]);
    if (!fromSnap.exists || !toSnap.exists) {
      return NextResponse.json({ error: 'Magasin inconnu' }, { status: 400 });
    }

    const settings = resolveTransferSettings(tenantSnap.data()?.transferSettings);

    // Sans circuit d'approbation, la demande naît déjà validée : elle n'attend
    // plus que l'expédition. C'est ce qui rend la fonction utilisable par un
    // commerce d'une seule personne sans étape administrative inutile.
    const status = settings.requireApproval ? 'PENDING' : 'APPROVED';

    const ref = adminDb.collection(`tenants/${tenantId}/transfers`).doc();
    const now = FieldValue.serverTimestamp();

    await ref.set({
      tenantId,
      reference: `TR-${Date.now().toString(36).toUpperCase()}`,
      fromStoreId,
      toStoreId,
      status,
      lines: lines.map(l => ({
        productId: l.productId,
        productName: l.productName || '',
        productSku: l.productSku || '',
        quantity: l.quantity,
      })),
      note: note?.trim() || null,
      requestedBy: decoded.uid,
      approvedBy: settings.requireApproval ? null : decoded.uid,
      shippedBy: null,
      receivedBy: null,
      createdAt: now,
      approvedAt: settings.requireApproval ? null : now,
      shippedAt: null,
      receivedAt: null,
      rejectionReason: null,
    });

    return NextResponse.json({ success: true, id: ref.id, status });
  } catch (error) {
    console.error('Transfer create error:', error);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
