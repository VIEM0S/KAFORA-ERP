import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getSessionClaims } from '@/lib/api/session';

/** Marque un signalement comme clos, sans réponse (doublon, déjà réglé de vive voix...). */
export async function POST(request: NextRequest) {
  try {
    const session = await getSessionClaims();
    if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (session.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Introuvable' }, { status: 404 });
    }

    const { ticketId } = (await request.json()) as { ticketId?: string };
    if (!ticketId) return NextResponse.json({ error: 'Ticket manquant' }, { status: 400 });

    const admin = createServiceRoleClient();
    const { error } = await admin
      .from('support_tickets')
      .update({ status: 'CLOSED', updated_at: new Date().toISOString() })
      .eq('id', ticketId);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Admin ticket close error:', error);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
