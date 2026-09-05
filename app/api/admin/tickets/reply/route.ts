import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getSessionClaims } from '@/lib/api/session';
import { notifyUser } from '@/lib/api/notify-role';

/**
 * Répond à un signalement client — réservé SUPER_ADMIN. Enregistre la
 * réponse, passe le ticket en ANSWERED, et prévient réellement le client
 * (alerte in-app ciblée + email) au lieu du silence total d'avant.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSessionClaims();
    if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (session.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Introuvable' }, { status: 404 });
    }

    const { ticketId, message } = (await request.json()) as { ticketId?: string; message?: string };
    if (!ticketId || !message?.trim()) {
      return NextResponse.json({ error: 'Message requis' }, { status: 400 });
    }

    const admin = createServiceRoleClient();
    const { data: ticket, error: ticketError } = await admin
      .from('support_tickets')
      .select('id, tenant_id, user_id, user_name, message')
      .eq('id', ticketId)
      .maybeSingle();
    if (ticketError) throw ticketError;
    if (!ticket) return NextResponse.json({ error: 'Signalement introuvable' }, { status: 404 });

    const { error: replyError } = await admin.from('support_ticket_replies').insert({
      ticket_id: ticketId,
      author_type: 'KAFORA',
      author_name: 'Support Kafora',
      message: message.trim(),
    });
    if (replyError) throw replyError;

    await admin.from('support_tickets').update({ status: 'ANSWERED', updated_at: new Date().toISOString() }).eq('id', ticketId);

    await admin.from('super_admin_logs').insert({
      action: 'TICKET_REPLIED',
      tenant_id: ticket.tenant_id,
      target_email: null,
      reason: message.trim(),
      performed_by: session.uid,
    });

    // Le client n'a pas d'écran dédié pour lire ce fil de discussion : la
    // notification (cloche + email) EST le mécanisme de réponse — voir
    // aussi la faille de ciblage des alertes corrigée juste avant (sans
    // elle, n'importe qui du tenant aurait pu lire cette réponse).
    if (ticket.user_id) {
      await notifyUser(
        ticket.tenant_id,
        ticket.user_id,
        'Réponse à votre signalement',
        message.trim(),
        'SUPPORT_TICKET_REPLY'
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Admin ticket reply error:', error);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
