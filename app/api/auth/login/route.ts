import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server';
import { checkRateLimit, getClientIp } from '@/lib/api/rate-limit';

/**
 * Appelée par le client juste après supabase.auth.signInWithPassword() —
 * contrairement à Firebase, Supabase établit déjà la session (cookies) au
 * moment du signInWithPassword côté client. Cette route n'a donc plus à
 * "fabriquer" une session : son rôle est de résoudre le profil (tenant,
 * magasins, abonnement), resynchroniser app_metadata si besoin, et logguer
 * la connexion — exactement la logique métier qui vivait ici avec Firebase,
 * simplement débarrassée de la fabrication du cookie de session.
 */
export async function POST(request: NextRequest) {
  try {
    const rateLimit = await checkRateLimit(`login:${getClientIp(request)}`, 15, 5 * 60);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Trop de tentatives. Réessayez dans quelques minutes.' },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } }
      );
    }

    const supabaseServer = await createServerSupabaseClient();
    const { data: authData, error: authErr } = await supabaseServer.auth.getUser();
    if (authErr || !authData.user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }
    const uid = authData.user.id;
    const currentClaims = (authData.user.app_metadata ?? {}) as {
      tenant_id?: string | null; role?: string; store_ids?: string[] | null;
    };

    const supabase = createServiceRoleClient();

    // ─── Compte éditeur (SUPER_ADMIN) ────────────────────────────────────────
    // Un super-admin n'appartient à AUCUN tenant : son profil vit dans
    // super_admins, en dehors de l'arborescence des clients — même
    // séparation qu'avec _super_admin aujourd'hui, pour la même raison
    // (éviter qu'il apparaisse dans sa propre liste de clients).
    const { data: userProfile } = await supabase
      .from('users')
      .select('*')
      .eq('id', uid)
      .maybeSingle();

    if (!userProfile) {
      const { data: sa } = await supabase
        .from('super_admins')
        .select('*')
        .eq('id', uid)
        .maybeSingle();

      if (sa && sa.is_active !== false) {
        const claimsUpdated = currentClaims.role !== 'SUPER_ADMIN' || currentClaims.tenant_id != null;
        if (claimsUpdated) {
          await supabase.auth.admin.updateUserById(uid, {
            app_metadata: { tenant_id: null, role: 'SUPER_ADMIN', store_ids: null },
          });
        }

        return NextResponse.json({
          user: {
            id: uid,
            email: sa.email || authData.user.email || '',
            firstName: sa.first_name || 'Administration',
            lastName: sa.last_name || 'Kafora',
            role: 'SUPER_ADMIN',
            tenantId: null,
            isActive: true,
          },
          tenant: null,
          stores: [],
          claimsUpdated,
        });
      }

      return NextResponse.json({ error: 'Profil utilisateur introuvable' }, { status: 404 });
    }

    if (!userProfile.is_active) {
      return NextResponse.json({ error: 'Compte désactivé' }, { status: 403 });
    }

    const tenantId = userProfile.tenant_id as string;

    const { data: tenant } = await supabase.from('tenants').select('*').eq('id', tenantId).maybeSingle();
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant introuvable' }, { status: 404 });
    }
    if (tenant.is_active === false) {
      return NextResponse.json(
        { error: "L'accès à votre espace Kafora est suspendu. Contactez votre fournisseur." },
        { status: 403 }
      );
    }

    const { data: allStores } = await supabase
      .from('stores')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_active', true);

    // Cloisonnement : filtré ICI côté serveur, comme aujourd'hui — l'interface
    // ne doit jamais proposer un magasin dont les données seront de toute
    // façon refusées par RLS. store_ids null = accès à tous (direction).
    const allowed = userProfile.store_ids as string[] | null;
    const stores = Array.isArray(allowed)
      ? (allStores ?? []).filter((s) => allowed.includes(s.id))
      : (allStores ?? []);

    const { data: subscription } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    // Les claims viennent-elles de changer ? Le JWT que le client détient
    // encore porte les ANCIENNES valeurs — on le signale pour qu'il rafraîchisse
    // sa session et rejoue la connexion, sinon un changement de rôle ne
        // prendrait effet qu'à la connexion SUIVANTE.
    const claimsUpdated =
      currentClaims.tenant_id !== tenantId ||
      currentClaims.role !== userProfile.role ||
      JSON.stringify(currentClaims.store_ids ?? null) !== JSON.stringify(userProfile.store_ids ?? null);

    if (claimsUpdated) {
      await supabase.auth.admin.updateUserById(uid, {
        app_metadata: { tenant_id: tenantId, role: userProfile.role, store_ids: userProfile.store_ids ?? null },
      });
    }

    await supabase.from('users').update({ last_login_at: new Date().toISOString() }).eq('id', uid);

    await supabase.from('audit_logs').insert({
      tenant_id: tenantId,
      user_id: uid,
      action: 'LOGIN',
      entity: 'users',
      entity_id: uid,
    });

    return NextResponse.json({
      user: userProfile,
      tenant: { ...tenant, subscription: subscription ?? null },
      stores,
      claimsUpdated,
    });
  } catch (error: unknown) {
    console.error('❌ Login error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
