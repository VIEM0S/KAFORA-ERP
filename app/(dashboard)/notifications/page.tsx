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
import {
  collection, query, orderBy, onSnapshot, where,
  doc, updateDoc, deleteDoc, limit, writeBatch
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { tenantCol } from '@/lib/firebase/collections';
import { isManagerPlus as isManagerPlusRole } from '@/lib/auth/roles';

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
    let inventory: { productId: string; storeId: string; quantity: number }[] = [];
    let credits: { id: string; customerName: string; solde: number; dateEcheance: string; status: string }[] = [];

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
        } else if (inv.quantity <= p.alertThreshold) {
          notifs.push({
            id: `stock-low-${inv.productId}`, type: 'STOCK_LOW',
            title: 'Stock faible', message: `${p.name} : ${inv.quantity} restant(s)`,
            isRead: false, link: '/inventory/alerts', createdAt: { seconds: now / 1000 },
          });
        }
      });

      // Crédits en retard / échéance proche
      credits.forEach(c => {
        if (!['PENDING', 'PARTIALLY_PAID', 'OVERDUE'].includes(c.status)) return;
        const echeance = new Date(c.dateEcheance).getTime();
        const diff = echeance - now;
        if (diff < 0) {
          notifs.push({
            id: `credit-overdue-${c.id}`, type: 'CREDIT_OVERDUE',
            title: 'Crédit en retard', message: `${c.customerName} doit ${c.solde.toLocaleString()} FCFA`,
            isRead: false, link: '/credits', createdAt: { seconds: now / 1000 },
          });
        } else if (diff < 48 * 60 * 60 * 1000) {
          notifs.push({
            id: `credit-due-${c.id}`, type: 'CREDIT_DUE_SOON',
            title: 'Échéance proche', message: `${c.customerName} — échéance dans moins de 48h`,
            isRead: false, link: '/credits', createdAt: { seconds: now / 1000 },
          });
        }
      });

      setNotifications(notifs);
      setIsLoading(false);
    };

    const unsubP = onSnapshot(collection(db, tenantCol(tenantId, 'products')), snap => {
      products = {};
      snap.docs.forEach(d => {
        products[d.id] = {
          name: d.data().name,
          alertThreshold: d.data().alertThreshold || 10,
          trackInventory: d.data().trackInventory,
        };
      });
      buildNotifications();
    });

    const unsubI = onSnapshot(
      query(collection(db, tenantCol(tenantId, 'inventory')), where('storeId', '==', storeId)),
      snap => {
      inventory = snap.docs.map(d => ({
        productId: d.data().productId, storeId: d.data().storeId, quantity: d.data().quantity || 0,
      }));
      buildNotifications();
    });

    const unsubC = onSnapshot(
      query(collection(db, tenantCol(tenantId, 'credits')),
        where('status', 'in', ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'])),
      snap => {
        credits = snap.docs.map(d => ({
          id: d.id, customerName: d.data().customerName,
          solde: d.data().solde, dateEcheance: d.data().dateEcheance, status: d.data().status,
        }));
        buildNotifications();
      }
    );

    return () => { unsubP(); unsubI(); unsubC(); };
  }, [tenantId, storeId]);

  return { notifications, isLoading };
}

// Lit la vraie collection `alerts` (écrite côté serveur : demandes de
// suppression, conflits de synchronisation offline, remboursements...).
// Fix : ces alertes étaient écrites depuis plusieurs routes API mais
// n'étaient jamais lues nulle part — un Propriétaire ne voyait donc jamais
// une demande de suppression en attente dans /notifications.
function useFirestoreAlerts(tenantId: string | undefined, userRole: string | undefined, currentUserId: string | undefined) {
  const [alerts, setAlerts] = useState<Notification[]>([]);

  useEffect(() => {
    if (!tenantId || !userRole) { setAlerts([]); return; }
    const q = query(
      collection(db, tenantCol(tenantId, 'alerts')),
      where('isResolved', '==', false),
      orderBy('createdAt', 'desc'),
      limit(50)
    );
    return onSnapshot(q, snap => {
      const items: Notification[] = [];
      snap.docs.forEach(d => {
        const data = d.data();
        // Une alerte peut cibler soit un rôle entier (targetRole — ex: toute
        // demande de suppression va à OWNER), soit un utilisateur précis
        // (targetUserId — ex: "ta demande a été approuvée" ne doit être vue
        // QUE par l'Admin qui l'a faite, pas par tout Manager+).
        const targetRole = data.targetRole as string | undefined;
        const targetUserId = data.targetUserId as string | undefined;
        if (targetUserId) {
          if (targetUserId !== currentUserId) return;
        } else if (targetRole) {
          if (targetRole !== userRole) return;
        } else {
          const isManagerPlus = isManagerPlusRole(userRole);
          if (!isManagerPlus) return;
        }
        if (data.isRead) return;
        items.push({
          id: d.id, type: data.type, title: data.title, message: data.message,
          isRead: !!data.isRead, link: data.reference === 'users' ? '/users' : undefined,
          createdAt: data.createdAt, source: 'firestore',
        });
      });
      setAlerts(items);
    });
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
    // les vraies alertes Firestore doivent être marquées lues pour de bon,
    // sinon elles réapparaîtraient à chaque rechargement de la page.
    if (n.source === 'firestore' && tenantId) {
      updateDoc(doc(db, tenantCol(tenantId, 'alerts'), n.id), { isRead: true }).catch(() => {});
    }
  };
  const dismissAll = () => {
    setDismissed(new Set(notifications.map(n => n.id)));
    if (tenantId) {
      firestoreAlerts.forEach(n => {
        updateDoc(doc(db, tenantCol(tenantId, 'alerts'), n.id), { isRead: true }).catch(() => {});
      });
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
