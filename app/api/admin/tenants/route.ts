import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getSessionClaims } from '@/lib/api/session';
import { getSubscriptionState, daysUntilFullBlock } from '@/lib/subscription/status';
import { SUBSCRIPTION_PLANS } from '@/lib/constants';

/** Tarifs mensuels affichés, pour la projection de revenu. */
const PLAN_PRICES: Record<string, number> = Object.fromEntries(
  Object.entries(SUBSCRIPTION_PLANS).map(([id, p]) => [id, (p as { price: number }).price])
);

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
    const session = await getSessionClaims();
    if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (session.role !== 'SUPER_ADMIN') {
      // Volontairement identique à une route inexistante : inutile de
      // signaler à un curieux qu'une console éditeur existe.
      return NextResponse.json({ error: 'Introuvable' }, { status: 404 });
    }

    const supabase = createServiceRoleClient();

    const { data: tenants, error: tenantsError } = await supabase
      .from('tenants')
      .select('id, name, is_active, suspension_reason, terms_acceptance, email, phone, city, created_at');
    if (tenantsError) throw tenantsError;

    const tenantIds = (tenants ?? []).map(t => t.id);
    const { data: subs, error: subsError } = await supabase
      .from('subscriptions')
      .select('tenant_id, plan, status, trial_ends_at, current_period_end')
      .in('tenant_id', tenantIds.length > 0 ? tenantIds : ['00000000-0000-0000-0000-000000000000']);
    if (subsError) throw subsError;
    const subByTenant = new Map((subs ?? []).map(s => [s.tenant_id, s]));

    const rows = await Promise.all(
      (tenants ?? []).map(async t => {
        const sub = subByTenant.get(t.id) ?? null;

        // Comptages par agrégation : bien moins coûteux que de lire les
        // lignes elles-mêmes, ce qui compte quand la liste s'allonge.
        const [users, stores, sales] = await Promise.all([
          supabase.from('users').select('*', { count: 'exact', head: true }).eq('tenant_id', t.id),
          supabase.from('stores').select('*', { count: 'exact', head: true }).eq('tenant_id', t.id),
          supabase.from('sales').select('*', { count: 'exact', head: true }).eq('tenant_id', t.id),
        ]);

        // Dernière vente : sert d'indicateur d'activité réelle. Un client qui
        // n'encaisse plus depuis trois semaines est un client qui part —
        // c'est l'information la plus utile pour décider qui rappeler.
        const { data: lastSale } = await supabase
          .from('sales')
          .select('created_at')
          .eq('tenant_id', t.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        return {
          id: t.id,
          name: t.name || '(sans nom)',
          isActive: t.is_active !== false,
          suspensionReason: t.suspension_reason || null,
          // Preuve d'acceptation des conditions : inutile de l'enregistrer
          // si on ne peut pas la consulter le jour où elle sert.
          termsAcceptance: t.terms_acceptance ?? null,
          email: t.email || null,
          phone: t.phone || null,
          city: t.city || null,
          createdAt: t.created_at ?? null,
          plan: sub?.plan ?? null,
          status: sub?.status ?? null,
          state: getSubscriptionState(sub),
          daysLeft: daysUntilFullBlock(sub),
          currentPeriodEnd: sub?.current_period_end ?? null,
          userCount: users.count ?? null,
          storeCount: stores.count ?? null,
          saleCount: sales.count ?? null,
          lastSaleAt: lastSale?.created_at ?? null,
        };
      })
    );

    // Les comptes les plus proches de l'expiration en premier : c'est l'ordre
    // dans lequel on veut agir, pas l'ordre alphabétique.
    rows.sort((a, b) => (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999));

    // ─── Agrégats plateforme ─────────────────────────────────────────────────
    // Calculés à partir des lignes déjà chargées : aucune requête
    // supplémentaire.
    const paidStates = rows.filter(r => r.status === 'ACTIVE');
    const stats = {
      tenantCount: rows.length,
      activeCount: rows.filter(r => r.isActive).length,
      suspendedCount: rows.filter(r => !r.isActive).length,
      userCount: rows.reduce((a, r) => a + (r.userCount || 0), 0),
      activeSubscriptions: paidStates.length,
      trialCount: rows.filter(r => r.status === 'TRIAL').length,
      expiringSoon: rows.filter(r => r.daysLeft !== null && r.daysLeft <= 7).length,
      // Revenu mensuel récurrent : somme des tarifs affichés des forfaits des
      // clients dont l'abonnement est ACTIF. C'est une PROJECTION, pas de
      // l'encaissé — un client peut être actif sans avoir encore payé le mois
      // en cours. Le réel se lit dans subscription_payments.
      mrrProjected: paidStates.reduce((a, r) => a + (PLAN_PRICES[r.plan || ''] || 0), 0),
    };

    return NextResponse.json({ tenants: rows, stats });
  } catch (error) {
    console.error('Admin tenants error:', error);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
