import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/api/rate-limit';
import { sendEmail } from '@/lib/email/send';

// Endpoint public (pas d'auth) pour le formulaire de contact de la landing
// page. Envoie un email via SendGrid à l'adresse configurée dans
// CONTACT_FORM_TO_EMAIL (à défaut, SENDGRID_FROM_EMAIL). Tant qu'aucune de
// ces deux variables n'est renseignée, sendEmail() renvoie { sent: false }
// sans lever d'erreur — on répond alors 503 pour que le formulaire affiche
// clairement "indisponible pour le moment" plutôt qu'un faux succès.
export async function POST(request: NextRequest) {
  try {
    // Formulaire public : sans limitation, il sert de relais à spam — chaque
    // envoi consommant en plus du quota SendGrid, qui est facturé.
    const ipLimit = await checkRateLimit(`contact:ip:${getClientIp(request)}`, 5, 60 * 60);
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { error: 'Trop de messages envoyés. Réessayez dans une heure.' },
        { status: 429 }
      );
    }

    const {
      name, email, message, company, phone, storeCount,
    }: {
      name?: string; email?: string; message?: string;
      company?: string; phone?: string; storeCount?: string;
    } = await request.json();

    if (!name?.trim() || !email?.trim() || !message?.trim()) {
      return NextResponse.json({ error: 'Nom, email et message sont requis' }, { status: 400 });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return NextResponse.json({ error: 'Adresse email invalide' }, { status: 400 });
    }

    const toEmail = process.env.CONTACT_FORM_TO_EMAIL || process.env.SENDGRID_FROM_EMAIL;
    if (!toEmail) {
      return NextResponse.json(
        { error: "Le formulaire de contact n'est pas encore configuré (CONTACT_FORM_TO_EMAIL manquant)." },
        { status: 503 }
      );
    }

    // Champs de qualification B2B, tous optionnels : on ne les affiche dans
    // l'email que s'ils ont été renseignés, pour ne pas alourdir le message
    // pour un simple particulier qui n'a rempli que l'essentiel.
    const optionalRows = [
      company?.trim() && `<p><strong>Entreprise :</strong> ${escapeHtml(company.trim())}</p>`,
      phone?.trim() && `<p><strong>Téléphone :</strong> ${escapeHtml(phone.trim())}</p>`,
      storeCount?.trim() && `<p><strong>Nombre de boutiques :</strong> ${escapeHtml(storeCount.trim())}</p>`,
    ].filter(Boolean).join('\n        ');

    const result = await sendEmail({
      to: toEmail,
      subject: `[Kafora] Nouveau message de contact — ${name.trim()}`,
      html: `
        <p><strong>Nom :</strong> ${escapeHtml(name.trim())}</p>
        <p><strong>Email :</strong> ${escapeHtml(email.trim())}</p>
        ${optionalRows}
        <p><strong>Message :</strong></p>
        <p>${escapeHtml(message.trim()).replace(/\n/g, '<br/>')}</p>
      `,
    });

    if (!result.sent) {
      console.error('Contact form email error:', result.error);
      return NextResponse.json({ error: "Échec de l'envoi, réessayez plus tard." }, { status: 502 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Contact form route error:', error);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}

// Échappement HTML minimal (pas de dépendance ajoutée) pour éviter toute
// injection dans l'email HTML envoyé à partir d'un input public non authentifié.
function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
