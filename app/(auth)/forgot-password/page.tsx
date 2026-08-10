'use client';

import Link from 'next/link';
import { ArrowLeft, Store, UserCog, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function ForgotPasswordPage() {
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
          <Link href="/" className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/10 backdrop-blur-sm mb-4 hover:bg-white/20 transition-colors">
            <Store className="h-8 w-8 text-white" />
          </Link>
          <Link href="/">
            <h1 className="text-3xl font-bold text-white hover:text-primary-200 transition-colors">Kafora</h1>
          </Link>
        </div>

        <Card className="border-0 shadow-2xl">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-2xl font-bold text-center">Mot de passe oublié</CardTitle>
            <CardDescription className="text-center">
              La réinitialisation se fait directement par votre administrateur
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-xl bg-primary-50 border border-primary-100 p-4 flex gap-3 mb-6">
              <UserCog className="h-5 w-5 text-primary-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-gray-600">
                Pour des raisons de sécurité, seul un <strong>propriétaire ou administrateur</strong> peut
                réinitialiser votre mot de passe. Contactez-le directement — il pourra vous donner un nouveau
                mot de passe depuis la page <strong>Utilisateurs</strong>.
              </p>
            </div>

            <div className="flex items-center gap-3 text-sm text-gray-500 mb-6">
              <Phone className="h-4 w-4 flex-shrink-0" />
              <span>Contactez votre administrateur par téléphone ou en personne.</span>
            </div>

            <Link href="/login">
              <Button variant="outline" className="w-full h-11">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Retour à la connexion
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
