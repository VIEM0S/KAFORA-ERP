import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import { cookies } from 'next/headers';
import { getSubscriptionState, daysUntilFullBlock } from '@/lib/subscription/status';

/**
 * Console éditeur : liste de TOUS les clients (tenants).
 *
 * C'est la seule route de l'application qui traverse volontairement
 * l'isolation multi-tenant. Elle est donc réservée au rôle SUPER_ADMIN, qui
 * ne peut PAS être attribué depuis l'application (la création d'utilisateur
 * n'autorise que ADMIN/MANAGER/CASHIER) : il doit être posé à la main sur le
 * compte, ce qui est précisément la garantie recherchée ici.
 */
export async function GET(_request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('__session')?.value;
    if (!sessionCookie) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const decoded = await adminAuth.verifySessionCookie(sessionCookie, true);
    if (decoded.role !== 'SUPER_ADMIN') {
      // Volontairement identique à une route inexistante : inutile de
      // signaler à un curieux qu'une console éditeur existe.
      return NextResponse.json({ error: 'Introuvable' }, { status: 404 });
    }

    const tenantsSnap = await adminDb.collection('tenants').get();

    const rows = await Promise.all(
      tenantsSnap.docs.map(async doc => {
        const t = doc.data();

        // Abonnement : document à identifiant déterministe (= tenantId).
        const subSnap = await adminDb.doc(`tenants/${doc.id}/subscriptions/${doc.id}`).get();
        const sub = subSnap.exists ? subSnap.data() : null;

        // Comptages par agrégation : bien moins coûteux que de lire les
        // documents, ce qui compte quand la liste s'allonge.
        const [users, stores, sales] = await Promise.all([
          adminDb.collection(`tenants/${doc.id}/users`).count().get().catch(() => null),
          adminDb.collection(`tenants/${doc.id}/stores`).count().get().catch(() => null),
          adminDb.collection(`tenants/${doc.id}/sales`).count().get().catch(() => null),
        ]);

        // Dernière vente : sert d'indicateur d'activité réelle. Un client qui
        // n'encaisse plus depuis trois semaines est un client qui part —
        // c'est l'information la plus utile pour décider qui rappeler.
        const lastSaleSnap = await adminDb
          .collection(`tenants/${doc.id}/sales`)
          .orderBy('createdAt', 'desc')
          .limit(1)
          .get()
          .catch(() => null);

        const lastSaleAt =
          lastSaleSnap && !lastSaleSnap.empty
            ? lastSaleSnap.docs[0].data().createdAt?.toDate?.()?.toISOString() ?? null
            : null;

        return {
          id: doc.id,
          name: t.name || '(sans nom)',
          email: t.email || null,
          phone: t.phone || null,
          city: t.city || null,
          createdAt: t.createdAt ?? null,
          plan: sub?.plan ?? null,
          status: sub?.status ?? null,
          state: getSubscriptionState(sub),
          daysLeft: daysUntilFullBlock(sub),
          currentPeriodEnd: sub?.currentPeriodEnd ?? null,
          userCount: users?.data().count ?? null,
          storeCount: stores?.data().count ?? null,
          saleCount: sales?.data().count ?? null,
          lastSaleAt,
        };
      })
    );

    // Les comptes les plus proches de l'expiration en premier : c'est l'ordre
    // dans lequel on veut agir, pas l'ordre alphabétique.
    rows.sort((a, b) => (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999));

    return NextResponse.json({ tenants: rows });
  } catch (error) {
    console.error('Admin tenants error:', error);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
