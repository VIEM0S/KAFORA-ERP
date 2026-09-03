import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient, createServerSupabaseClient } from '@/lib/supabase/server';
import { getSessionClaims } from '@/lib/api/session';
import { notifyUser } from '@/lib/api/notify-role';
import { formatCurrency } from '@/lib/utils/helpers';

// Le RPC est appelé via createServerSupabaseClient() (JWT de l'appelant),
// pas le service-role — voir le commentaire détaillé dans
// app/api/credits/write-off/route.ts pour le pourquoi.
export async function POST(request: NextRequest) {
  try {
    const session = await getSessionClaims();
    if (!session || !session.tenantId) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const { creditId }: { creditId?: string } = await request.json();
    if (!creditId) return NextResponse.json({ error: 'Crédit manquant' }, { status: 400 });

    const admin = createServiceRoleClient();
    const { data: user } = await admin.from('users').select('first_name, last_name').eq('id', session.uid).maybeSingle();
    const userName = user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : '';

    const asUser = await createServerSupabaseClient();
    const { data, error } = await asUser.rpc('approve_credit_write_off', {
      p_credit_id: creditId,
      p_user_name: userName,
    });
    if (error) throw error;
    const result = data as unknown as { success: boolean; requestedBy: string | null; amount: number };

    try {
      const { data: credit } = await admin.from('credits').select('customer_name').eq('id', creditId).maybeSingle();
      if (result.requestedBy) {
        await notifyUser(
          session.tenantId, result.requestedBy,
          `Annulation de crédit validée — ${credit?.customer_name || 'client'}`,
          `${userName || 'Le siège'} a validé l'annulation de ${formatCurrency(result.amount)} pour ${credit?.customer_name || 'ce client'}.`
        );
      }
    } catch (e) {
      console.error('write-off approve notify error:', e);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Credit write-off approve error:', error);
    const msg = error instanceof Error ? error.message : 'Erreur interne';
    const isKnown = /(FORBIDDEN|NOT_FOUND|INVALID_STATUS):/.test(msg);
    const cleanMsg = msg.replace(/^.*(FORBIDDEN|NOT_FOUND|INVALID_STATUS):\s*/, '');
    return NextResponse.json(
      { error: isKnown ? cleanMsg : "Erreur lors de la validation" },
      { status: isKnown ? 409 : 500 }
    );
  }
}
