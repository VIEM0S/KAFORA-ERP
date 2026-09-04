/**
 * Envoi d'email minimal via l'API REST SendGrid (pas de dépendance npm ajoutée).
 * Nécessite les variables d'environnement :
 *   SENDGRID_API_KEY   — clé API SendGrid (préfixe "SG.")
 *   SENDGRID_FROM_EMAIL — adresse expéditrice vérifiée dans SendGrid
 *
 * Si ces variables ne sont pas configurées, sendEmail() retourne
 * { sent: false } sans lever d'erreur — l'appelant décide quoi faire
 * (ex: forgot-password répond quand même "succès" au client pour ne pas
 * révéler si un compte existe, mais peut logger une alerte interne).
 */
/**
 * Échappe une chaîne avant de l'interpoler dans un `html:` envoyé à
 * sendEmail() — tout champ modifiable par un utilisateur (nom de client,
 * de compte...) doit passer par ici avant d'atterrir dans un email. Sans
 * ça, un Manager renommant un client en `<a href="...">...</a>` peut faire
 * envoyer un lien de phishing arbitraire depuis le domaine d'expédition
 * vérifié de Kafora, à l'Owner/Admin qui reçoit l'alerte.
 */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<{ sent: boolean; error?: string }> {
  const apiKey = process.env.SENDGRID_API_KEY;
  const fromEmail = process.env.SENDGRID_FROM_EMAIL;

  if (!apiKey || !fromEmail) {
    return { sent: false, error: 'SENDGRID_API_KEY ou SENDGRID_FROM_EMAIL manquant dans .env' };
  }

  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: params.to }] }],
      from: { email: fromEmail, name: 'Kafora' },
      subject: params.subject,
      content: [
        { type: 'text/plain', value: params.text || params.html.replace(/<[^>]+>/g, '') },
        { type: 'text/html', value: params.html },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { sent: false, error: `SendGrid ${res.status}: ${body}` };
  }
  return { sent: true };
}
