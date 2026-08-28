import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getSessionClaims } from '@/lib/api/session';
import { checkPlanLimit } from '@/lib/supabase/plan-limits';
import { isSubsetOf, REGIONAL_MANAGER_ASSIGNABLE_ROLES } from '@/lib/api/regional-scope';

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionClaims();
    if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    const { role: callerRole, tenantId: callerTenantId, storeIds: callerStoreIds } = session;
    if (!['OWNER', 'ADMIN', 'REGIONAL_MANAGER'].includes(callerRole)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const { tenantId, email, password, firstName, lastName, phone, role, storeIds } = await request.json();
    if (!email || !password || !firstName || !lastName || !role || !tenantId) {
      return NextResponse.json({ error: 'Champs manquants' }, { status: 400 });
    }
    // Seul un contrôle client (create-user-dialog.tsx) existait — un appel
    // direct à l'API pouvait créer un compte avec un mot de passe d'un seul
    // caractère.
    if (password.length < 8) {
      return NextResponse.json({ error: 'Mot de passe : 8 caractères minimum' }, { status: 400 });
    }
    // Isolation multi-tenant : un ADMIN/OWNER ne peut créer un utilisateur que
    // dans son propre tenant, jamais dans un tenant tiers.
    if (tenantId !== callerTenantId) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }
    if (!['ADMIN', 'REGIONAL_MANAGER', 'MANAGER', 'CASHIER'].includes(role)) {
      return NextResponse.json({ error: 'Rôle invalide' }, { status: 400 });
    }
    // Un responsable régional ne crée que du personnel de terrain (Manager /
    // Caissier) — jamais un Admin, ni un autre responsable régional.
    if (callerRole === 'REGIONAL_MANAGER' && !REGIONAL_MANAGER_ASSIGNABLE_ROLES.includes(role)) {
      return NextResponse.json({ error: 'Vous ne pouvez créer que des comptes Responsable ou Caissier' }, { status: 403 });
    }

    const supabase = createServiceRoleClient();

    // ─── Affectation aux magasins ────────────────────────────────────────────
    // ADMIN = fonction de direction : accès à tous les magasins (null).
    // MANAGER / CASHIER = personnel de terrain : affectation explicite exigée.
    let normalizedStoreIds: string[] | null = null;
    if (role !== 'ADMIN') {
      if (!Array.isArray(storeIds) || storeIds.length === 0) {
        return NextResponse.json(
          { error: 'Sélectionnez au moins un magasin pour cet utilisateur.' },
          { status: 400 }
        );
      }
      const unique = [...new Set(storeIds.filter((s: unknown) => typeof s === 'string' && s))] as string[];
      // Les magasins doivent exister ET appartenir au tenant de l'appelant.
      const { data: foundStores } = await supabase
        .from('stores')
        .select('id')
        .eq('tenant_id', tenantId)
        .in('id', unique);
      if ((foundStores?.length ?? 0) !== unique.length) {
        return NextResponse.json({ error: 'Magasin inconnu' }, { status: 400 });
      }
      normalizedStoreIds = unique;
    }
    // Un responsable régional ne peut affecter le nouveau compte qu'à SES
    // propres magasins.
    if (callerRole === 'REGIONAL_MANAGER' && !isSubsetOf(normalizedStoreIds, callerStoreIds)) {
      return NextResponse.json({ error: 'Vous ne pouvez affecter que vos propres magasins' }, { status: 403 });
    }
    // Seul le Propriétaire peut créer un compte Admin.
    if (role === 'ADMIN' && callerRole !== 'OWNER') {
      return NextResponse.json({ error: 'Seul le Propriétaire peut créer un compte Administrateur' }, { status: 403 });
    }

    const limitCheck = await checkPlanLimit(tenantId, 'maxUsers');
    if (!limitCheck.allowed) {
      return NextResponse.json({ error: limitCheck.reason }, { status: 403 });
    }

    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email, password, email_confirm: true,
    });
    if (authError) {
      if (authError.code === 'email_exists') {
        return NextResponse.json({ error: 'Cet email est déjà utilisé' }, { status: 409 });
      }
      throw authError;
    }
    const uid = authData.user.id;

    const { error: insertError } = await supabase.from('users').insert({
      id: uid,
      tenant_id: tenantId,
      email,
      first_name: firstName,
      last_name: lastName,
      phone: phone || null,
      role,
      // null = accès à tous les magasins (direction) ; tableau = accès limité.
      store_ids: normalizedStoreIds,
      is_active: true,
    });
    if (insertError) {
      await supabase.auth.admin.deleteUser(uid).catch(() => {});
      throw insertError;
    }

    // storeIds va dans app_metadata : c'est ainsi que RLS vérifie l'accès
    // magasin sans lire le profil à chaque requête.
    await supabase.auth.admin.updateUserById(uid, {
      app_metadata: { tenant_id: tenantId, role, store_ids: normalizedStoreIds },
    });

    return NextResponse.json({ success: true, uid });
  } catch (error) {
    console.error('Create user error:', error);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
