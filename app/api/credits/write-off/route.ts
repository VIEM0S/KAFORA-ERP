import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient, createServerSupabaseClient } from '@/lib/supabase/server';
import { getSessionClaims } from '@/lib/api/session';
import { notifyRole } from '@/lib/api/notify-role';
import { formatCurrency } from '@/lib/utils/helpers';

// Passe par une route API plutôt qu'un appel RPC direct depuis le client
// (contrairement à repay_credit) : au-delà du seuil de gouvernance
// (tenants.write_off_approval_threshold), le siège doit être notifié —
// alerte in-app + email via notifyRole(), qui exige un contexte serveur
// (SendGrid) que write_off_credit() en SQL ne peut pas atteindre seul.
//
// Le RPC lui-même est appelé via createServerSupabaseClient() (le JWT de
// l'appelant, pas le service-role) : write_off_credit() vérifie qui
// l'appelle via auth.uid()/auth_role(), qui ne sont peuplés QUE quand la
// requête porte le JWT de l'utilisateur — le service-role n'a aucun JWT et
// ferait échouer ce contrôle pour tout le monde (trouvé en vérifiant en
// direct, pas en le supposant). Le service-role reste utilisé UNIQUEMENT
// pour les lectures annexes (nom d'affichage, notifyRole) qui doivent voir
// au-delà de ce qu'une seule ligne RLS autoriserait.
export async function POST(request: NextRequest) {
  try {
    const session = await getSessionClaims();
    if (!session || !session.tenantId) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const { creditId, reason }: { creditId?: string; reason?: string } = await request.json();
    if (!creditId || !reason?.trim()) {
      return NextResponse.json({ error: 'Motif requis' }, { status: 400 });
    }

    const admin = createServiceRoleClient();
    const { data: user } = await admin.from('users').select('first_name, last_name').eq('id', session.uid).maybeSingle();
    const userName = user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : '';

    const asUser = await createServerSupabaseClient();
    const { data, error } = await asUser.rpc('write_off_credit', {
      p_credit_id: creditId,
      p_reason: reason.trim(),
      p_user_name: userName,
    });
    if (error) throw error;
    const result = data as unknown as { success: boolean; status: 'WRITTEN_OFF' | 'PENDING_APPROVAL'; threshold?: number };

    // Best-effort : la décision métier a déjà réussi ci-dessus, un échec de
    // notification (SendGrid non configuré...) ne doit jamais la remettre
    // en cause.
    try {
      const { data: credit } = await admin.from('credits').select('customer_name, remaining_amount').eq('id', creditId).maybeSingle();
      const amountLabel = credit ? formatCurrency(credit.remaining_amount) : '';
      const customerLabel = credit?.customer_name || 'un client';

      if (result.status === 'PENDING_APPROVAL') {
        for (const role of ['OWNER', 'ADMIN'] as const) {
          await notifyRole(session.tenantId, role, {
            type: 'CREDIT_WRITE_OFF_PENDING',
            severity: 'HIGH',
            title: `Annulation de crédit en attente de validation — ${customerLabel}`,
            message: `${userName || 'Un responsable'} demande l'annulation de ${amountLabel} pour ${customerLabel} — au-dessus du seuil de ${formatCurrency(result.threshold || 0)}, validation requise.`,
            referenceId: creditId,
          });
        }
      } else {
        for (const role of ['OWNER', 'ADMIN'] as const) {
          await notifyRole(session.tenantId, role, {
            type: 'CREDIT_WRITTEN_OFF',
            severity: 'MEDIUM',
            title: `Crédit annulé — ${customerLabel}`,
            message: `${userName || 'Un responsable'} a annulé ${amountLabel} pour ${customerLabel}.`,
            referenceId: creditId,
          });
        }
      }
    } catch (e) {
      console.error('write-off notify error:', e);
    }

    return NextResponse.json({ success: true, status: result.status, threshold: result.threshold });
  } catch (error) {
    console.error('Credit write-off error:', error);
    const msg = error instanceof Error ? error.message : 'Erreur interne';
    const isKnown = /^(FORBIDDEN|NOT_FOUND|INVALID_STATUS):/.test(msg) || /(FORBIDDEN|NOT_FOUND|INVALID_STATUS):/.test(msg);
    const cleanMsg = msg.replace(/^.*(FORBIDDEN|NOT_FOUND|INVALID_STATUS):\s*/, '');
    return NextResponse.json(
      { error: isKnown ? cleanMsg : 'Erreur lors de l\'annulation' },
      { status: isKnown ? 409 : 500 }
    );
  }
}
