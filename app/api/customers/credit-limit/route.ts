import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient, createServerSupabaseClient } from '@/lib/supabase/server';
import { getSessionClaims } from '@/lib/api/session';
import { notifyRole } from '@/lib/api/notify-role';
import { formatCurrency } from '@/lib/utils/helpers';

// customers.credit_limit n'est plus modifiable par un update direct
// (revoke update (credit_limit), migration 045) — set_credit_limit() est
// le seul chemin, pour que chaque changement passe par audit_log. Une
// hausse (exposition accrue) notifie le siège ; une baisse non.
//
// Le RPC est appelé via createServerSupabaseClient() (JWT de l'appelant),
// pas le service-role — voir le commentaire détaillé dans
// app/api/credits/write-off/route.ts pour le pourquoi.
export async function POST(request: NextRequest) {
  try {
    const session = await getSessionClaims();
    if (!session || !session.tenantId) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const { customerId, newLimit, reason }: { customerId?: string; newLimit?: number; reason?: string } = await request.json();
    if (!customerId || newLimit === undefined || newLimit === null || !reason?.trim()) {
      return NextResponse.json({ error: 'Nouvelle limite et motif requis' }, { status: 400 });
    }

    const admin = createServiceRoleClient();
    const { data: user } = await admin.from('users').select('first_name, last_name').eq('id', session.uid).maybeSingle();
    const userName = user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : '';

    const asUser = await createServerSupabaseClient();
    const { data, error } = await asUser.rpc('set_credit_limit', {
      p_customer_id: customerId,
      p_new_limit: newLimit,
      p_reason: reason.trim(),
      p_user_name: userName,
    });
    if (error) throw error;
    const result = data as unknown as { success: boolean; previousLimit: number; newLimit: number };

    if (result.newLimit > result.previousLimit) {
      try {
        const { data: customer } = await admin.from('customers').select('first_name, last_name, company_name').eq('id', customerId).maybeSingle();
        const customerLabel = customer ? (customer.company_name || `${customer.first_name || ''} ${customer.last_name || ''}`.trim()) : 'un client';
        for (const role of ['OWNER', 'ADMIN'] as const) {
          await notifyRole(session.tenantId, role, {
            type: 'CREDIT_LIMIT_CHANGED',
            severity: 'MEDIUM',
            title: `Limite de crédit augmentée — ${customerLabel}`,
            message: `${userName || 'Un responsable'} a fait passer la limite de ${customerLabel} de ${formatCurrency(result.previousLimit)} à ${formatCurrency(result.newLimit)}.`,
            referenceId: customerId,
          });
        }
      } catch (e) {
        console.error('credit-limit notify error:', e);
      }
    }

    return NextResponse.json({ success: true, previousLimit: result.previousLimit, newLimit: result.newLimit });
  } catch (error) {
    console.error('Set credit limit error:', error);
    const msg = error instanceof Error ? error.message : 'Erreur interne';
    const isKnown = /(FORBIDDEN|NOT_FOUND|INVALID_AMOUNT):/.test(msg);
    const cleanMsg = msg.replace(/^.*(FORBIDDEN|NOT_FOUND|INVALID_AMOUNT):\s*/, '');
    return NextResponse.json(
      { error: isKnown ? cleanMsg : 'Erreur lors de la mise à jour' },
      { status: isKnown ? 409 : 500 }
    );
  }
}
