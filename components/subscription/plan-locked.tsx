'use client';

import Link from 'next/link';
import { Lock, Phone } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { PlanFeatureFlag } from '@/lib/constants';

const COPY: Record<PlanFeatureFlag, { title: string; body: string }> = {
  analyticsEnabled: {
    title: 'Analytics avancés',
    body: "Les tableaux de bord et rapports de performance font partie des forfaits Business et Enterprise. Passez à un forfait supérieur pour suivre votre chiffre d'affaires, vos marges et comparer vos magasins.",
  },
  multiStoreEnabled: {
    title: 'Multi-magasins',
    body: 'Les transferts de stock entre magasins font partie des forfaits Business et Enterprise. Passez à un forfait supérieur pour réapprovisionner vos boutiques entre elles.',
  },
};

/**
 * Bloc affiché à la place d'une page (Analytics, Transferts) quand le
 * forfait du tenant n'inclut pas la fonctionnalité — voir
 * lib/constants (PlanFeatureFlag) et lib/api/plan-guard.ts pour le
 * verrou côté serveur correspondant.
 *
 * Pas de flux self-service de changement de forfait dans l'app (voir
 * app/api/admin/subscription/route.ts, réservé SUPER_ADMIN) : on renvoie
 * donc vers le contact direct et vers la carte Abonnement (lecture seule)
 * des Réglages, pas vers un sélecteur qui n'existe pas.
 */
export function PlanLocked({
  feature,
  currentPlanName,
}: {
  feature: PlanFeatureFlag;
  currentPlanName?: string;
}) {
  const { title, body } = COPY[feature];
  return (
    <Card>
      <CardContent className="flex flex-col items-center text-center gap-3 py-16 px-6">
        <div className="h-14 w-14 rounded-2xl bg-primary-50 flex items-center justify-center">
          <Lock className="h-6 w-6 text-primary-600" />
        </div>
        <h2 className="text-lg font-bold text-gray-900">{title} — réservé aux forfaits supérieurs</h2>
        <p className="text-sm text-gray-500 max-w-md">
          {body}
          {currentPlanName ? ` Votre forfait actuel : ${currentPlanName}.` : ''}
        </p>
        <div className="flex flex-col sm:flex-row gap-3 mt-2">
          <Button asChild>
            <a href="tel:+22375992482">
              <Phone className="h-4 w-4 mr-2" />
              Nous contacter
            </a>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/settings">Voir mon abonnement</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
