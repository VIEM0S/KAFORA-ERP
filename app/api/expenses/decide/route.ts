import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient, createServerSupabaseClient } from '@/lib/supabase/server';
import { getSessionClaims } from '@/lib/api/session';
import { notifyUser } from '@/lib/api/notify-role';
import { formatCurrency } from '@/lib/utils/helpers';
import { getErrorMessage } from '@/lib/utils/errors';

const KNOWN = /(FORBIDDEN|NOT_FOUND|INVALID_INPUT|INVALID_STATUS):/;

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionClaims();
    if (!session || !session.tenantId) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const { expenseId, approve, note }: { expenseId?: string; approve?: boolean; note?: string } = await request.json();
    if (!expenseId || typeof approve !== 'boolean') {
      return NextResponse.json({ error: 'Champs manquants' }, { status: 400 });
    }

    const admin = createServiceRoleClient();
    const { data: user } = await admin.from('users').select('first_name, last_name').eq('id', session.uid).maybeSingle();
    const userName = user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : '';

    const asUser = await createServerSupabaseClient();
    const { data, error } = await asUser.rpc('decide_expense', {
      p_expense_id: expenseId,
      p_approve: approve,
      p_note: note?.trim() || '',
      p_user_name: userName,
    });
    if (error) throw error;
    const result = data as unknown as { success: boolean; createdBy: string | null; amount: number; description: string };

    // Prévient l'auteur de la demande (best-effort, la décision est déjà prise).
    if (result.createdBy) {
      try {
        await notifyUser(
          session.tenantId, result.createdBy,
          approve ? `Dépense validée — ${formatCurrency(result.amount)}` : `Dépense refusée — ${formatCurrency(result.amount)}`,
          approve
            ? `${userName || 'Le siège'} a validé votre dépense « ${result.description} ».`
            : `${userName || 'Le siège'} a refusé votre dépense « ${result.description} »${note?.trim() ? ` : ${note.trim()}` : '.'}`,
          'EXPENSE_DECIDED', 'expenses'
        );
      } catch (e) {
        console.error('expense decision notify error:', e);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Decide expense error:', error);
    const msg = getErrorMessage(error) || 'Erreur interne';
    const isKnown = KNOWN.test(msg);
    return NextResponse.json(
      { error: isKnown ? msg.replace(/^.*(FORBIDDEN|NOT_FOUND|INVALID_INPUT|INVALID_STATUS):\s*/, '') : 'Erreur lors de la décision' },
      { status: isKnown ? 409 : 500 }
    );
  }
}
