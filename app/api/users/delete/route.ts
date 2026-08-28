import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getSessionClaims } from '@/lib/api/session';
import { notifyRole } from '@/lib/api/notify-role';

// Fix (demande explicite) : une suppression définitive ne laisse aucune place
// à l'erreur — on désactive donc le compte au lieu de le détruire : l'accès
// est bloqué immédiatement (déconnexion forcée, connexion impossible — même
// effet de sécurité qu'une suppression), mais les données restent et un
// Propriétaire peut restaurer le compte à tout moment via /api/users/restore.
async function performSoftDelete(tenantId: string, uid: string, deletedBy: string) {
  const supabase = createServiceRoleClient();
  // ban_duration bloque immédiatement toute nouvelle vérification de session
  // (getUser() interroge le serveur Supabase Auth à chaque requête — voir
  // proxy.ts — qui rejette un compte banni sans délai, contrairement à un
  // jeton simplement laissé à expirer).
  await supabase.auth.admin.updateUserById(uid, { ban_duration: '876000h' }); // ~100 ans, équivalent "disabled"
  await supabase
    .from('users')
    .update({ is_active: false, deleted_at: new Date().toISOString(), deleted_by: deletedBy })
    .eq('id', uid)
    .eq('tenant_id', tenantId);
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionClaims();
    if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    const { uid: callerUid, role: callerRole, tenantId: callerTenantId } = session;
    if (!['OWNER', 'ADMIN'].includes(callerRole)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const { tenantId, uid, reason, requestId } = await request.json();
    if (!tenantId || !uid) {
      return NextResponse.json({ error: 'Champs manquants' }, { status: 400 });
    }
    if (tenantId !== callerTenantId) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }
    if (uid === callerUid) {
      return NextResponse.json({ error: 'Impossible de supprimer votre propre compte' }, { status: 400 });
    }

    const supabase = createServiceRoleClient();
    const { data: existing } = await supabase
      .from('users')
      .select('role, first_name, last_name')
      .eq('id', uid)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (!existing) {
      return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 });
    }
    const targetRole = existing.role;
    const targetName = `${existing.first_name || ''} ${existing.last_name || ''}`.trim() || uid;

    if (targetRole === 'OWNER') {
      return NextResponse.json({ error: 'Impossible de supprimer le Propriétaire' }, { status: 403 });
    }
    if (targetRole === 'ADMIN' && callerRole !== 'OWNER') {
      return NextResponse.json({ error: 'Seul le Propriétaire peut supprimer un Administrateur' }, { status: 403 });
    }

    // ── Cas 1 : le Propriétaire supprime directement — pas de double
    // vérification pour lui. Transparence : les Admins du tenant sont
    // notifiés après coup.
    if (callerRole === 'OWNER') {
      await performSoftDelete(tenantId, uid, callerUid);
      await notifyRole(tenantId, 'ADMIN', {
        type: 'USER_DELETION_RESOLVED', severity: 'MEDIUM',
        title: 'Suppression effectuée par le Propriétaire',
        message: `Le Propriétaire a supprimé le compte de ${targetName} (${targetRole}).`,
      });
      return NextResponse.json({ success: true });
    }

    // ── Cas 2 : un Admin veut supprimer un Manager/Caissier ────────────────
    // Double vérification obligatoire — un Admin ne peut jamais supprimer
    // seul un Manager/Caissier sans validation du Propriétaire.
    if (requestId) {
      // Finalisation d'une demande déjà approuvée par le Propriétaire.
      const { data: reqData } = await supabase
        .from('user_deletion_requests')
        .select('*')
        .eq('id', requestId)
        .eq('tenant_id', tenantId)
        .maybeSingle();
      if (!reqData) return NextResponse.json({ error: 'Demande introuvable' }, { status: 404 });
      if (reqData.requested_by !== callerUid) {
        return NextResponse.json({ error: 'Cette demande ne vous appartient pas' }, { status: 403 });
      }
      if (reqData.status !== 'APPROVED') {
        return NextResponse.json({ error: "Cette demande n'a pas encore été approuvée par le Propriétaire" }, { status: 400 });
      }
      await performSoftDelete(tenantId, uid, callerUid);
      await supabase
        .from('user_deletion_requests')
        .update({ status: 'COMPLETED', completed_at: new Date().toISOString() })
        .eq('id', requestId);
      return NextResponse.json({ success: true });
    }

    // Nouvelle demande de suppression — justification obligatoire.
    if (!reason || typeof reason !== 'string' || reason.trim().length < 5) {
      return NextResponse.json({ error: 'Merci de justifier cette suppression (au moins quelques mots).' }, { status: 400 });
    }
    const { data: newRequest } = await supabase
      .from('user_deletion_requests')
      .insert({
        tenant_id: tenantId,
        target_user_id: uid,
        target_user_name: targetName,
        target_user_role: targetRole,
        requested_by: callerUid,
        justification: reason.trim(),
        status: 'PENDING',
      })
      .select('id')
      .single();

    await notifyRole(tenantId, 'OWNER', {
      type: 'USER_DELETION_REQUEST', severity: 'HIGH',
      title: 'Demande de suppression en attente de votre validation',
      message: `Un administrateur souhaite supprimer le compte de ${targetName} (${targetRole}). Motif : "${reason.trim()}"`,
      referenceId: newRequest?.id,
    });

    return NextResponse.json({ success: true, pending: true, requestId: newRequest?.id });
  } catch (error) {
    console.error('Delete user error:', error);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
