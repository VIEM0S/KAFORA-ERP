import { createServiceRoleClient } from '@/lib/supabase/server';

// Rate-limiting simple par fenêtre glissante grossière, basé sur une RPC
// PostgreSQL (`check_rate_limit`, voir supabase/migrations) — remplace la
// version basée sur une transaction Firestore. Même algorithme (fenêtre
// fixe, verrou de ligne pour l'atomicité), même contrat d'appel : rien
// ne change côté appelant (register/login/forgot-password).

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export async function checkRateLimit(
  key: string,
  maxAttempts: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc('check_rate_limit', {
    p_key: key,
    p_max_attempts: maxAttempts,
    p_window_seconds: windowSeconds,
  });

  if (error) {
    // Ne jamais bloquer une route publique à cause d'une panne de la RPC de
    // rate-limiting elle-même — même philosophie permissive qu'ailleurs dans
    // le projet (voir lib/subscription/status.ts).
    console.error('checkRateLimit RPC error:', error);
    return { allowed: true, remaining: maxAttempts, retryAfterSeconds: 0 };
  }

  return data as unknown as RateLimitResult;
}

// Extrait une IP raisonnable depuis les en-têtes standards (Netlify/proxy).
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp;
  return 'unknown';
}
