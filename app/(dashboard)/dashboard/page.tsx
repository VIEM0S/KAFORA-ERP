'use client';

import { useEffect, useState } from 'react';
import {
  TrendingUp, DollarSign, Package, CreditCard,
  AlertTriangle, ShoppingCart, ArrowUpRight, ArrowDownRight,
  Users, BarChart3, RefreshCw, Clock, CheckCircle2
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DashboardLayout } from '@/components/layout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatCurrency, formatRelativeTime } from '@/lib/utils/helpers';
import { useAuthStore } from '@/hooks/store';
import {
  collection, collectionGroup, query, orderBy, onSnapshot,
  where, limit, getDocs, Timestamp
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { tenantCol } from '@/lib/firebase/collections';
import { isManagerPlus as isManagerPlusRole } from '@/lib/auth/roles';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Sale {
  id: string; total: number; status: string; paymentMethod?: string;
  customerName?: string; createdAt: unknown; costTotal?: number;
}
interface SaleItem {
  productId: string; productName: string; quantity: number; total: number; costTotal?: number;
}
interface Product { id: string; name: string; sku: string; unit: string; alertThreshold: number; purchasePrice: number; trackInventory: boolean; }
interface InventoryItem { id: string; productId: string; storeId: string; quantity: number; }
interface Credit { id: string; customerName: string; solde: number; dateEcheance: string; status: string; }
interface Category { id: string; name: string; }

// ─── Hook données dashboard ───────────────────────────────────────────────────

function useDashboardData(tenantId: string | undefined, isManagerPlus: boolean) {
  const [sales, setSales] = useState<Sale[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [credits, setCredits] = useState<Credit[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [monthlyCostTotal, setMonthlyCostTotal] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!tenantId) return;
    let loaded = 0;
    const checkDone = () => { loaded++; if (loaded >= 4) setIsLoading(false); };

    const unsubS = onSnapshot(
      query(collection(db, tenantCol(tenantId, 'sales')), orderBy('createdAt', 'desc'), limit(300)),
      snap => { setSales(snap.docs.map(d => ({ id: d.id, ...d.data() })) as Sale[]); checkDone(); }
    );
    const unsubP = onSnapshot(
      query(collection(db, tenantCol(tenantId, 'products')), where('isActive', '==', true)),
      snap => { setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() })) as Product[]); checkDone(); }
    );
    const unsubI = onSnapshot(
      collection(db, tenantCol(tenantId, 'inventory')),
      snap => { setInventory(snap.docs.map(d => ({ id: d.id, ...d.data() })) as InventoryItem[]); checkDone(); }
    );
    const unsubC = onSnapshot(
      query(collection(db, tenantCol(tenantId, 'credits')), orderBy('dateEcheance', 'asc'), limit(10)),
      snap => { setCredits(snap.docs.map(d => ({ id: d.id, ...d.data() })) as Credit[]); checkDone(); }
    );
    const unsubCat = onSnapshot(
      collection(db, tenantCol(tenantId, 'categories')),
      snap => setCategories(snap.docs.map(d => ({ id: d.id, ...d.data() })) as Category[])
    );

    return () => { unsubS(); unsubP(); unsubI(); unsubC(); unsubCat(); };
  }, [tenantId]);

  // Coût/marge réel — réservé aux Managers+ (voir firestore.rules cost_summary).
  // Un Caissier n'a pas les droits de lecture sur cette collection : on ne
  // lance même pas la requête pour lui, pour ne pas déclencher d'erreur de
  // permission inutile et pour qu'aucune donnée de coût n'atteigne jamais
  // son navigateur.
  useEffect(() => {
    if (!tenantId || !isManagerPlus) { setMonthlyCostTotal(null); return; }
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const unsub = onSnapshot(
      query(
        collectionGroup(db, 'cost_summary'),
        where('tenantId', '==', tenantId),
        where('createdAt', '>=', Timestamp.fromDate(startOfMonth))
      ),
      snap => {
        const total = snap.docs.reduce((s, d) => s + (d.data().costTotal || 0), 0);
        setMonthlyCostTotal(total);
      },
      () => setMonthlyCostTotal(null)
    );
    return () => unsub();
  }, [tenantId, isManagerPlus]);

  return { sales, products, inventory, credits, categories, monthlyCostTotal, isLoading };
}

// ─── Calculs ──────────────────────────────────────────────────────────────────

function getDateStr(daysAgo = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter();
  const { tenant, currentStore, user } = useAuthStore();
  const tenantId = tenant?.id;
  const storeId = currentStore?.id;
  const isManagerPlus = isManagerPlusRole(user?.role);

  // Fix (demande explicite) : le CA jour/mois est réservé à Manager+. Le menu
  // et la redirection post-login évitent déjà ce cas, ceci protège contre un
  // accès direct par URL/favori.
  useEffect(() => {
    if (user && !isManagerPlus) router.replace('/pos');
  }, [user, isManagerPlus, router]);

  const { sales, products, inventory, credits, categories, monthlyCostTotal, isLoading } = useDashboardData(tenantId, isManagerPlus);

  // ─── Calculs stats ──────────────────────────────────────────────────────────

  const today = getDateStr(0);
  const yesterday = getDateStr(1);
  const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

  const toTimestamp = (v: unknown): string => {
    if (!v) return '';
    if (typeof v === 'object' && v !== null && 'seconds' in v) {
      return new Date((v as { seconds: number }).seconds * 1000).toISOString();
    }
    if (typeof v === 'object' && v !== null && 'toDate' in v) {
      return (v as { toDate: () => Date }).toDate().toISOString();
    }
    return String(v);
  };

  const completedSales = sales.filter(s => s.status === 'COMPLETED');
  const todaySales = completedSales.filter(s => toTimestamp(s.createdAt) >= today);
  const yesterdaySales = completedSales.filter(s => {
    const ts = toTimestamp(s.createdAt);
    return ts >= yesterday && ts < today;
  });
  const monthSales = completedSales.filter(s => toTimestamp(s.createdAt) >= startOfMonth);

  const sum = (arr: Sale[]) => arr.reduce((a, s) => a + (s.total || 0), 0);
  const todayRevenue = sum(todaySales);
  const yesterdayRevenue = sum(yesterdaySales);
  const monthlyRevenue = sum(monthSales);
  const todayChange = yesterdayRevenue > 0 ? ((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100 : 0;

  // Marge mensuelle — calculée côté serveur (cost_summary), réservée aux Managers+
  const monthlyProfit = isManagerPlus && monthlyCostTotal !== null
    ? monthlyRevenue - monthlyCostTotal
    : null;

  // Stock
  const getStock = (pId: string) => inventory.find(i => i.productId === pId && i.storeId === storeId)?.quantity ?? 0;
  const lowStockProducts = products.filter(p => p.trackInventory && getStock(p.id) <= p.alertThreshold);
  const ruptureProducts = products.filter(p => p.trackInventory && getStock(p.id) === 0);
  // Valeur du stock au prix d'achat — donnée sensible, réservée aux Managers+
  const valeurStock = isManagerPlus
    ? products.reduce((s, p) => s + getStock(p.id) * p.purchasePrice, 0)
    : null;

  // Crédits
  const activeCredits = credits.filter(c => ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'].includes(c.status));
  const overdueCredits = credits.filter(c => c.status === 'OVERDUE');
  const totalCreditEnCours = activeCredits.reduce((s, c) => s + c.solde, 0);

  // Ventes récentes
  const recentSales = sales.slice(0, 8);

  // ─── Render ─────────────────────────────────────────────────────────────────

  const greet = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Bonjour';
    if (h < 18) return 'Bon après-midi';
    return 'Bonsoir';
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {greet()}{tenant?.name ? `, ${tenant.name}` : ''} 👋
            </h1>
            <p className="text-gray-500 text-sm mt-1">
              {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>
          {isLoading && <RefreshCw className="h-5 w-5 text-gray-400 animate-spin" />}
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* CA du jour */}
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">CA aujourd'hui</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {isLoading ? <span className="h-8 w-32 bg-gray-200 rounded animate-pulse inline-block" /> : formatCurrency(todayRevenue)}
                  </p>
                  <div className="flex items-center gap-1 mt-1">
                    {todayChange >= 0
                      ? <ArrowUpRight className="h-4 w-4 text-green-500" />
                      : <ArrowDownRight className="h-4 w-4 text-red-500" />}
                    <span className={`text-xs ${todayChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {Math.abs(todayChange).toFixed(1)}%
                    </span>
                    <span className="text-xs text-gray-400">vs hier</span>
                  </div>
                </div>
                <div className="h-12 w-12 rounded-xl bg-primary-100 flex items-center justify-center">
                  <DollarSign className="h-6 w-6 text-primary-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* CA mensuel + marge */}
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">CA du mois</p>
                  <p className="text-2xl font-bold text-gray-900">{formatCurrency(monthlyRevenue)}</p>
                  {isManagerPlus && (
                    <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                      <TrendingUp className="h-3 w-3" />
                      {monthlyProfit !== null ? `Marge : ${formatCurrency(monthlyProfit)}` : 'Marge : chargement...'}
                    </p>
                  )}
                </div>
                <div className="h-12 w-12 rounded-xl bg-green-100 flex items-center justify-center">
                  <TrendingUp className="h-6 w-6 text-green-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Stock */}
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">{isManagerPlus ? 'Valeur du stock' : 'État du stock'}</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {isManagerPlus
                      ? formatCurrency(valeurStock || 0)
                      : (ruptureProducts.length > 0 || lowStockProducts.length > 0 ? 'À surveiller' : 'OK')}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    {ruptureProducts.length > 0 && (
                      <span className="text-xs text-red-600 flex items-center gap-0.5">
                        <AlertTriangle className="h-3 w-3" />{ruptureProducts.length} rupture{ruptureProducts.length > 1 ? 's' : ''}
                      </span>
                    )}
                    {lowStockProducts.length > 0 && (
                      <span className="text-xs text-amber-600 flex items-center gap-0.5">
                        <AlertTriangle className="h-3 w-3" />{lowStockProducts.length} bas
                      </span>
                    )}
                    {lowStockProducts.length === 0 && ruptureProducts.length === 0 && (
                      <span className="text-xs text-green-600 flex items-center gap-0.5">
                        <CheckCircle2 className="h-3 w-3" />Stock OK
                      </span>
                    )}
                  </div>
                </div>
                <div className="h-12 w-12 rounded-xl bg-blue-100 flex items-center justify-center">
                  <Package className="h-6 w-6 text-blue-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Crédits */}
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Crédits en cours</p>
                  <p className="text-2xl font-bold text-gray-900">{formatCurrency(totalCreditEnCours)}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-gray-500">{activeCredits.length} dossier{activeCredits.length > 1 ? 's' : ''}</span>
                    {overdueCredits.length > 0 && (
                      <span className="text-xs text-red-600">{overdueCredits.length} en retard</span>
                    )}
                  </div>
                </div>
                <div className="h-12 w-12 rounded-xl bg-amber-100 flex items-center justify-center">
                  <CreditCard className="h-6 w-6 text-amber-600" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Stats rapides */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Ventes aujourd\'hui', value: todaySales.length, sub: 'transactions', color: 'text-primary-600' },
            { label: 'Ventes ce mois', value: monthSales.length, sub: 'transactions', color: 'text-green-600' },
            { label: 'Produits actifs', value: products.length, sub: 'références', color: 'text-blue-600' },
            { label: 'Clients en crédit', value: activeCredits.length, sub: 'dossiers actifs', color: 'text-amber-600' },
          ].map((s, i) => (
            <Card key={i}><CardContent className="p-4 text-center">
              <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-xs font-medium text-gray-700 mt-1">{s.label}</p>
              <p className="text-xs text-gray-400">{s.sub}</p>
            </CardContent></Card>
          ))}
        </div>

        {/* Grid principal */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Ventes récentes */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Ventes récentes</CardTitle>
                  <CardDescription>Les dernières transactions enregistrées</CardDescription>
                </div>
                <Link href="/sales" className="text-sm text-primary-600 hover:text-primary-700">Voir tout →</Link>
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-3">
                  {[1,2,3,4,5].map(i => (
                    <div key={i} className="animate-pulse flex items-center gap-4 p-3">
                      <div className="h-10 w-10 rounded-lg bg-gray-200" />
                      <div className="flex-1 space-y-2"><div className="h-4 w-24 bg-gray-200 rounded" /><div className="h-3 w-32 bg-gray-100 rounded" /></div>
                      <div className="h-4 w-20 bg-gray-200 rounded" />
                    </div>
                  ))}
                </div>
              ) : recentSales.length === 0 ? (
                <div className="text-center py-10 text-gray-400">
                  <ShoppingCart className="h-12 w-12 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Aucune vente — utilisez le POS pour commencer</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {recentSales.map(sale => {
                    const pm = sale.paymentMethod || 'CASH';
                    const pmLabels: Record<string, string> = { CASH: 'Espèces', MOBILE_MONEY: 'Mobile Money', CARD: 'Carte', CREDIT: 'Crédit' };
                    return (
                      <div key={sale.id} className="flex items-center gap-4 p-3 rounded-lg hover:bg-gray-50 transition-colors">
                        <div className="h-10 w-10 rounded-lg bg-primary-100 flex items-center justify-center flex-shrink-0">
                          <ShoppingCart className="h-5 w-5 text-primary-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-gray-900 text-sm font-mono">
                              #{sale.id.slice(0, 8).toUpperCase()}
                            </p>
                            <Badge variant="outline" className="text-xs">{pmLabels[pm] || pm}</Badge>
                            {sale.status === 'CANCELLED' && <Badge variant="destructive" className="text-xs">Annulée</Badge>}
                          </div>
                          <p className="text-sm text-gray-500 truncate">{sale.customerName || 'Client comptoir'}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-gray-900">{formatCurrency(sale.total || 0)}</p>
                          <p className="text-xs text-gray-400">{formatRelativeTime(sale.createdAt)}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Colonne droite */}
          <div className="space-y-6">
            {/* Crédits en cours */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Crédits en cours</CardTitle>
                  <Link href="/credits" className="text-xs text-primary-600">Voir tout →</Link>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {activeCredits.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-4">Aucun crédit actif</p>
                ) : activeCredits.slice(0, 5).map(c => {
                  const isLate = c.status === 'OVERDUE' || new Date(c.dateEcheance) < new Date();
                  return (
                    <div key={c.id} className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{c.customerName}</p>
                        <p className={`text-xs ${isLate ? 'text-red-500' : 'text-gray-400'}`}>
                          {isLate ? '⚠️ ' : ''}Éch. {c.dateEcheance ? new Date(c.dateEcheance).toLocaleDateString('fr-FR') : '—'}
                        </p>
                      </div>
                      <p className={`text-sm font-bold ${isLate ? 'text-red-600' : 'text-amber-600'}`}>
                        {formatCurrency(c.solde)}
                      </p>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            {/* Alertes stock */}
            {(lowStockProducts.length > 0 || ruptureProducts.length > 0) && (
              <Card className="border-amber-200">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                      Alertes stock
                    </CardTitle>
                    <Link href="/inventory/alerts" className="text-xs text-primary-600">Voir tout →</Link>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {[...ruptureProducts.slice(0, 3), ...lowStockProducts.filter(p => getStock(p.id) > 0).slice(0, 3)].slice(0, 5).map(p => {
                    const stock = getStock(p.id);
                    const isRupture = stock === 0;
                    return (
                      <div key={p.id} className="flex items-center justify-between">
                        <p className="text-sm text-gray-700 truncate">{p.name}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ml-2 ${isRupture ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                          {isRupture ? 'Rupture' : `${stock} ${p.unit}`}
                        </span>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* Actions rapides */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Link href="/pos" className="flex items-center gap-4 p-4 bg-primary-600 text-white rounded-xl hover:bg-primary-700 transition-colors">
            <ShoppingCart className="h-8 w-8" />
            <div><p className="font-semibold">Point de vente</p><p className="text-sm text-primary-200">Nouvelle vente</p></div>
          </Link>
          <Link href="/quotes" className="flex items-center gap-4 p-4 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors">
            <BarChart3 className="h-8 w-8 text-blue-600" />
            <div><p className="font-semibold text-gray-900">Nouveau devis</p><p className="text-sm text-gray-500">Créer un devis</p></div>
          </Link>
          <Link href="/customers" className="flex items-center gap-4 p-4 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors">
            <Users className="h-8 w-8 text-purple-600" />
            <div><p className="font-semibold text-gray-900">Clients</p><p className="text-sm text-gray-500">Gérer les clients</p></div>
          </Link>
          <Link href="/inventory/alerts" className="flex items-center gap-4 p-4 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors">
            <AlertTriangle className={`h-8 w-8 ${lowStockProducts.length > 0 ? 'text-amber-500' : 'text-gray-400'}`} />
            <div>
              <p className="font-semibold text-gray-900">Alertes stock</p>
              <p className="text-sm text-gray-500">{lowStockProducts.length + ruptureProducts.length} produit{(lowStockProducts.length + ruptureProducts.length) > 1 ? 's' : ''} en alerte</p>
            </div>
          </Link>
        </div>
      </div>
    </DashboardLayout>
  );
}
