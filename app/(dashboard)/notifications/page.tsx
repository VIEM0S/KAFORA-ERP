'use client';

import { useState, useEffect } from 'react';
import {
  Bell, CheckCircle2, AlertTriangle, CreditCard,
  Package, ShoppingCart, RefreshCw, Check, Trash2, BellOff, ShieldAlert
} from 'lucide-react';
import { DashboardLayout } from '@/components/layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/hooks/store';
import { useRouter } from 'next/navigation';
import { formatRelativeTime } from '@/lib/utils/helpers';
import { supabase } from '@/lib/supabase/client';
// watch vient d'ici : l'enveloppe remonte les échecs au bandeau global
// (voir lib/supabase/watch.ts), au lieu de laisser l'écran vide sans explication.
import { watch } from '@/lib/supabase/watch';
import { isManagerPlus as isManagerPlusRole } from '@/lib/auth/roles';
import { estEnAlerte } from '@/lib/inventory/alert-threshold';

interface Notification {
  id: string;
  userId?: string;
  type: 'STOCK_LOW' | 'STOCK_RUPTURE' | 'CREDIT_OVERDUE' | 'CREDIT_DUE_SOON' | 'SALE' | 'SYSTEM'
    | 'USER_DELETION_REQUEST' | 'USER_DELETION_RESOLVED' | 'OFFLINE_SYNC_CONFLICT' | 'REFUND';
  title: string;
  message: string;
  isRead: boolean;
  link?: string;
  createdAt: unknown;
  source?: 'derived' | 'firestore'; // firestore = vient de la collection `alerts`, dismiss doit persister
}

const TYPE_CONFIG: Record<string, { icon: typeof Bell; color: string; bg: string }> = {
  STOCK_LOW:              { icon: Package,      color: 'text-amber-600', bg: 'bg-amber-100' },
  STOCK_RUPTURE:          { icon: AlertTriangle, color: 'text-red-600',   bg: 'bg-red-100' },
  CREDIT_OVERDUE:         { icon: CreditCard,    color: 'text-red-600',   bg: 'bg-red-100' },
  CREDIT_DUE_SOON:        { icon: CreditCard,    color: 'text-amber-600', bg: 'bg-amber-100' },
  SALE:                   { icon: ShoppingCart,  color: 'text-green-600', bg: 'bg-green-100' },
  SYSTEM:                 { icon: Bell,          color: 'text-blue-600',  bg: 'bg-blue-100' },
  USER_DELETION_REQUEST:  { icon: ShieldAlert,   color: 'text-red-600',   bg: 'bg-red-100' },
  USER_DELETION_RESOLVED: { icon: ShieldAlert,   color: 'text-blue-600',  bg: 'bg-blue-100' },
  OFFLINE_SYNC_CONFLICT:  { icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-100' },
  REFUND:                 { icon: CreditCard,    color: 'text-amber-600', bg: 'bg-amber-100' },
};

// Génère des notifications dérivées en temps réel (sans collection dédiée)
function useDerivedNotifications(tenantId: string | undefined, storeId: string | undefined) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!tenantId) return;
    let products: Record<string, { name: string; alertThreshold: number; trackInventory: boolean }> = {};
    let inventory: { productId: string; storeId: string; quantity: number; minQuantity: number | null }[] = [];
    let credits: { id: string; customerName: string | null; remainingAmount: number; dueDate: string | null; status: string }[] = [];

    const buildNotifications = () => {
      const notifs: Notification[] = [];
      const now = Date.now();

      // Stock faible / rupture
      inventory.forEach(inv => {
        if (inv.storeId !== storeId) return;
        const p = products[inv.productId];
        if (!p || !p.trackInventory) return;
        if (inv.quantity === 0) {
          notifs.push({
            id: `stock-rupture-${inv.productId}`, type: 'STOCK_RUPTURE',
            title: 'Rupture de stock', message: `${p.name} est en rupture de stock`,
            isRead: false, link: '/inventory/alerts', createdAt: { seconds: now / 1000 },
          });
        } else if (estEnAlerte(inv.quantity, {
          seuilMagasin: inv.minQuantity ?? undefined,
          seuilProduit: p.alertThreshold,
        })) {
          notifs.push({
            id: `stock-low-${inv.productId}`, type: 'STOCK_LOW',
            title: 'Stock faible', message: `${p.name} : ${inv.quantity} restant(s)`,
            isRead: false, link: '/inventory/alerts', createdAt: { seconds: now / 1000 },
          });
        }
      });

      // Crédits en retard / échéance proche
      credits.forEach(c => {
        if (!['PENDING', 'PARTIALLY_PAID', 'OVERDUE'].includes(c.status) || !c.dueDate) return;
        const echeance = new Date(c.dueDate).getTime();
        const diff = echeance - now;
        const customerName = c.customerName || 'Client supprimé';
        if (diff < 0) {
          notifs.push({
            id: `credit-overdue-${c.id}`, type: 'CREDIT_OVERDUE',
            title: 'Crédit en retard', message: `${customerName} doit ${c.remainingAmount.toLocaleString()} FCFA`,
            isRead: false, link: '/credits', createdAt: { seconds: now / 1000 },
          });
        } else if (diff < 48 * 60 * 60 * 1000) {
          notifs.push({
            id: `credit-due-${c.id}`, type: 'CREDIT_DUE_SOON',
            title: 'Échéance proche', message: `${customerName} — échéance dans moins de 48h`,
            isRead: false, link: '/credits', createdAt: { seconds: now / 1000 },
          });
        }
      });

      setNotifications(notifs);
      setIsLoading(false);
    };

    const unsubP = watch(
      'products',
      () => supabase.from('products').select('id, name, alert_threshold, track_inventory').eq('tenant_id', tenantId),
      rows => {
        products = {};
        rows.forEach(r => {
          products[r.id] = {
            name: r.name,
            // `??` et non `||` : un seuil à 0 signifie « ne pas alerter »
            // et doit être respecté tel quel.
            alertThreshold: r.alert_threshold ?? 10,
            trackInventory: r.track_inventory,
          };
        });
        buildNotifications();
      },
      undefined,
      `tenant_id=eq.${tenantId}`
    );

    const unsubI = watch(
      'inventory',
      () => supabase.from('inventory').select('product_id, store_id, quantity, min_quantity').eq('tenant_id', tenantId),
      rows => {
        inventory = rows.map(r => ({
          productId: r.product_id, storeId: r.store_id, quantity: r.quantity || 0, minQuantity: r.min_quantity,
        }));
        buildNotifications();
      },
      undefined,
      `tenant_id=eq.${tenantId}`
    );

    const unsubC = watch(
      'credits',
      () => supabase.from('credits').select('id, customer_name, remaining_amount, due_date, status')
        .eq('tenant_id', tenantId).in('status', ['PENDING', 'PARTIALLY_PAID', 'OVERDUE']),
      rows => {
        credits = rows.map(r => ({
          id: r.id, customerName: r.customer_name,
          remainingAmount: r.remaining_amount, dueDate: r.due_date, status: r.status,
        }));
        buildNotifications();
      },
      undefined,
      `tenant_id=eq.${tenantId}`
    );

    return () => { unsubP(); unsubI(); unsubC(); };
  }, [tenantId, storeId]);

  return { notifications, isLoading };
}

// Lit la vraie table `alerts` (écrite côté serveur : demandes de
// suppression, conflits de synchronisation offline, remboursements...).
// Fix (héritage Firestore) : ces alertes étaient écrites depuis plusieurs
// routes API mais n'étaient jamais lues nulle part — un Propriétaire ne
// voyait donc jamais une demande de suppression en attente ici.
function useFirestoreAlerts(tenantId: string | undefined, userRole: string | undefined, currentUserId: string | undefined) {
  const [alerts, setAlerts] = useState<Notification[]>([]);

  useEffect(() => {
    if (!tenantId || !userRole) { setAlerts([]); return; }
    return watch(
      'alerts',
      () => supabase.from('alerts').select('*').eq('tenant_id', tenantId).eq('is_resolved', false)
        .order('created_at', { ascending: false }).limit(50),
      rows => {
        const items: Notification[] = [];
        rows.forEach(data => {
          // Une alerte peut cibler soit un rôle entier (target_role — ex:
          // toute demande de suppression va à OWNER), soit un utilisateur
          // précis (target_user_id — ex: "ta demande a été approuvée" ne
          // doit être vue QUE par l'Admin qui l'a faite, pas par tout
          // Manager+).
          if (data.target_user_id) {
            if (data.target_user_id !== currentUserId) return;
          } else if (data.target_role) {
            if (data.target_role !== userRole) return;
          } else {
            if (!isManagerPlusRole(userRole)) return;
          }
          if (data.is_read) return;
          items.push({
            id: data.id, type: data.type as Notification['type'], title: data.title, message: data.message || '',
            isRead: !!data.is_read, link: data.reference === 'users' ? '/users' : undefined,
            createdAt: data.created_at, source: 'firestore',
          });
        });
        setAlerts(items);
      },
      undefined,
      `tenant_id=eq.${tenantId}`
    );
  }, [tenantId, userRole, currentUserId]);

  return alerts;
}

export default function NotificationsPage() {
  const { tenant, currentStore, user } = useAuthStore();
  const router = useRouter();
  const tenantId = tenant?.id;
  const storeId = currentStore?.id;

  const { notifications: derived, isLoading } = useDerivedNotifications(tenantId, storeId);
  const firestoreAlerts = useFirestoreAlerts(tenantId, user?.role, user?.id);
  const notifications = [...firestoreAlerts, ...derived];
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const visible = notifications.filter(n => !dismissed.has(n.id));

  const dismiss = (n: Notification) => {
    setDismissed(prev => new Set(prev).add(n.id));
    // Les alertes dérivées (stock/crédits) n'existent pas en base — seules
    // les vraies alertes doivent être marquées lues pour de bon, sinon
    // elles réapparaîtraient à chaque rechargement de la page.
    if (n.source === 'firestore') {
      supabase.from('alerts').update({ is_read: true }).eq('id', n.id).then(() => {});
    }
  };
  const dismissAll = () => {
    setDismissed(new Set(notifications.map(n => n.id)));
    if (firestoreAlerts.length > 0) {
      supabase.from('alerts').update({ is_read: true }).in('id', firestoreAlerts.map(n => n.id)).then(() => {});
    }
  };

  const handleClick = (n: Notification) => {
    if (n.link) router.push(n.link);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-2xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Notifications</h1>
            <p className="text-sm text-gray-500 mt-1">
              {visible.length} notification{visible.length !== 1 ? 's' : ''} active{visible.length !== 1 ? 's' : ''}
            </p>
          </div>
          {visible.length > 0 && (
            <Button variant="outline" size="sm" onClick={dismissAll}>
              <Check className="h-4 w-4 mr-2" />Tout marquer comme lu
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <RefreshCw className="h-5 w-5 animate-spin mr-2" />Chargement...
          </div>
        ) : visible.length === 0 ? (
          <Card><CardContent className="flex flex-col items-center justify-center py-20 text-gray-400">
            <BellOff className="h-16 w-16 mb-4 opacity-30" />
            <p className="text-lg font-medium text-gray-500">Aucune notification</p>
            <p className="text-sm mt-1">Vous êtes à jour ! Les alertes stock et crédits apparaîtront ici.</p>
          </CardContent></Card>
        ) : (
          <div className="space-y-2">
            {visible.map(n => {
              const cfg = TYPE_CONFIG[n.type] ?? TYPE_CONFIG.SYSTEM;
              const Icon = cfg.icon;
              return (
                <Card key={n.id} className="hover:shadow-md transition-shadow cursor-pointer">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className={`h-10 w-10 rounded-xl ${cfg.bg} flex items-center justify-center flex-shrink-0`}>
                        <Icon className={`h-5 w-5 ${cfg.color}`} />
                      </div>
                      <div className="flex-1 min-w-0" onClick={() => handleClick(n)}>
                        <p className="font-medium text-gray-900 text-sm">{n.title}</p>
                        <p className="text-sm text-gray-500 mt-0.5">{n.message}</p>
                        <p className="text-xs text-gray-400 mt-1">{formatRelativeTime(n.createdAt)}</p>
                      </div>
                      <button onClick={() => dismiss(n)} className="text-gray-300 hover:text-gray-500 flex-shrink-0">
                        <Check className="h-4 w-4" />
                      </button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
