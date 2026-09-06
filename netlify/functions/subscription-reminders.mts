/**
 * Relance automatique avant blocage — fonction planifiée Netlify.
 *
 * Avant, un client n'apprenait une suspension/expiration qu'en essayant
 * de se connecter après coup (ou pas du tout à la réactivation, voir
 * /api/admin/tenant-status). Ici c'est PROACTIF : un email + une alerte
 * in-app 7 jours avant le blocage complet, puis un dernier rappel à 1
 * jour — même seuils que "j jours avant blocage" déjà affiché dans la
 * console éditeur (voir lib/subscription/status.ts, dont la logique de
 * date est reproduite ici en autonome : cette fonction, comme
 * aggregate-daily-stats.mts, ne dépend d'aucun import `@/lib` — seul
 * @supabase/supabase-js est garanti empaqueté correctement par esbuild
 * pour les fonctions Netlify de ce projet).
 *
 * Idempotence : subscriptions.last_reminder_days_left mémorise le
 * dernier seuil déjà relancé pour ce cycle — sans ça, une exécution
 * quotidienne renverrait la même relance chaque jour tant que le compte
 * reste sous le seuil. Remis à null par admin_extend_subscription() à
 * chaque prolongation (migration 059).
 */
import type { Config } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const GRACE_PERIOD_DAYS = 3;
const REMINDER_THRESHOLDS = [7, 1];

function daysUntilFullBlock(status: string, currentPeriodEnd: string | null, trialEndsAt: string | null): number | null {
  if (status === 'CANCELLED' || status === 'EXPIRED') return 0;
  const expiryRaw = status === 'TRIAL' ? (trialEndsAt ?? currentPeriodEnd) : (currentPeriodEnd ?? trialEndsAt);
  if (!expiryRaw) return null;
  const expiry = new Date(expiryRaw);
  if (Number.isNaN(expiry.getTime())) return null;
  const graceEnd = new Date(expiry.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
  return Math.max(0, Math.ceil((graceEnd.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
}

async function sendEmail(apiKey: string, fromEmail: string, to: string, subject: string, html: string) {
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: fromEmail, name: 'Kafora' },
      subject,
      content: [
        { type: 'text/plain', value: html.replace(/<[^>]+>/g, '') },
        { type: 'text/html', value: html },
      ],
    }),
  });
  return res.ok;
}

function escapeHtml(input: string): string {
  return input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export default async function handler() {
  const started = Date.now();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response('Configuration Supabase manquante (URL ou clé de service)', { status: 500 });
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const sendGridKey = process.env.SENDGRID_API_KEY;
  const fromEmail = process.env.SENDGRID_FROM_EMAIL;

  const { data: subs, error } = await supabase
    .from('subscriptions')
    .select('tenant_id, status, current_period_end, trial_ends_at, last_reminder_days_left');
  if (error) {
    console.error('subscription-reminders: échec lecture subscriptions', error);
    return new Response(`Erreur : ${error.message}`, { status: 500 });
  }

  const { data: activeTenants } = await supabase.from('tenants').select('id, name').eq('is_active', true);
  const tenantById = new Map((activeTenants ?? []).map(t => [t.id, t.name]));

  let sent = 0;
  for (const sub of subs ?? []) {
    const tenantName = tenantById.get(sub.tenant_id);
    if (!tenantName) continue; // tenant suspendu ou inconnu : pas de relance

    const daysLeft = daysUntilFullBlock(sub.status, sub.current_period_end, sub.trial_ends_at);
    if (daysLeft === null) continue;

    const threshold = REMINDER_THRESHOLDS.find(t => daysLeft <= t);
    if (threshold === undefined) continue;
    if (sub.last_reminder_days_left === threshold) continue; // déjà relancé pour ce seuil

    const { data: owner } = await supabase
      .from('users').select('id, email').eq('tenant_id', sub.tenant_id).eq('role', 'OWNER').maybeSingle();

    const title = threshold <= 1
      ? 'Dernier rappel : votre accès Kafora sera bloqué demain'
      : `Votre abonnement Kafora expire dans ${threshold} jours`;
    const message = threshold <= 1
      ? "Sans renouvellement, l'accès à votre espace Kafora sera bloqué demain. Contactez le support pour renouveler."
      : `Votre abonnement arrive à échéance dans ${threshold} jours. Pensez à le renouveler pour éviter toute interruption.`;

    if (owner?.id) {
      await supabase.from('alerts').insert({
        tenant_id: sub.tenant_id, type: 'SUBSCRIPTION_EXPIRING_SOON',
        severity: threshold <= 1 ? 'CRITICAL' : 'HIGH',
        title, message, reference: 'subscriptions', target_user_id: owner.id,
      });
      if (owner.email && sendGridKey && fromEmail) {
        await sendEmail(sendGridKey, fromEmail, owner.email, title, `<p>${escapeHtml(message)}</p>`).catch(e =>
          console.error(`subscription-reminders: email échoué pour ${sub.tenant_id}`, e)
        );
      }
    }

    await supabase.from('subscriptions').update({ last_reminder_days_left: threshold }).eq('tenant_id', sub.tenant_id);
    sent++;
  }

  const summary = `${sent} relance(s) envoyée(s), ${Date.now() - started} ms`;
  console.log(summary);
  return new Response(summary, { status: 200 });
}

export const config: Config = {
  // 08h00 UTC : après l'agrégation nocturne (02h00), à une heure où
  // l'éditeur peut encore suivre manuellement si besoin.
  schedule: '0 8 * * *',
};
