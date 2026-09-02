'use client';

import { Bell, Search, Settings, Store, X, ChevronDown, CheckCircle2, PanelLeft, Menu, MessageSquareWarning } from 'lucide-react';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils/helpers';
import { FeedbackDialog } from '@/components/feedback/feedback-dialog';
import { useAuthStore, useUIStore } from '@/hooks/store';
import { supabase } from '@/lib/supabase/client';
// watch vient d'ici : l'enveloppe remonte les échecs au bandeau global
// (voir lib/supabase/watch.ts), au lieu de laisser l'écran vide sans explication.
import { watch } from '@/lib/supabase/watch';
import { isManagerPlus as isManagerPlusRole } from '@/lib/auth/roles';
import { estEnAlerte } from '@/lib/inventory/alert-threshold';
import { SUBSCRIPTION_PLANS, PlanId } from '@/lib/constants';

export function Header() {
  const { user, tenant, currentStore, stores, setCurrentStore } = useAuthStore();
  const { toggleSidebar, setSidebarOpen } = useUIStore();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [storeDropdownOpen, setStoreDropdownOpen] = useState(false);
  const [alertCount, setAlertCount] = useState(0);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  // Badge live — stock faible + crédits en retard + vraies alertes
  // (demandes de suppression, conflits de synchro offline...). Fix : ce badge
  // ne comptait jamais ces dernières, donc ni l'Admin ni le Propriétaire
  // n'avaient d'indicateur visible sans aller cliquer sur /notifications.
  useEffect(() => {
    const tenantId = tenant?.id;
    const storeId = currentStore?.id;
    if (!tenantId) return;
    let low = 0;
    let overdue = 0;
    let realAlerts = 0;
    const update = () => setAlertCount(low + overdue + realAlerts);

    const unsubC = watch(
      'credits',
      () => supabase.from('credits').select('id').eq('tenant_id', tenantId).eq('status', 'OVERDUE'),
      rows => { overdue = rows.length; update(); },
      undefined,
      `tenant_id=eq.${tenantId}`
    );
    // Sans magasin sélectionné (juste après connexion, le temps que
    // currentStore se résolve), on ne pose pas cette écoute : interroger
    // store_id == '' déclenchait un refus RLS transitoire à chaque
    // chargement de page — voir même garde dans sidebar-nav.tsx.
    const unsubI = storeId
      ? watch(
          'inventory',
          () => supabase.from('inventory').select('product_id, quantity, min_quantity').eq('tenant_id', tenantId).eq('store_id', storeId),
          async rows => {
            const { data: prodRows } = await supabase.from('products').select('id, alert_threshold').eq('tenant_id', tenantId);
            const thresh: Record<string, number> = {};
            (prodRows ?? []).forEach(p => { thresh[p.id] = p.alert_threshold ?? 10; });
            low = rows.filter(r =>
              // Seuil du magasin s'il existe, sinon celui du produit.
              estEnAlerte(r.quantity || 0, { seuilMagasin: r.min_quantity ?? undefined, seuilProduit: thresh[r.product_id] })
            ).length;
            update();
          },
          undefined,
          `tenant_id=eq.${tenantId}`
        )
      : undefined;
    const unsubA = watch(
      'alerts',
      () => supabase.from('alerts').select('is_read, target_user_id, target_role').eq('tenant_id', tenantId).eq('is_resolved', false),
      rows => {
        const userRole = user?.role;
        const userId = user?.id;
        realAlerts = rows.filter(r => {
          if (r.is_read) return false;
          if (r.target_user_id) return r.target_user_id === userId;
          if (r.target_role) return r.target_role === userRole;
          return isManagerPlusRole(userRole);
        }).length;
        update();
      },
      () => { /* refus RLS ou coupure — ne bloque pas le reste du badge */ },
      `tenant_id=eq.${tenantId}`
    );
    return () => { unsubC(); unsubI?.(); unsubA(); };
  }, [tenant?.id, currentStore?.id, user?.role, user?.id]);

  const initials = `${user?.firstName?.charAt(0) || ''}${user?.lastName?.charAt(0) || ''}`;

  // Le sélecteur (dropdown, changer de magasin) suggère une fonctionnalité
  // Multi-magasins que le forfait n'inclut pas forcément — voir
  // lib/constants (multiStoreEnabled) et app/(dashboard)/transfers/page.tsx.
  // Sans ce garde-fou, un tenant Starter voit un menu de sélection pour une
  // action qu'il ne peut pas faire (il n'a qu'un seul magasin de toute façon,
  // sauf rétrogradation Business → Starter avec des magasins existants).
  const planId = tenant?.subscription?.plan as PlanId | undefined;
  const plan = planId && planId in SUBSCRIPTION_PLANS ? SUBSCRIPTION_PLANS[planId] : SUBSCRIPTION_PLANS.BUSINESS;
  const multiStoreAllowed = plan.features.multiStoreEnabled;

  return (
    <header className="h-16 bg-white border-b border-gray-100 flex items-center justify-between px-4 lg:px-6 shadow-sm">

      {/* Gauche — toggle sidebar + sélecteur magasin */}
      <div className="flex items-center gap-3">
        {/* Mobile : ouvre le tiroir de navigation (voir components/layout/sidebar-nav.tsx).
            Desktop : réduit/agrandit la barre fixe — deux boutons distincts
            car "réduire" n'a pas de sens pour un tiroir qui se ferme entièrement. */}
        <button
          onClick={() => setSidebarOpen(true)}
          title="Ouvrir le menu"
          className="md:hidden p-2 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors flex-shrink-0">
          <Menu className="h-5 w-5" />
        </button>
        <button
          onClick={toggleSidebar}
          title="Réduire/agrandir la sidebar (Ctrl+B)"
          className="hidden md:block p-2 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors flex-shrink-0">
          <PanelLeft className="h-5 w-5" />
        </button>
        {stores.length > 0 && !multiStoreAllowed && (
          // Pas de dropdown ni de flèche : rien à "changer" pour un forfait
          // sans Multi-magasins, on ne montre que le magasin courant.
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-50 border border-gray-200">
            <div className="h-7 w-7 bg-primary-100 rounded-lg flex items-center justify-center">
              <Store className="h-4 w-4 text-primary-600" />
            </div>
            <div className="text-left hidden sm:block">
              <p className="text-sm font-semibold text-gray-800 leading-tight">
                {currentStore?.name || stores[0]?.name || 'Magasin'}
              </p>
              {currentStore?.city && (
                <p className="text-xs text-gray-400 leading-tight">{currentStore.city}</p>
              )}
            </div>
          </div>
        )}
        {stores.length > 0 && multiStoreAllowed && (
          <div className="relative">
            <button onClick={() => setStoreDropdownOpen(!storeDropdownOpen)}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-50 border border-gray-200 hover:bg-gray-100 transition-colors">
              <div className="h-7 w-7 bg-primary-100 rounded-lg flex items-center justify-center">
                <Store className="h-4 w-4 text-primary-600" />
              </div>
              <div className="text-left hidden sm:block">
                <p className="text-sm font-semibold text-gray-800 leading-tight">
                  {currentStore?.name || 'Sélectionner'}
                </p>
                {currentStore?.city && (
                  <p className="text-xs text-gray-400 leading-tight">{currentStore.city}</p>
                )}
              </div>
              <ChevronDown className={cn('h-4 w-4 text-gray-400 transition-transform flex-shrink-0', storeDropdownOpen && 'rotate-180')} />
            </button>

            {storeDropdownOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setStoreDropdownOpen(false)} />
                <div className="absolute left-0 mt-2 w-64 bg-white rounded-xl shadow-xl border border-gray-100 py-1 z-20 overflow-hidden">
                  {stores.map(store => (
                    <button key={store.id} onClick={() => { setCurrentStore(store); setStoreDropdownOpen(false); }}
                      className={cn(
                        'w-full px-4 py-3 text-left hover:bg-gray-50 flex items-center gap-3 transition-colors',
                        currentStore?.id === store.id && 'bg-primary-50'
                      )}>
                      <div className={cn('h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0',
                        currentStore?.id === store.id ? 'bg-primary-100' : 'bg-gray-100')}>
                        <Store className={cn('h-4 w-4', currentStore?.id === store.id ? 'text-primary-600' : 'text-gray-500')} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={cn('font-semibold text-sm', currentStore?.id === store.id ? 'text-primary-700' : 'text-gray-800')}>{store.name}</p>
                        <p className="text-xs text-gray-400 truncate">{store.city || store.address || '—'}</p>
                      </div>
                      {currentStore?.id === store.id && <CheckCircle2 className="h-4 w-4 text-primary-600 flex-shrink-0" />}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Droite — recherche, alertes, settings, profil */}
      <div className="flex items-center gap-1">

        {/* Recherche */}
        {searchOpen ? (
          <div className="flex items-center mr-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input type="text" placeholder="Rechercher..."
                value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                className="w-56 lg:w-80 pl-9 pr-9 py-2 text-sm border-2 border-primary-200 rounded-xl focus:outline-none focus:border-primary-400 bg-gray-50"
                autoFocus />
              <button onClick={() => { setSearchOpen(false); setSearchQuery(''); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setSearchOpen(true)}
            className="p-2.5 rounded-xl text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors">
            <Search className="h-5 w-5" />
          </button>
        )}

        {/* Signaler un problème — canal de retour client, voir
            components/feedback/feedback-dialog.tsx. Dans le header plutôt
            que la sidebar : c'est le seul emplacement visible depuis
            absolument toutes les pages du dashboard. */}
        <button onClick={() => setFeedbackOpen(true)} title="Signaler un problème"
          className="p-2.5 rounded-xl text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors">
          <MessageSquareWarning className="h-5 w-5" />
        </button>
        <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />

        {/* Notifications avec badge */}
        <Link href="/notifications"
          className="relative p-2.5 rounded-xl text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors">
          <Bell className="h-5 w-5" />
          {alertCount > 0 && (
            <span className="absolute top-1.5 right-1.5 h-4 w-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none">
              {alertCount > 9 ? '9+' : alertCount}
            </span>
          )}
        </Link>

        {/* Réglages : visible à tous, pas seulement Owner/Admin — la page
            elle-même limite désormais les blocs entreprise/abonnement/
            parrainage à Owner/Admin (voir settings/page.tsx), mais reste le
            SEUL moyen d'accès à "Mon profil"/"Sécurité" (mot de passe) pour
            les autres rôles : le masquer ici les privait de tout accès
            libre-service à leur propre compte. */}
        <Link href="/settings"
          className="p-2.5 rounded-xl text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors">
          <Settings className="h-5 w-5" />
        </Link>

        {/* Profil utilisateur */}
        <div className="flex items-center gap-2.5 ml-2 pl-2 border-l border-gray-100">
          <div className="h-9 w-9 rounded-xl bg-primary-600 flex items-center justify-center shadow-sm">
            <span className="text-xs font-bold text-white">{initials || 'U'}</span>
          </div>
          <div className="hidden lg:block">
            <p className="text-sm font-semibold text-gray-800 leading-tight">
              {user?.firstName || ''} {user?.lastName || ''}
            </p>
            <p className="text-xs text-gray-400 leading-tight capitalize">
              {user?.role?.toLowerCase() || 'utilisateur'}
            </p>
          </div>
        </div>
      </div>
    </header>
  );
}
