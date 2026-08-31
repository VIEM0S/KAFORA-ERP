import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/api/rate-limit';
import { getSessionClaims } from '@/lib/api/session';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/email/send';

// Canal de retour client basique (voir components/feedback/feedback-dialog.tsx)
// — décidé en session le 2026-08-31 : un vrai formulaire in-app plutôt que
// de compter uniquement sur le numéro WhatsApp affiché sur la landing.
//
// Contrairement à /api/contact (public, formulaire non authentifié), tenant
// et utilisateur sont lus depuis la session serveur — jamais depuis le
// corps de la requête — pour qu'un signalement ne puisse pas usurper un
// autre tenant.
const SEVERITY_LABELS: Record<string, string> = {
  BUG: 'Bug',
  SUGGESTION: 'Suggestion',
  QUESTION: 'Question',
};

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionClaims();
    if (!session || !session.tenantId) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    // Limite par utilisateur (pas par IP) : un utilisateur authentifié
    // légitime peut être derrière une IP partagée (réseau boutique).
    const rateLimit = await checkRateLimit(`feedback:user:${session.uid}`, 10, 60 * 60);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Trop de signalements envoyés. Réessayez dans une heure.' },
        { status: 429 }
      );
    }

    const { message, severity, pageUrl }: { message?: string; severity?: string; pageUrl?: string } =
      await request.json();

    if (!message?.trim()) {
      return NextResponse.json({ error: 'Le message est requis' }, { status: 400 });
    }

    const toEmail = process.env.CONTACT_FORM_TO_EMAIL || process.env.SENDGRID_FROM_EMAIL;
    if (!toEmail) {
      return NextResponse.json(
        { error: "Le canal de signalement n'est pas encore configuré." },
        { status: 503 }
      );
    }

    const admin = createServiceRoleClient();
    const [{ data: tenant }, { data: user }] = await Promise.all([
      admin.from('tenants').select('name').eq('id', session.tenantId).single(),
      admin.from('users').select('first_name, last_name, email').eq('id', session.uid).single(),
    ]);

    const tenantName = tenant?.name || 'Tenant inconnu';
    const userName = user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : '';
    const severityLabel = SEVERITY_LABELS[severity || ''] || 'Signalement';

    const result = await sendEmail({
      to: toEmail,
      subject: `[Kafora] ${severityLabel} — ${tenantName}`,
      html: `
        <p><strong>Type :</strong> ${severityLabel}</p>
        <p><strong>Entreprise :</strong> ${escapeHtml(tenantName)}</p>
        <p><strong>Utilisateur :</strong> ${escapeHtml(userName)} (${escapeHtml(user?.email || 'email inconnu')}, rôle ${escapeHtml(session.role)})</p>
        ${pageUrl ? `<p><strong>Page :</strong> ${escapeHtml(pageUrl)}</p>` : ''}
        <p><strong>Message :</strong></p>
        <p>${escapeHtml(message.trim()).replace(/\n/g, '<br/>')}</p>
      `,
    });

    if (!result.sent) {
      console.error('Feedback route email error:', result.error);
      return NextResponse.json({ error: "Échec de l'envoi, réessayez plus tard." }, { status: 502 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Feedback route error:', error);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
