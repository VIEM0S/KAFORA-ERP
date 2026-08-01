'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Eye, EyeOff, Loader2, Store, AlertCircle, ArrowLeft } from 'lucide-react';
import {
  signInWithEmailAndPassword,
  AuthError,
} from 'firebase/auth';
import { auth } from '@/lib/firebase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuthStore } from '@/hooks/store';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';

function getFirebaseErrorMessage(error: AuthError): string {
  switch (error.code) {
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Identifiants invalides';
    case 'auth/user-disabled':
      return 'Compte désactivé. Contactez votre administrateur.';
    case 'auth/too-many-requests':
      return 'Trop de tentatives. Compte temporairement bloqué. Réessayez plus tard.';
    case 'auth/network-request-failed':
      return 'Erreur réseau. Vérifiez votre connexion internet.';
    case 'auth/invalid-email':
      return 'Adresse email invalide';
    default:
      return 'Une erreur est survenue. Veuillez réessayer.';
  }
}

export default function LoginPage() {
  const router = useRouter();
  const { setUser, setTenant, setStores, setCurrentStore } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      // 1. Connexion Firebase Auth côté client
      const credential = await signInWithEmailAndPassword(auth, email, password);

      // 2. Récupérer l'ID token pour l'envoyer au serveur
      const idToken = await credential.user.getIdToken();

      // 3. Créer la session côté serveur (cookie HttpOnly)
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });

      let data = await response.json().catch(() => null);

      // Droits modifiés depuis la dernière connexion (changement de rôle ou
      // d'affectation magasin) : le cookie reçu a été fabriqué à partir d'un
      // jeton périmé. On rafraîchit le jeton et on rejoue UNE fois, sinon
      // l'utilisateur se connecte avec ses anciens droits sans le savoir.
      if (response.ok && data?.claimsUpdated) {
        const freshToken = await credential.user.getIdToken(true);
        const retry = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken: freshToken }),
        });
        if (retry.ok) data = await retry.json();
      }

      if (!response.ok) {
        throw new Error(
          data?.error || `Erreur serveur (${response.status}). Réessayez dans un instant.`
        );
      }

      if (!data) {
        throw new Error('Réponse du serveur invalide. Réessayez dans un instant.');
      }

      // 4. Hydrater le store Zustand (données de profil uniquement)
      setUser(data.user);
      setTenant(data.tenant);
      setStores(data.stores);
      if (data.stores.length > 0) {
        setCurrentStore(data.stores[0]);
      }

      // Le Caissier n'a pas accès au tableau de bord (CA jour/mois) — il va
      // directement à son outil de travail quotidien.
      // Un compte éditeur n'a pas de tenant : le tableau de bord n'aurait
      // aucune donnée à afficher. Sa page d'accueil est la console clients.
      const role = data.user?.role;
      router.push(
        role === 'SUPER_ADMIN' ? '/admin' : role === 'CASHIER' ? '/pos' : '/dashboard'
      );
    } catch (err) {
      if ((err as AuthError).code) {
        setError(getFirebaseErrorMessage(err as AuthError));
      } else {
        setError(err instanceof Error ? err.message : 'Une erreur est survenue');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-950 via-primary-900 to-primary-800 px-4">
      <div className="w-full max-w-md">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-primary-200 hover:text-white transition-colors mb-6"
        >
          <ArrowLeft className="h-4 w-4" />
          Retour à l'accueil
        </Link>

        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/10 backdrop-blur-sm mb-4 hover:bg-white/20 transition-colors">
            <Store className="h-8 w-8 text-white" />
          </Link>
          <Link href="/">
            <h1 className="text-3xl font-bold text-white hover:text-primary-200 transition-colors">Kafora</h1>
          </Link>
          <p className="text-primary-200 mt-2">Système de gestion Enterprise</p>
        </div>

        <Card className="border-0 shadow-2xl">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-2xl font-bold text-center">Connexion</CardTitle>
            <CardDescription className="text-center">
              Entrez vos identifiants pour accéder à votre espace
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="vous@exemple.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={isLoading}
                  className="h-11"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Mot de passe</Label>
                  <Link
                    href="/forgot-password"
                    className="text-sm text-primary-600 hover:text-primary-700 hover:underline"
                  >
                    Mot de passe oublié ?
                  </Link>
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    disabled={isLoading}
                    className="h-11 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                className="w-full h-11 bg-primary-600 hover:bg-primary-700"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Connexion en cours...
                  </>
                ) : (
                  'Se connecter'
                )}
              </Button>
            </form>
          </CardContent>
          <CardFooter className="flex flex-col space-y-4 border-t pt-6">
            <p className="text-sm text-center text-gray-500">
              Pas encore de compte ?{' '}
              <Link href="/setup" className="text-primary-600 hover:text-primary-700 font-medium hover:underline">
                Créer votre entreprise
              </Link>
            </p>
          </CardFooter>
        </Card>

        <p className="text-center text-sm text-primary-200 mt-8">
          © 2024 Kafora. Tous droits réservés.
        </p>
      </div>
    </div>
  );
}
