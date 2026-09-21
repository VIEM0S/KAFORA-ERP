import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient, createServerSupabaseClient } from '@/lib/supabase/server';
import { getSessionClaims } from '@/lib/api/session';
import { notifyRole, notifyUser } from '@/lib/api/notify-role';
import { formatCurrency } from '@/lib/utils/helpers';
import { getErrorMessage } from '@/lib/utils/errors';

// Même schéma que /api/expenses : les RPC (start/save/submit/decide/cancel_stocktake)
// sont appelées avec le JWT de l'appelant (elles lisent auth_role()/auth_tenant_id(),
// vides sous service-role) ; le service-role ne sert qu'aux lectures annexes et aux
// notifications (SendGrid, contexte serveur).
const KNOWN = /(FORBIDDEN|NOT_FOUND|INVALID_INPUT|INVALID_STATUS):/;

type Body =
  | { action: 'start'; storeId: string }
  | { action: 'save'; id: string; counts: { product_id: string; counted: number | null }[] }
  | { action: 'submit'; id: string; counts?: { product_id: string; counted: number | null }[] }
  | { action: 'decide'; id: string; approve: boolean; note?: string }
  | { action: 'cancel'; id: string };

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionClaims();
    if (!session || !session.tenantId) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }
    const body: Body = await request.json();

    const admin = createServiceRoleClient();
    const { data: user } = await admin.from('users').select('first_name, last_name').eq('id', session.uid).maybeSingle();
    const userName = user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : '';
    const asUser = await createServerSupabaseClient();

    switch (body.action) {
      case 'start': {
        if (!body.storeId) return NextResponse.json({ error: 'Champs manquants' }, { status: 400 });
        const { data, error } = await asUser.rpc('start_stocktake', { p_store_id: body.storeId, p_user_name: userName });
        if (error) throw error;
        return NextResponse.json({ success: true, ...(data as object) });
      }

      case 'save': {
        if (!body.id || !Array.isArray(body.counts)) return NextResponse.json({ error: 'Champs manquants' }, { status: 400 });
        const { data, error } = await asUser.rpc('save_stocktake_counts', { p_id: body.id, p_counts: body.counts });
        if (error) throw error;
        return NextResponse.json({ success: true, ...(data as object) });
      }

      case 'submit': {
        if (!body.id) return NextResponse.json({ error: 'Champs manquants' }, { status: 400 });
        // Enregistre d'abord les dernières quantités saisies, puis soumet : évite
        // qu'un comptage non sauvegardé soit perdu au moment de terminer.
        if (Array.isArray(body.counts) && body.counts.length > 0) {
          const { error: saveError } = await asUser.rpc('save_stocktake_counts', { p_id: body.id, p_counts: body.counts });
          if (saveError) throw saveError;
        }
        const { data, error } = await asUser.rpc('submit_stocktake', { p_id: body.id, p_user_name: userName });
        if (error) throw error;
        const result = data as unknown as { status: 'COMPLETED' | 'PENDING_APPROVAL'; lossValue: number; threshold?: number };

        // Best-effort : l'inventaire est déjà soumis, un échec de notification ne le remet pas en cause.
        if (result.status === 'PENDING_APPROVAL') {
          try {
            for (const role of ['OWNER', 'ADMIN'] as const) {
              await notifyRole(session.tenantId, role, {
                type: 'STOCKTAKE_PENDING',
                severity: 'HIGH',
                title: `Inventaire en attente de validation — écart de ${formatCurrency(result.lossValue)}`,
                message: `${userName || 'Un responsable'} a terminé un inventaire avec une perte estimée à ${formatCurrency(result.lossValue)}, au-dessus du seuil de ${formatCurrency(result.threshold || 0)} : votre validation est requise avant d'ajuster le stock.`,
                referenceId: body.id,
              });
            }
          } catch (e) {
            console.error('stocktake notify error:', e);
          }
        }
        return NextResponse.json({ success: true, status: result.status, lossValue: result.lossValue, threshold: result.threshold });
      }

      case 'decide': {
        if (!body.id || typeof body.approve !== 'boolean') return NextResponse.json({ error: 'Champs manquants' }, { status: 400 });
        const { data, error } = await asUser.rpc('decide_stocktake', {
          p_id: body.id, p_approve: body.approve, p_note: body.note?.trim() || '', p_user_name: userName,
        });
        if (error) throw error;
        const result = data as unknown as { createdBy: string | null; lossValue: number };
        if (result.createdBy) {
          try {
            await notifyUser(
              session.tenantId, result.createdBy,
              body.approve ? 'Inventaire validé' : 'Inventaire refusé',
              body.approve
                ? `${userName || 'Le siège'} a validé votre inventaire : le stock a été ajusté.`
                : `${userName || 'Le siège'} a refusé votre inventaire${body.note?.trim() ? ` : ${body.note.trim()}` : '.'} Le stock n'a pas été modifié.`,
              'STOCKTAKE_DECIDED', 'stocktakes'
            );
          } catch (e) {
            console.error('stocktake decision notify error:', e);
          }
        }
        return NextResponse.json({ success: true });
      }

      case 'cancel': {
        if (!body.id) return NextResponse.json({ error: 'Champs manquants' }, { status: 400 });
        const { error } = await asUser.rpc('cancel_stocktake', { p_id: body.id, p_user_name: userName });
        if (error) throw error;
        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json({ error: 'Action inconnue' }, { status: 400 });
    }
  } catch (error) {
    console.error('Stocktake error:', error);
    const msg = getErrorMessage(error) || 'Erreur interne';
    const isKnown = KNOWN.test(msg);
    return NextResponse.json(
      { error: isKnown ? msg.replace(/^.*(FORBIDDEN|NOT_FOUND|INVALID_INPUT|INVALID_STATUS):\s*/, '') : "Erreur lors de l'opération sur l'inventaire" },
      { status: isKnown ? 409 : 500 }
    );
  }
}
