'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ArrowRightLeft, Building2,
  LayoutDashboard, Package, Warehouse, ShoppingCart,
  Receipt, FileText, Users, CreditCard, Truck,
  DollarSign, BarChart3, Store, Bell, Settings,
  ChevronDown, ChevronRight, LogOut, Tag, AlertTriangle,
  History, User, PackagePlus
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils/helpers';
import { useAuthStore, useUIStore } from '@/hooks/store';
import { useLogout } from '@/hooks/useAuth';
import { COMPANY_COLORS } from '@/lib/constants';
import { collection, query, where } from 'firebase/firestore';
// onSnapshot vient d'ici : l'enveloppe remonte les échecs au bandeau global
// (voir lib/firebase/watch.ts), au lieu de laisser l'écran vide sans explication.
import { onSnapshot } from '@/lib/firebase/watch';
import { db } from '@/lib/firebase/client';
import { tenantCol } from '@/lib/firebase/collections';

interface NavItem {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
  badgeKey?: string;
  roles?: string[];
  children?: NavItem[];
}

const NAV_ITEMS: NavItem[] = [
  // Console éditeur : visible uniquement pour le rôle SUPER_ADMIN, qui ne
  // peut pas être attribué depuis l'application (voir scripts/promote-super-admin).
  { title: 'Clients Kafora', href: '/admin', icon: Building2, roles: ['SUPER_ADMIN'] },
  { title: 'Tableau de bord', href: '/dashboard', icon: LayoutDashboard, roles: ['OWNER', 'ADMIN', 'MANAGER'] },
  {
    title: 'Ventes', href: '/sales', icon: ShoppingCart,
    children: [
      { title: 'Point de vente', href: '/pos', icon: Receipt },
      { title: 'Historique', href: '/sales', icon: FileText },
      { title: 'Devis', href: '/quotes', icon: FileText },
    ],
  },
  {
    title: 'Produits', href: '/products', icon: Package,
    children: [
      { title: 'Catalogue', href: '/products', icon: Package },
      { title: 'Catégories', href: '/products/categories', icon: Tag },
    ],
  },
  {
    title: 'Stock', href: '/inventory', icon: Warehouse,
    children: [
      { title: 'Inventaire', href: '/inventory', icon: Warehouse },
      { title: 'Mouvements', href: '/inventory/movements', icon: History },
      { title: 'Alertes', href: '/inventory/alerts', icon: AlertTriangle, badgeKey: 'lowStock' },
      { title: 'Bons de commande', href: '/purchase-orders', icon: PackagePlus, roles: ['OWNER', 'ADMIN', 'MANAGER'] },
      { title: 'Transferts', href: '/transfers', icon: ArrowRightLeft, roles: ['OWNER', 'ADMIN', 'MANAGER'] },
    ],
  },
  { title: 'Clients', href: '/customers', icon: Users },
  { title: 'Crédits', href: '/credits', icon: CreditCard, badgeKey: 'overdueCredits' },
  { title: 'Fournisseurs', href: '/suppliers', icon: Truck },
  { title: 'Caisse', href: '/cash-register', icon: DollarSign },
  { title: 'Factures', href: '/invoices', icon: FileText },
  { title: 'Analytics', href: '/analytics', icon: BarChart3, roles: ['OWNER', 'ADMIN', 'MANAGER'] },
  { title: 'Magasins', href: '/stores', icon: Store, roles: ['OWNER', 'ADMIN'] },
  { title: 'Notifications', href: '/notifications', icon: Bell },
];

const ADMIN_ITEMS: NavItem[] = [
  { title: 'Utilisateurs', href: '/users', icon: User, roles: ['OWNER', 'ADMIN'] },
  { title: 'Paramètres', href: '/settings', icon: Settings },
];

function NavItemComponent({
  item, collapsed, depth = 0, getBadge
}: {
  item: NavItem; collapsed: boolean; depth?: number; getBadge: (key?: string, val?: number) => number;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = pathname === item.href || (item.children?.some(c => pathname === c.href));
  const hasChildren = item.children && item.children.length > 0;
  const badge = getBadge(item.badgeKey, item.badge);

  useEffect(() => {
    if (isActive && hasChildren) setOpen(true);
  }, [pathname]);

  if (hasChildren) {
    return (
      <div>
        <button onClick={() => setOpen(!open)}
          className={cn(
            'w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-xl transition-all',
            isActive ? 'bg-primary-50 text-primary-700 font-semibold' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
          )}>
          <item.icon className={cn('h-5 w-5 flex-shrink-0', isActive ? 'text-primary-600' : 'text-gray-400')} />
          {!collapsed && (
            <>
              <span className="flex-1 text-left">{item.title}</span>
              {badge > 0 && (
                <span className="h-5 min-w-[20px] px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
              {open ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
            </>
          )}
        </button>
        {!collapsed && open && (
          <div className="ml-4 mt-1 space-y-0.5 border-l-2 border-gray-100 pl-3">
            {item.children!.map(child => (
              <NavItemComponent key={child.href} item={child} collapsed={false} depth={depth + 1} getBadge={getBadge} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <Link href={item.href}
      style={isActive ? { backgroundColor: '#2563eb', color: '#ffffff' } : {}}
      className={cn(
        'flex items-center gap-3 px-3 py-2.5 text-sm rounded-xl transition-all',
        depth > 0 ? 'font-normal' : 'font-medium',
        isActive
          ? 'shadow-sm'
          : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
      )}>
      <item.icon className={cn('h-4 w-4 flex-shrink-0', isActive ? 'text-white' : depth > 0 ? 'text-gray-400' : 'text-gray-500')} />
      {!collapsed && (
        <>
          <span className={cn('flex-1 truncate', isActive ? 'text-white' : '')}>{item.title}</span>
          {badge > 0 && (
            <span className={cn(
              'h-5 min-w-[20px] px-1 text-[10px] font-bold rounded-full flex items-center justify-center',
              isActive ? 'bg-white text-primary-600' : 'bg-red-500 text-white'
            )}>
              {badge > 99 ? '99+' : badge}
            </span>
          )}
        </>
      )}
    </Link>
  );
}

export function Sidebar() {
  const { sidebarCollapsed } = useUIStore();
  const { user, tenant, currentStore } = useAuthStore();
  const handleLogout = useLogout();
  const [lowStockCount, setLowStockCount] = useState(0);
  const [overdueCount, setOverdueCount] = useState(0);

  useEffect(() => {
    const tenantId = tenant?.id;
    const storeId = currentStore?.id;
    if (!tenantId || !storeId) return;

    const unsubCred = onSnapshot(
      query(collection(db, tenantCol(tenantId, 'credits')), where('status', '==', 'OVERDUE')),
      snap => setOverdueCount(snap.size)
    );

    const unsubInv = onSnapshot(
      query(collection(db, tenantCol(tenantId, 'inventory')), where('storeId', '==', storeId)),
      async snap => {
      const { getDocs } = await import('firebase/firestore');
      const prodSnap = await getDocs(collection(db, tenantCol(tenantId, 'products')));
      const thresh: Record<string, number> = {};
      prodSnap.docs.forEach(d => { thresh[d.id] = d.data().alertThreshold || 10; });
      const low = snap.docs.filter(d => {
        const data = d.data();
        return data.storeId === storeId && (data.quantity || 0) <= (thresh[data.productId] || 10);
      }).length;
      setLowStockCount(low);
    });

    return () => { unsubCred(); unsubInv(); };
  }, [tenant?.id, currentStore?.id]);

  const getBadge = (key?: string, val?: number): number => {
    if (key === 'lowStock') return lowStockCount;
    if (key === 'overdueCredits') return overdueCount;
    return val || 0;
  };

  const userRole = user?.role || 'CASHIER';
  // SUPER_ADMIN (rôle éditeur) voit tout : sans cette exception, se promouvoir
  // ferait DISPARAÎTRE le tableau de bord, le POS et le reste, puisqu'aucune
  // entrée ne mentionne ce rôle dans sa liste. C'est cohérent avec
  // ROLE_PERMISSIONS, où SUPER_ADMIN a toutes les permissions.
  // Un compte éditeur n'appartient à aucun tenant : les pages métier
  // (POS, stock, ventes…) n'auraient aucune donnée à afficher et
  // planteraient sur un tenantId absent. On ne lui montre donc que ce qui
  // le concerne : la console clients.
  const isPublisher = userRole === 'SUPER_ADMIN';
  const allowed = (item: { roles?: string[] }) =>
    isPublisher
      ? item.roles?.includes('SUPER_ADMIN') ?? false
      : !item.roles || item.roles.includes(userRole);

  const filteredNav = NAV_ITEMS.filter(allowed);
  const filteredAdmin = ADMIN_ITEMS.filter(allowed);

  const collapsed = sidebarCollapsed;

  return (
    <aside className={cn(
      'fixed left-0 top-0 z-40 h-screen bg-white border-r border-gray-100 transition-all duration-300 flex flex-col shadow-sm',
      collapsed ? 'w-16' : 'w-64'
    )}>
      {/* Logo */}
      <div className={cn('flex items-center h-16 px-4 border-b border-gray-100 flex-shrink-0', collapsed ? 'justify-center' : 'gap-3')}>
        <div className="h-9 w-9 bg-primary-600 rounded-xl flex items-center justify-center shadow-sm flex-shrink-0">
          <Store className="h-5 w-5 text-white" />
        </div>
        {!collapsed && (
          <div>
            <p className="text-base font-bold text-gray-900 leading-tight">KAFORA</p>
            <p className="text-xs text-gray-400 leading-tight">ERP</p>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-0.5">
        {filteredNav.map(item => (
          <NavItemComponent key={item.href} item={item} collapsed={collapsed} getBadge={getBadge} />
        ))}

        {/* Séparateur admin */}
        {filteredAdmin.length > 0 && (
          <>
            {!collapsed && (
              <div className="pt-4 pb-2 px-3">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Administration</p>
              </div>
            )}
            {collapsed && <div className="my-2 border-t border-gray-100 mx-2" />}
            {filteredAdmin.map(item => (
              <NavItemComponent key={item.href} item={item} collapsed={collapsed} getBadge={getBadge} />
            ))}
          </>
        )}
      </nav>

      {/* Profil + déconnexion */}
      <div className="border-t border-gray-100 p-3 flex-shrink-0">
        {!collapsed ? (
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 bg-primary-600 rounded-xl flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-bold text-white">
                {(user?.firstName?.[0] || '') + (user?.lastName?.[0] || '')}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-800 truncate">{user?.firstName} {user?.lastName}</p>
              <p className="text-xs text-gray-400 truncate">{user?.email}</p>
            </div>
            <button onClick={handleLogout} title="Déconnexion"
              className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button onClick={handleLogout} title="Déconnexion"
            className="w-full flex items-center justify-center p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors">
            <LogOut className="h-4 w-4" />
          </button>
        )}
      </div>
    </aside>
  );
}
