'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Store, Loader2, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/lib/supabase/client';

/**
 * Page d'atterrissage du lien envoyé par resetPasswordForEmail()/
 * admin.generateLink({ type: 'recovery' }) — équivalent du gestionnaire
 * d'action Firebase (/__/auth/action).
 *
 * Contrairement au client supabase-js par défaut (detectSessionInUrl: true,
 * stockage localStorage), le client créé par @supabase/ssr (createBrowserClient,
 * voir lib/supabase/client.ts — nécessaire pour que le serveur lise la session
 * via cookies) NE consomme PAS automatiquement les jetons #access_token=...
 * déposés dans l'URL par Supabase Auth : constaté en direct, aucun cookie ni
 * entrée localStorage n'apparaissait après avoir suivi un lien de
 * récupération valide, laissant cette page appeler updateUser() sans aucune
 * session — d'où "Lien invalide ou expiré" à chaque tentative, y compris
 * juste après avoir généré un lien tout neuf.
 *
 * On établit donc la session nous-mêmes au montage, avant d'afficher le
 * formulaire : setSession() pour un lien "recovery" classique (#access_token
 * dans le fragment), ou exchangeCodeForSession() si un jour un lien PKCE
 * (?code=...) est utilisé à la place. Le fragment est ensuite retiré de
 * l'URL (replaceState) pour ne pas laisser le jeton visible dans l'historique
 * du navigateur.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [checkingLink, setCheckingLink] = useState(true);
  const [linkValid, setLinkValid] = useState(false);

  useEffect(() => {
    (async () => {
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const accessToken = hashParams.get('access_token');
      const refreshToken = hashParams.get('refresh_token');
      const code = new URLSearchParams(window.location.search).get('code');

      let sessionError: string | null = null;
      if (accessToken && refreshToken) {
        const { error: setErr } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        sessionError = setErr?.message ?? null;
      } else if (code) {
        const { error: exErr } = await supabase.auth.exchangeCodeForSession(code);
        sessionError = exErr?.message ?? null;
      } else {
        sessionError = 'missing';
      }

      // Retire le jeton de l'URL/historique qu'il ait été consommé ou non.
      window.history.replaceState(null, '', window.location.pathname);

      setLinkValid(!sessionError);
      setCheckingLink(false);
    })();
  }, []);

  const handleSubmit = async () => {
    setError(null);
    if (password.length < 8) {
      setError('Mot de passe : 8 caractères minimum');
      return;
    }
    if (password !== confirm) {
      setError('Les mots de passe ne correspondent pas');
      return;
    }
    setIsLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setIsLoading(false);
    if (updateError) {
      setError('Lien invalide ou expiré. Redemandez une réinitialisation.');
      return;
    }
    setDone(true);
    setTimeout(() => router.push('/login'), 2000);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-950 via-primary-900 to-primary-800 px-4">
      <div className="w-full max-w-md">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-primary-200 hover:text-white transition-colors mb-6"
        >
          <ArrowLeft className="h-4 w-4" />
          Retour à l&apos;accueil
        </Link>

        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/10 backdrop-blur-sm mb-4">
            <Store className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white">Kafora</h1>
        </div>

        <Card className="border-0 shadow-2xl">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-2xl font-bold text-center">Nouveau mot de passe</CardTitle>
            <CardDescription className="text-center">Choisissez un nouveau mot de passe</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {checkingLink ? (
              <div className="flex items-center justify-center py-6 text-gray-500">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Vérification du lien…
              </div>
            ) : !linkValid ? (
              <Alert variant="destructive">
                <AlertDescription>
                  Lien invalide ou expiré. Redemandez une réinitialisation.
                </AlertDescription>
              </Alert>
            ) : done ? (
              <Alert className="bg-green-50 border-green-200">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <AlertDescription className="text-green-800">
                  Mot de passe mis à jour. Redirection vers la connexion…
                </AlertDescription>
              </Alert>
            ) : (
              <>
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                <div className="space-y-2">
                  <Label htmlFor="password">Nouveau mot de passe</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="8 caractères minimum"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm">Confirmer le mot de passe</Label>
                  <Input
                    id="confirm"
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                </div>
                <Button className="w-full h-11" onClick={handleSubmit} disabled={isLoading}>
                  {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Valider'}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
