import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb, adminRtdb } from '@/lib/firebase/admin';
import { Timestamp } from 'firebase-admin/firestore';
import { cookies } from 'next/headers';
import { RTDB_PATHS } from '@/lib/firebase/rtdb';

export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('__session')?.value;
    if (!sessionCookie) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const decoded = await adminAuth.verifySessionCookie(sessionCookie, true);
    const callerTenantId = decoded.tenantId as string;
    const callerUid = decoded.uid as string;
    const callerStoreIds = decoded.storeIds as string[] | null | undefined;

    const {
      tenantId, storeId, registerId,
      countedAmount, notes, closedByName,
    } = await request.json();

    if (!tenantId || !storeId || !registerId || countedAmount === undefined) {
      return NextResponse.json({ error: 'Champs manquants' }, { status: 400 });
    }
    if (tenantId !== callerTenantId) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    // Cloisonnement magasin (même contrôle que /api/pos/checkout) : sans ça,
    // un caissier affecté au magasin A pouvait forger une requête et clôturer
    // la caisse du magasin B — contournant le cloisonnement appliqué partout
    // ailleurs. `storeIds` absent ou null = accès à tous (direction).
    if (Array.isArray(callerStoreIds) && !callerStoreIds.includes(storeId)) {
      return NextResponse.json(
        { error: "Vous n'avez pas accès à ce magasin" },
        { status: 403 }
      );
    }

    // ── Session RTDB = source de vérité, jamais le corps de la requête ──────
    // openingBalance/openedBy/openedAt viennent de la caisse ouverte en RTDB,
    // pas du client : sinon un caissier pourrait appeler cette route hors UI
    // avec un openingBalance falsifié pour masquer un manque de caisse.
    const rtdbPath = RTDB_PATHS.cashRegister(tenantId, registerId);
    const liveSnap = await adminRtdb.ref(rtdbPath).get();
    if (!liveSnap.exists()) {
      return NextResponse.json({ error: 'Aucune caisse ouverte trouvée' }, { status: 404 });
    }
    const liveSession = liveSnap.val() as {
      status?: string; openedBy?: string; openedByName?: string;
      openedAt?: number; openingBalance?: number;
    };
    if (liveSession.status !== 'OPEN') {
      return NextResponse.json({ error: 'Cette caisse est déjà fermée' }, { status: 409 });
    }
    const openedBy = liveSession.openedBy ?? null;
    const openedByName = liveSession.openedByName ?? null;
    const openedAt = liveSession.openedAt ?? null;
    const openingBalance = liveSession.openingBalance ?? 0;

    // ── Recalcul serveur des ventes du jour pour ce magasin ──────────────────
    // On ne fait JAMAIS confiance aux totaux envoyés par le client : on les
    // recalcule ici à partir des vraies ventes Firestore, pour empêcher un
    // caissier de masquer un manque de caisse en trafiquant la "différence".
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    // Fenêtre de la SESSION, pas de la journée.
    //
    // Partir du début de journée était faux dès la deuxième session : une
    // caisse ouverte l'après-midi se voyait imputer les ventes du matin,
    // déjà comptées à la clôture précédente. Le caissier de l'après-midi
    // apparaissait alors gravement en manque.
    const sessionStart = openedAt ? new Date(openedAt) : startOfDay;

    const salesSnap = await adminDb
      .collection(`tenants/${tenantId}/sales`)
      .where('storeId', '==', storeId)
      .where('createdAt', '>=', Timestamp.fromDate(sessionStart))
      .get();

    let salesTotal = 0;
    let cashSalesTotal = 0;
    let acompteTotal = 0;
    let txCount = 0;
    salesSnap.forEach((docSnap) => {
      const sale = docSnap.data();
      // Une vente annulée a été remboursée : la compter ferait apparaître un
      // manquant au caissier pour une erreur qui n'est pas la sienne.
      if ((sale.status || 'COMPLETED') !== 'COMPLETED') return;

      const total = Number(sale.total) || 0;
      salesTotal += total;
      txCount += 1;

      const method = sale.paymentMethod || 'CASH';
      if (method === 'CASH') {
        cashSalesTotal += total;
      } else if (method === 'CREDIT') {
        // L'acompte versé sur une vente à crédit est de l'argent RÉELLEMENT
        // dans le tiroir, même si la vente n'est pas de type « espèces ».
        acompteTotal += Number(sale.acompte) || 0;
      }
    });

    // Règlements de dettes encaissés pendant la session : un client venu
    // payer dépose de l'argent dans ce tiroir.
    let creditRepaymentTotal = 0;
    try {
      const paySnap = await adminDb
        .collectionGroup('credit_payments')
        .where('storeId', '==', storeId)
        .where('createdAt', '>=', Timestamp.fromDate(sessionStart))
        .get();
      paySnap.forEach(d => {
        const p = d.data();
        if ((p.paymentMethod || 'CASH') === 'CASH') {
          creditRepaymentTotal += Number(p.montant) || 0;
        }
      });
    } catch {
      // Index absent ou versements antérieurs sans magasin : on n'empêche
      // pas la clôture, mais le montant reste à 0 (voir la note ci-dessous).
    }

    // Remboursements rendus en espèces : cet argent est SORTI du tiroir.
    let cashRefundTotal = 0;
    try {
      const retSnap = await adminDb
        .collection(`tenants/${tenantId}/sale_returns`)
        .where('storeId', '==', storeId)
        .where('createdAt', '>=', Timestamp.fromDate(sessionStart))
        .get();
      retSnap.forEach(d => {
        const r = d.data();
        if ((r.refundMethod || 'CASH') !== 'CASH') return;
        // `cashRefund` = part réellement sortie du tiroir ; le reste a servi
        // à effacer une dette et n'a jamais quitté la caisse.
        cashRefundTotal += Number(r.cashRefund ?? r.refundAmount) || 0;
      });
    } catch {
      // idem
    }

    const openingBal = Number(openingBalance) || 0;
    const counted = Number(countedAmount) || 0;

    // MÊME FORMULE que celle affichée au caissier pendant la session
    // (app/(dashboard)/cash-register/page.tsx). Toute divergence entre les
    // deux serait pire que l'absence de contrôle : le caissier verrait un
    // montant à l'écran et s'en verrait reprocher un autre à la clôture.
    const expectedBalance =
      openingBal + cashSalesTotal + acompteTotal + creditRepaymentTotal - cashRefundTotal;
    const difference = counted - expectedBalance;

    // ── Anti double clôture ──────────────────────────────────────────────────
    //
    // Sans ce contrôle, un double clic ou un réseau lent produisait DEUX
    // sessions clôturées pour la même ouverture, chacune avec son écart. Le
    // responsable se retrouvait avec deux manquants pour une seule journée,
    // impossibles à départager.
    //
    // L'ouverture (openedAt + caisse) identifie la session de façon unique.
    //
    // ENTOURÉ D'UN try/catch : cette requête exige un index composite. S'il
    // n'est pas déployé, l'exception remontait et faisait échouer TOUTE la
    // clôture avec une erreur 500 illisible. Un caissier ne doit jamais se
    // retrouver dans l'impossibilité de fermer sa caisse à cause d'un
    // problème d'infrastructure : en cas d'échec du contrôle, on laisse
    // passer et on journalise.
    let existing: { empty: boolean; docs: { id: string; data: () => Record<string, unknown> }[] } | null = null;
    if (openedAt) {
      try {
        existing = await adminDb
          .collection(`tenants/${tenantId}/cash_sessions`)
          .where('registerId', '==', registerId)
          .where('openedAt', '==', openedAt)
          .limit(1)
          .get();
      } catch (err) {
        console.warn('Contrôle anti double clôture indisponible (index manquant ?)', err);
      }
    }
    if (existing && !existing.empty) {
      {
        const prev = existing.docs[0].data();
        return NextResponse.json(
          {
            error: 'Cette session de caisse a déjà été clôturée.',
            id: existing.docs[0].id,
            expectedBalance: prev.expectedBalance,
            difference: prev.difference,
            alreadyClosed: true,
          },
          { status: 409 }
        );
      }
    }

    const docRef = await adminDb.collection(`tenants/${tenantId}/cash_sessions`).add({
      tenantId, storeId, registerId,
      openedBy: openedBy || null,
      openedByName: openedByName || null,
      openedAt: openedAt || null,
      openingBalance: openingBal,
      closedBy: callerUid,
      closedByName: closedByName || null,
      closedAt: Date.now(),
      closingBalance: counted,
      expectedBalance,
      // Détail conservé : un écart contesté six mois plus tard doit pouvoir
      // être reconstitué sans relire toutes les ventes.
      cashSalesTotal,
      acompteTotal,
      creditRepaymentTotal,
      cashRefundTotal,
      difference,
      salesCount: txCount,
      salesTotal,
      notes: notes || null,
      createdAt: new Date().toISOString(),
    });

    // ── Marquer la caisse RTDB comme fermée côté serveur (source de vérité) ──
    // Le client refait aussi ce `set` après coup ; on le fait déjà ici pour
    // que l'état soit cohérent même si l'appel client échoue après ce point.
    await adminRtdb.ref(rtdbPath).set({ status: 'CLOSED', closedAt: Date.now() });

    return NextResponse.json({ success: true, id: docRef.id, expectedBalance, difference, cashSalesTotal, salesTotal, txCount });
  } catch (error) {
    console.error('Close cash register error:', error);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
