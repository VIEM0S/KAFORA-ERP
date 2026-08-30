import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

// Routes publiques (pas besoin d'auth)
const PUBLIC_PATHS = [
  '/',
  '/login',
  '/forgot-password',
  '/reset-password',
  '/setup',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/register',
  // Formulaire de contact de la landing page : soumis par des visiteurs
  // anonymes, jamais connectés — sans cette entrée, la requête était
  // redirigée vers /login avant même d'atteindre lib/email/send.ts,
  // et échouait côté client avec "Connexion impossible" (constaté en
  // direct sur kafora-erp.netlify.app après la bascule Supabase).
  '/api/contact',
  // Pages légales : doivent rester consultables sans compte (avant
  // inscription, ou obligation légale d'accessibilité publique) — un
  // visiteur qui clique "Mentions légales" en pied de page ne doit jamais
  // se retrouver renvoyé vers l'écran de connexion.
  '/mentions-legales',
  '/cgv',
  '/confidentialite',
  // Générées par app/robots.ts et app/sitemap.ts — sans cette entrée, un
  // crawler recevait une redirection vers /login au lieu du vrai contenu
  // (constaté en local : /robots.txt → /login?redirect=%2Frobots.txt).
  '/robots.txt',
  '/sitemap.xml',
];

// Préfixes publics (assets, etc.). '/solutions' : pages d'atterrissage par
// secteur (quincaillerie, épicerie...) — publiques par nature, en préfixe
// plutôt qu'une entrée par page pour que chaque nouveau secteur ajouté
// (voir lib/utils/vertical-pages.ts) reste public sans y retoucher.
// '/screenshots' : captures produit affichées sur la landing (section
// "Découvrez Kafora en action") — sans ça, un visiteur non connecté se
// faisait rediriger au lieu de charger l'image.
const PUBLIC_PREFIXES = ['/_next', '/favicon', '/images', '/icons', '/fonts', '/solutions', '/screenshots'];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Laisser passer les assets et routes publiques
  if (
    PUBLIC_PREFIXES.some((p) => pathname.startsWith(p)) ||
    PUBLIC_PATHS.includes(pathname)
  ) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });

  // getUser() fait une VRAIE vérification cryptographique auprès du serveur
  // Supabase Auth à chaque requête — contrairement à l'ancien décodage local
  // du cookie (qui ne vérifiait que l'expiration, en renvoyant la
  // vérification complète à chaque route API). C'est une amélioration
  // réelle, pas seulement un portage : la vérification se fait maintenant
  // une seule fois, correctement, avant même d'atteindre la route.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    // Toutes les routes sauf les assets statiques Next.js
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
