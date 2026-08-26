import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getSessionClaims } from '@/lib/api/session';
import { writeAuditLog } from '@/lib/supabase/audit-log';

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionClaims();
    if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    const tenantId = session.tenantId as string;

    const { requestId } = await request.json();
    if (!requestId) return NextResponse.json({ error: 'Champ manquant' }, { status: 400 });

    const supabase = createServiceRoleClient();
    const { data: reqData } = await supabase
      .from('user_deletion_requests')
      .select('*')
      .eq('id', requestId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (!reqData) return NextResponse.json({ error: 'Demande introuvable' }, { status: 404 });

    // Seul l'Admin qui a fait la demande peut la retirer lui-même — possible
    // tant que ce n'est pas déjà finalisé (le compte n'a pas encore été touché).
    if (reqData.requested_by !== session.uid) {
      return NextResponse.json({ error: 'Cette demande ne vous appartient pas' }, { status: 403 });
    }
    if (!['PENDING', 'APPROVED'].includes(reqData.status)) {
      return NextResponse.json({ error: "Cette demande n'est plus dans un état permettant l'annulation" }, { status: 400 });
    }

    await supabase
      .from('user_deletion_requests')
      .update({
        status: 'REJECTED',
        resolved_by: session.uid,
        resolved_at: new Date().toISOString(),
        resolution_note: "Retirée par l'Admin demandeur.",
      })
      .eq('id', requestId);

    // Le Propriétaire est informé que la demande n'a plus lieu d'être suivie.
    await supabase.from('alerts').insert({
      tenant_id: tenantId,
      type: 'USER_DELETION_RESOLVED',
      severity: 'LOW',
      title: 'Demande de suppression retirée',
      message: `Un administrateur a retiré sa demande concernant ${reqData.target_user_name}.`,
      reference: 'users',
      reference_id: reqData.target_user_id,
      target_role: 'OWNER',
    });

    await writeAuditLog({
      tenantId, userId: session.uid, action: 'DELETION_REQUEST_REJECTED',
      entity: 'users', entityId: reqData.target_user_id,
      details: `${reqData.target_user_name} — retirée par le demandeur lui-même`,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Cancel deletion request error:', error);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
