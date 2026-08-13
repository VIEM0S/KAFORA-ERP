'use client';

import { useEffect, useState } from 'react';
import { Sidebar } from './sidebar-nav';
import { Header } from './header';
import { cn } from '@/lib/utils/helpers';
import { useAuthStore, useUIStore } from '@/hooks/store';
import { useAuth } from '@/hooks/useAuth';
import { useDataErrors } from '@/hooks/use-data-errors';
import { getSubscriptionState, getExpiryDate, daysUntilFullBlock, GRACE_PERIOD_DAYS } from '@/lib/subscription/status';

interface DashboardLayoutProps {
  children: React.ReactNode;
}

/**
 * Bandeau affiché tant qu'une écoute de données est en échec.
 *
 * Sans lui, un refus d'accès ou un index manquant se traduisait par une page
 * vide : le commerçant concluait à une absence de données là où il y avait un
 * problème technique.
 */
function DataErrorBanner() {
  const errors = useDataErrors(s => s.errors);
  const list = Object.entries(errors);
  if (list.length === 0) return null;

  return (
    <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4">
      <p className="text-sm font-medium text-red-800">
        {list.length === 1
          ? 'Une partie des données n\'a pas pu être chargée.'
          : `${list.length} sources de données n'ont pas pu être chargées.`}
      </p>
      <ul className="mt-2 space-y-1">
        {list.map(([key, err]) => (
          <li key={key} className="text-xs text-red-700">
            <span className="font-medium">{key}</span> — {err.message}
            {err.hint && <span className="block text-red-600 break-all">{err.hint}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Bandeau d'alerte d'abonnement.
 *
 * `daysUntilFullBlock`/`getSubscriptionState` (lib/subscription/status.ts)
 * existaient déjà et pilotent le blocage réel des écritures — mais rien ne
 * les affichait jamais côté client. Un commerçant en période de tolérance
 * (GRACE) n'avait donc aucun signal qu'il lui restait 7 jours avant blocage
 * complet, sinon découvrir le blocage le jour où il arrivait.
 */
function SubscriptionBanner() {
  const subscription = useAuthStore(s => s.tenant?.subscription);

  // Toutes les valeurs dérivées AVANT tout retour anticipé : les Hooks
  // doivent être appelés inconditionnellement à chaque rendu (règle des
  // Hooks) — un retour anticipé avant eux casserait cette règle.
  //
  // Date.now() n'est lu que dans un effet, jamais pendant le rendu : appeler
  // une fonction impure (non déterministe) pendant le rendu est désormais une
  // erreur de lint (eslint-config-next 16) — et c'est un vrai risque, pas du
  // style : le serveur et le client n'ont pas la même horloge, donc calculer
  // "jours restants" pendant le rendu produirait une valeur différente au
  // premier rendu client (hydratation) qu'au rendu serveur. `now` reste donc
  // `null` le temps du premier rendu (bandeau simplement absent avant
  // l'hydratation), rempli juste après via l'effet.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => { setNow(Date.now()); }, []);

  const expiry = subscription ? getExpiryDate(subscription) : null;
  const daysToExpiry = expiry && now !== null
    ? Math.ceil((expiry.getTime() - now) / (24 * 60 * 60 * 1000))
    : null;

  if (!subscription) return null;

  const state = getSubscriptionState(subscription);
  const daysToBlock = daysUntilFullBlock(subscription);

  if (state === 'EXPIRED') {
    return (
      <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4">
        <p className="text-sm font-medium text-red-800">
          Abonnement Kafora expiré — toutes les modifications sont bloquées, l&apos;encaissement inclus.
        </p>
        <p className="mt-1 text-xs text-red-700">
          Vos données restent consultables. Contactez-nous pour régulariser et reprendre l&apos;activité.
        </p>
      </div>
    );
  }

  if (state === 'GRACE') {
    return (
      <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm font-medium text-amber-800">
          Abonnement Kafora expiré — la caisse reste utilisable {daysToBlock} jour{(daysToBlock ?? 0) !== 1 ? 's' : ''} de plus, le reste est déjà bloqué.
        </p>
        <p className="mt-1 text-xs text-amber-700">
          Passé ce délai, l&apos;encaissement s&apos;arrêtera aussi. Contactez-nous pour régulariser.
        </p>
      </div>
    );
  }

  // ACTIVE mais proche de l'échéance : avertissement doux, avant même
  // d'entrer en tolérance — pour ne pas découvrir le blocage le jour même.
  if (expiry) {
    if (daysToExpiry !== null && daysToExpiry >= 0 && daysToExpiry <= GRACE_PERIOD_DAYS) {
      return (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
          <p className="text-sm font-medium text-blue-800">
            Votre abonnement Kafora expire dans {daysToExpiry} jour{daysToExpiry !== 1 ? 's' : ''}.
          </p>
        </div>
      );
    }
  }

  return null;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  useAuth();

  const { user, isLoading } = useAuthStore();
  const { sidebarCollapsed, toggleSidebar } = useUIStore();

  // Raccourci clavier global : Ctrl+B pour toggle sidebar
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [toggleSidebar]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 rounded-full border-4 border-primary-600 border-t-transparent animate-spin" />
          <p className="text-sm text-gray-500">Chargement de votre espace...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar />
      <div className={cn('transition-all duration-300', sidebarCollapsed ? 'ml-16' : 'ml-64')}>
        <Header />
        <main className="p-4 lg:p-6">
          {/* Point d'intégration UNIQUE pour les erreurs de chargement.
              Chaque écran déclare ses échecs dans le registre partagé
              (hooks/use-data-errors) ; le bandeau est rendu ici, une seule
              fois, plutôt que dupliqué dans dix-sept pages. */}
          <DataErrorBanner />
          <SubscriptionBanner />
          {children}
        </main>
      </div>
    </div>
  );
}
