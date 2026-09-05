import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getSessionClaims } from '@/lib/api/session';

/** Fil de réponses d'un signalement — réservé SUPER_ADMIN. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSessionClaims();
    if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (session.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Introuvable' }, { status: 404 });
    }

    const { id } = await params;
    const admin = createServiceRoleClient();
    const { data, error } = await admin
      .from('support_ticket_replies')
      .select('id, author_type, author_name, message, created_at')
      .eq('ticket_id', id)
      .order('created_at', { ascending: true });
    if (error) throw error;

    return NextResponse.json({
      replies: (data ?? []).map(r => ({
        id: r.id, authorType: r.author_type, authorName: r.author_name,
        message: r.message, createdAt: r.created_at,
      })),
    });
  } catch (error) {
    console.error('Admin ticket replies error:', error);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
