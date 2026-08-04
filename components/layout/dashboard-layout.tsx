'use client';

import { useEffect } from 'react';
import { Sidebar } from './sidebar-nav';
import { Header } from './header';
import { cn } from '@/lib/utils/helpers';
import { useAuthStore, useUIStore } from '@/hooks/store';
import { useAuth } from '@/hooks/useAuth';
import { useDataErrors } from '@/hooks/use-data-errors';

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
          {children}
        </main>
      </div>
    </div>
  );
}
