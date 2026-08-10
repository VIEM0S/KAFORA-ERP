'use client';

import { useEffect } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log console uniquement pour l'instant — un vrai suivi d'erreurs
    // (Sentry ou équivalent) pourrait être branché ici plus tard.
    console.error('Erreur applicative :', error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="text-center max-w-sm">
        <div className="h-20 w-20 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-6">
          <AlertTriangle className="h-10 w-10 text-red-600" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Une erreur est survenue</h1>
        <p className="text-sm text-gray-500 mb-6">
          Quelque chose s&apos;est mal passé de notre côté. Réessaie — si le problème persiste, préviens ton administrateur.
        </p>
        <Button onClick={() => reset()} className="bg-primary-600 hover:bg-primary-700">
          <RefreshCw className="h-4 w-4 mr-2" />
          Réessayer
        </Button>
      </div>
    </div>
  );
}
