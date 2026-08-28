import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getSessionClaims } from '@/lib/api/session';
import { notifyUser } from '@/lib/api/notify-role';

// Fix (demande explicite) : suppression réversible plutôt que définitive — voir
// le commentaire détaillé dans app/api/users/delete/route.ts. Même logique ici.
async function performSoftDelete(tenantId: string, uid: string, deletedBy: string) {
  const supabase = createServiceRoleClient();
  await supabase.auth.admin.updateUserById(uid, { ban_duration: '876000h' });
  await supabase
    .from('users')
    .update({ is_active: false, deleted_at: new Date().toISOString(), deleted_by: deletedBy })
    .eq('id', uid)
    .eq('tenant_id', tenantId);
}

const VALID_ACTIONS = ['approve', 'reject', 'delete_now', 'revoke_approval'];

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionClaims();
    if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (session.role !== 'OWNER') {
      return NextResponse.json({ error: 'Réservé au Propriétaire' }, { status: 403 });
    }
    const tenantId = session.tenantId as string;

    const { requestId, action, note } = await request.json();
    if (!requestId || !VALID_ACTIONS.includes(action)) {
      return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });
    }

    const supabase = createServiceRoleClient();
    const { data: reqData } = await supabase
      .from('user_deletion_requests')
      .select('*')
      .eq('id', requestId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (!reqData) return NextResponse.json({ error: 'Demande introuvable' }, { status: 404 });

    // Une approbation peut être retirée tant que l'Admin n'a pas encore
    // finalisé. 'delete_now' reste possible aussi bien avant qu'après
    // approbation (le Propriétaire peut toujours trancher lui-même).
    const allowedFromStatus: Record<string, string[]> = {
      approve: ['PENDING'],
      reject: ['PENDING'],
      revoke_approval: ['APPROVED'],
      delete_now: ['PENDING', 'APPROVED'],
    };
    if (!allowedFromStatus[action].includes(reqData.status)) {
      return NextResponse.json({ error: "Cette demande n'est plus dans un état permettant cette action" }, { status: 400 });
    }

    if (!reqData.requested_by) {
      // Le demandeur a été purgé depuis (colonne passée à NULL) — plus
      // personne à notifier, mais la demande elle-même reste traitable.
      return NextResponse.json({ error: 'Le demandeur associé à cette demande a été purgé' }, { status: 409 });
    }

    if (action === 'reject') {
      await supabase.from('user_deletion_requests').update({
        status: 'REJECTED', resolved_by: session.uid,
        resolved_at: new Date().toISOString(), resolution_note: note || null,
      }).eq('id', requestId);
      await notifyUser(
        tenantId, reqData.requested_by,
        'Demande de suppression refusée',
        `Le Propriétaire a refusé la suppression de ${reqData.target_user_name}.${note ? ` Note : "${note}"` : ''}`
      );
      return NextResponse.json({ success: true });
    }

    if (action === 'revoke_approval') {
      await supabase.from('user_deletion_requests').update({
        status: 'REJECTED', resolved_by: session.uid,
        resolved_at: new Date().toISOString(),
        resolution_note: note || 'Approbation retirée avant finalisation.',
      }).eq('id', requestId);
      await notifyUser(
        tenantId, reqData.requested_by,
        'Approbation retirée',
        `Le Propriétaire est revenu sur son approbation concernant ${reqData.target_user_name} — la suppression n'aura pas lieu.${note ? ` Note : "${note}"` : ''}`
      );
      return NextResponse.json({ success: true });
    }

    if (action === 'approve') {
      await supabase.from('user_deletion_requests').update({
        status: 'APPROVED', resolved_by: session.uid,
        resolved_at: new Date().toISOString(), resolution_note: note || null,
      }).eq('id', requestId);
      await notifyUser(
        tenantId, reqData.requested_by,
        'Demande de suppression approuvée',
        `Le Propriétaire a approuvé la suppression de ${reqData.target_user_name}. Vous pouvez maintenant la finaliser depuis la fiche utilisateur.`
      );
      return NextResponse.json({ success: true });
    }

    // action === 'delete_now' : le Propriétaire traite directement, sans (ou sans plus) attendre l'Admin
    await performSoftDelete(tenantId, reqData.target_user_id, session.uid);
    await supabase.from('user_deletion_requests').update({
      status: 'COMPLETED', resolved_by: session.uid,
      resolved_at: new Date().toISOString(), resolution_note: note || null,
      completed_at: new Date().toISOString(),
    }).eq('id', requestId);
    await notifyUser(
      tenantId, reqData.requested_by,
      'Suppression traitée directement par le Propriétaire',
      `Le Propriétaire a désactivé lui-même le compte de ${reqData.target_user_name}. Aucune action supplémentaire n'est nécessaire de votre part.`
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Deletion request response error:', error);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
