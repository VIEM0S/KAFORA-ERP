'use client';

import { Bell, Search, Settings, Store, X, ChevronDown, CheckCircle2, PanelLeft } from 'lucide-react';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils/helpers';
import { useAuthStore, useUIStore } from '@/hooks/store';
import { collection, query, where } from 'firebase/firestore';
// onSnapshot vient d'ici : l'enveloppe remonte les échecs au bandeau global
// (voir lib/firebase/watch.ts), au lieu de laisser l'écran vide sans explication.
import { onSnapshot } from '@/lib/firebase/watch';
import { db } from '@/lib/firebase/client';
import { tenantCol } from '@/lib/firebase/collections';
import { isManagerPlus as isManagerPlusRole, isOwnerOrAdmin as isOwnerOrAdminRole } from '@/lib/auth/roles';

export function Header() {
  const { user, tenant, currentStore, stores, setCurrentStore } = useAuthStore();
  const { toggleSidebar } = useUIStore();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [storeDropdownOpen, setStoreDropdownOpen] = useState(false);
  const [alertCount, setAlertCount] = useState(0);

  // Badge live — stock faible + crédits en retard + vraies alertes
  // (demandes de suppression, conflits de synchro offline...). Fix : ce badge
  // ne comptait jamais ces dernières, donc ni l'Admin ni le Propriétaire
  // n'avaient d'indicateur visible sans aller cliquer sur /notifications.
  useEffect(() => {
    const tenantId = tenant?.id;
    if (!tenantId) return;
    let low = 0;
    let overdue = 0;
    let realAlerts = 0;
    const update = () => setAlertCount(low + overdue + realAlerts);

    const unsubC = onSnapshot(
      query(collection(db, tenantCol(tenantId, 'credits')), where('status', '==', 'OVERDUE')),
      snap => { overdue = snap.size; update(); }
    );
    const unsubI = onSnapshot(
      query(collection(db, tenantCol(tenantId, 'inventory')), where('storeId', '==', currentStore?.id || '')),
      async snap => {
      const { getDocs } = await import('firebase/firestore');
      const prodSnap = await getDocs(collection(db, tenantCol(tenantId, 'products')));
      const thresh: Record<string, number> = {};
      prodSnap.docs.forEach(d => { thresh[d.id] = d.data().alertThreshold || 10; });
      low = snap.docs.filter(d => {
        const data = d.data();
        return data.storeId === currentStore?.id && (data.quantity || 0) <= (thresh[data.productId] || 10);
      }).length;
      update();
    });
    const unsubA = onSnapshot(
      query(collection(db, tenantCol(tenantId, 'alerts')), where('isResolved', '==', false)),
      snap => {
        const userRole = user?.role;
        const userId = user?.id;
        realAlerts = snap.docs.filter(d => {
          const data = d.data();
          if (data.isRead) return false;
          if (data.targetUserId) return data.targetUserId === userId;
          if (data.targetRole) return data.targetRole === userRole;
          return isManagerPlusRole(userRole);
        }).length;
        update();
      },
      () => { /* index manquant ou permission — ne bloque pas le reste du badge */ }
    );
    return () => { unsubC(); unsubI(); unsubA(); };
  }, [tenant?.id, currentStore?.id, user?.role, user?.id]);

  const initials = `${user?.firstName?.charAt(0) || ''}${user?.lastName?.charAt(0) || ''}`;

  return (
    <header className="h-16 bg-white border-b border-gray-100 flex items-center justify-between px-4 lg:px-6 shadow-sm">

      {/* Gauche — toggle sidebar + sélecteur magasin */}
      <div className="flex items-center gap-3">
        <button
          onClick={toggleSidebar}
          title="Réduire/agrandir la sidebar (Ctrl+B)"
          className="p-2 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors flex-shrink-0">
          <PanelLeft className="h-5 w-5" />
        </button>
        {stores.length > 0 && (
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

        {/* Settings (Owner/Admin seulement) */}
        {isOwnerOrAdminRole(user?.role) && (
          <Link href="/settings"
            className="p-2.5 rounded-xl text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors">
            <Settings className="h-5 w-5" />
          </Link>
        )}

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
