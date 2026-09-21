import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient, createServerSupabaseClient } from '@/lib/supabase/server';
import { getSessionClaims } from '@/lib/api/session';
import { notifyRole } from '@/lib/api/notify-role';
import { formatCurrency } from '@/lib/utils/helpers';
import { getErrorMessage } from '@/lib/utils/errors';

// Même schéma que /api/credits/write-off : la RPC est appelée avec le JWT de
// l'appelant (create_expense() vérifie auth_role()/auth_tenant_id(), vides sous
// service-role) ; le service-role ne sert qu'aux lectures annexes et à
// notifyRole(), qui exige un contexte serveur (SendGrid).
const KNOWN = /(FORBIDDEN|NOT_FOUND|INVALID_INPUT|INVALID_STATUS):/;

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionClaims();
    if (!session || !session.tenantId) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const body: { storeId?: string; category?: string; amount?: number; description?: string; expenseDate?: string } =
      await request.json();
    if (!body.storeId || !body.category || typeof body.amount !== 'number' || !body.description?.trim()) {
      return NextResponse.json({ error: 'Champs manquants' }, { status: 400 });
    }

    const admin = createServiceRoleClient();
    const { data: user } = await admin.from('users').select('first_name, last_name').eq('id', session.uid).maybeSingle();
    const userName = user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : '';

    const asUser = await createServerSupabaseClient();
    const { data, error } = await asUser.rpc('create_expense', {
      p_store_id: body.storeId,
      p_category: body.category,
      p_amount: body.amount,
      p_description: body.description.trim(),
      p_expense_date: body.expenseDate || new Date().toISOString().slice(0, 10),
      p_user_name: userName,
    });
    if (error) throw error;
    const result = data as unknown as { success: boolean; id: string; status: 'APPROVED' | 'PENDING'; threshold: number };

    // Best-effort : la dépense est déjà enregistrée, un échec de notification
    // ne doit jamais la remettre en cause.
    if (result.status === 'PENDING') {
      try {
        for (const role of ['OWNER', 'ADMIN'] as const) {
          await notifyRole(session.tenantId, role, {
            type: 'EXPENSE_PENDING',
            severity: 'HIGH',
            title: `Dépense en attente de validation — ${formatCurrency(body.amount)}`,
            message: `${userName || 'Un responsable'} a saisi une dépense de ${formatCurrency(body.amount)} (« ${body.description.trim()} ») — au-dessus du seuil de ${formatCurrency(result.threshold || 0)}, validation requise.`,
            referenceId: result.id,
          });
        }
      } catch (e) {
        console.error('expense notify error:', e);
      }
    }

    return NextResponse.json({ success: true, id: result.id, status: result.status, threshold: result.threshold });
  } catch (error) {
    console.error('Create expense error:', error);
    const msg = getErrorMessage(error) || 'Erreur interne';
    const isKnown = KNOWN.test(msg);
    return NextResponse.json(
      { error: isKnown ? msg.replace(/^.*(FORBIDDEN|NOT_FOUND|INVALID_INPUT|INVALID_STATUS):\s*/, '') : "Erreur lors de l'enregistrement de la dépense" },
      { status: isKnown ? 409 : 500 }
    );
  }
}
