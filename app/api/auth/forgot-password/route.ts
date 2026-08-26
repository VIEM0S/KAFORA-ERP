import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { checkRateLimit, getClientIp } from '@/lib/api/rate-limit';

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email requis' }, { status: 400 });
    }

    const emailKey = email.trim().toLowerCase();
    const [byIp, byEmail] = await Promise.all([
      checkRateLimit(`forgot-password:ip:${getClientIp(request)}`, 5, 15 * 60),
      checkRateLimit(`forgot-password:email:${emailKey}`, 5, 15 * 60),
    ]);
    if (!byIp.allowed || !byEmail.allowed) {
      // Même réponse générique que le succès — pas de fuite d'info sur
      // l'existence du compte via le rate-limit non plus.
      return NextResponse.json({ success: true });
    }

    const supabase = createServiceRoleClient();
    const origin = request.headers.get('origin') || new URL(request.url).origin;

    // Contrairement à la route Firebase équivalente (qui devait générer un
    // lien puis l'envoyer elle-même via SendGrid — cassé en production faute
    // de clé API configurée), Supabase Auth envoie l'email directement depuis
    // son propre service, sans dépendance à un fournisseur tiers.
    const { error } = await supabase.auth.resetPasswordForEmail(emailKey, {
      redirectTo: `${origin}/reset-password`,
    });

    // On ne révèle jamais si l'email existe ou non (sécurité anti-énumération) :
    // on logue une vraie erreur de configuration, mais on répond succès dans
    // tous les cas — même comportement qu'aujourd'hui.
    if (error) {
      console.error('Échec envoi email de reset:', error);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Forgot password error:', error);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
