import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getSessionClaims } from '@/lib/api/session';
import { writeAuditLog } from '@/lib/supabase/audit-log';
import { isSubsetOf, REGIONAL_MANAGER_ASSIGNABLE_ROLES } from '@/lib/api/regional-scope';
import type { Database } from '@/lib/supabase/database.types';

type UserUpdate = Database['public']['Tables']['users']['Update'];

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionClaims();
    if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    const { uid: callerUid, role: callerRole, tenantId: callerTenantId, storeIds: callerStoreIds } = session;
    if (!['OWNER', 'ADMIN', 'REGIONAL_MANAGER'].includes(callerRole)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const { tenantId, uid, email, firstName, lastName, phone, role, newPassword, workingHours, storeIds } = await request.json();
    if (!tenantId || !uid) {
      return NextResponse.json({ error: 'Champs manquants' }, { status: 400 });
    }
    if (tenantId !== callerTenantId) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const supabase = createServiceRoleClient();
    const { data: existing } = await supabase
      .from('users')
      .select('role, store_ids')
      .eq('id', uid)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (!existing) {
      return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 });
    }

    // On ne modifie jamais le compte OWNER via cette route
    if (existing.role === 'OWNER') {
      return NextResponse.json({ error: "Impossible de modifier le Propriétaire" }, { status: 403 });
    }
    if (role && !['ADMIN', 'REGIONAL_MANAGER', 'MANAGER', 'CASHIER'].includes(role)) {
      return NextResponse.json({ error: 'Rôle invalide' }, { status: 400 });
    }
    // Un responsable régional ne touche que du personnel de terrain déjà
    // affecté à SES magasins.
    if (callerRole === 'REGIONAL_MANAGER') {
      if (!REGIONAL_MANAGER_ASSIGNABLE_ROLES.includes((existing.role || '') as 'MANAGER' | 'CASHIER')) {
        return NextResponse.json({ error: 'Ce compte ne relève pas de votre gestion' }, { status: 403 });
      }
      if (role && !REGIONAL_MANAGER_ASSIGNABLE_ROLES.includes(role)) {
        return NextResponse.json({ error: 'Vous ne pouvez attribuer que le rôle Responsable ou Caissier' }, { status: 403 });
      }
      if (!isSubsetOf(existing.store_ids, callerStoreIds)) {
        return NextResponse.json({ error: 'Ce compte ne relève pas de votre gestion' }, { status: 403 });
      }
    }
    if (callerRole !== 'OWNER') {
      if (role === 'ADMIN') {
        return NextResponse.json({ error: 'Seul le Propriétaire peut promouvoir un compte au rang d\'Administrateur' }, { status: 403 });
      }
      if (existing.role === 'ADMIN') {
        return NextResponse.json({ error: 'Seul le Propriétaire peut modifier un compte Administrateur' }, { status: 403 });
      }
    }
    if (newPassword && newPassword.length < 8) {
      return NextResponse.json({ error: 'Mot de passe : 8 caractères minimum' }, { status: 400 });
    }

    // ─── Affectation aux magasins ────────────────────────────────────────────
    const finalRole = role || existing.role;
    let claimStoreIds: string[] | null = existing.store_ids ?? null;

    if (storeIds !== undefined) {
      if (finalRole === 'ADMIN') {
        claimStoreIds = null; // direction : tous les magasins
      } else {
        if (!Array.isArray(storeIds) || storeIds.length === 0) {
          return NextResponse.json(
            { error: 'Sélectionnez au moins un magasin pour cet utilisateur.' },
            { status: 400 }
          );
        }
        const unique = [...new Set(storeIds.filter((v: unknown) => typeof v === 'string' && v))] as string[];
        const { data: foundStores } = await supabase
          .from('stores')
          .select('id')
          .eq('tenant_id', tenantId)
          .in('id', unique);
        if ((foundStores?.length ?? 0) !== unique.length) {
          return NextResponse.json({ error: 'Magasin inconnu' }, { status: 400 });
        }
        claimStoreIds = unique;
      }
    } else if (finalRole === 'ADMIN') {
      claimStoreIds = null;
    }
    if (callerRole === 'REGIONAL_MANAGER' && !isSubsetOf(claimStoreIds, callerStoreIds)) {
      return NextResponse.json({ error: 'Vous ne pouvez affecter que vos propres magasins' }, { status: 403 });
    }

    // 1. Mettre à jour Supabase Auth (email, mot de passe)
    const authUpdate: { email?: string; password?: string } = {};
    if (email) authUpdate.email = email;
    if (newPassword) authUpdate.password = newPassword;
    if (Object.keys(authUpdate).length > 0) {
      const { error: authError } = await supabase.auth.admin.updateUserById(uid, authUpdate);
      if (authError) {
        if (authError.code === 'email_exists') {
          return NextResponse.json({ error: 'Cet email est déjà utilisé' }, { status: 409 });
        }
        throw authError;
      }
    }

    // 2. Reposer app_metadata si le rôle OU l'affectation magasin change.
    //    Sans le second cas, retirer un magasin à un caissier resterait sans
    //    effet sur son token — donc sans effet réel sur ses accès (RLS).
    const roleChanged = Boolean(role && role !== existing.role);
    const storesChanged =
      JSON.stringify(claimStoreIds) !== JSON.stringify(existing.store_ids ?? null);
    if (roleChanged || storesChanged) {
      await supabase.auth.admin.updateUserById(uid, {
        app_metadata: { tenant_id: tenantId, role: finalRole, store_ids: claimStoreIds },
      });
    }
    if (roleChanged) {
      await writeAuditLog({
        tenantId, userId: callerUid, action: 'ROLE_CHANGED',
        entity: 'users', entityId: uid,
        details: `${existing.role || '?'} → ${role}`,
      });
    }

    // 3. Mettre à jour le profil
    const profileUpdate: UserUpdate = {};
    if (firstName) profileUpdate.first_name = firstName;
    if (lastName) profileUpdate.last_name = lastName;
    if (email) profileUpdate.email = email;
    if (phone !== undefined) profileUpdate.phone = phone || null;
    if (role) profileUpdate.role = role;
    if (workingHours !== undefined) profileUpdate.working_hours = workingHours;
    // Le profil doit refléter app_metadata : c'est lui que relit la route de
    // connexion pour resynchroniser la session à chaque connexion.
    if (storesChanged) profileUpdate.store_ids = claimStoreIds;

    if (Object.keys(profileUpdate).length > 0) {
      await supabase.from('users').update(profileUpdate).eq('id', uid);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Update user error:', error);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
