import { NextRequest, NextResponse } from 'next/server';

// Routes publiques (pas besoin d'auth)
const PUBLIC_PATHS = [
  '/',
  '/login',
  '/forgot-password',
  '/setup',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/register',
];

// Préfixes publics (assets, etc.)
const PUBLIC_PREFIXES = ['/_next', '/favicon', '/images', '/icons', '/fonts'];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Laisser passer les assets et routes publiques
  if (
    PUBLIC_PREFIXES.some((p) => pathname.startsWith(p)) ||
    PUBLIC_PATHS.includes(pathname)
  ) {
    return NextResponse.next();
  }

  // Vérifier le cookie de session Firebase
  const sessionCookie = request.cookies.get('__session')?.value;

  if (!sessionCookie) {
    // Pas de session → redirect login
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Vérification légère du cookie (format JWT valide)
  // La vérification cryptographique complète se fait dans chaque API route
  // via adminAuth.verifySessionCookie() — le middleware vérifie juste la présence
  try {
    // Décoder sans vérifier la signature (juste vérifier l'expiration côté client)
    const parts = sessionCookie.split('.');
    if (parts.length !== 3) throw new Error('Invalid cookie format');

    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    const now = Math.floor(Date.now() / 1000);

    if (payload.exp && payload.exp < now) {
      // Cookie expiré
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('redirect', pathname);
      const response = NextResponse.redirect(loginUrl);
      response.cookies.delete('__session');
      return response;
    }

    return NextResponse.next();
  } catch {
    const loginUrl = new URL('/login', request.url);
    const response = NextResponse.redirect(loginUrl);
    response.cookies.delete('__session');
    return response;
  }
}

export const config = {
  matcher: [
    // Toutes les routes sauf les assets statiques Next.js
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
