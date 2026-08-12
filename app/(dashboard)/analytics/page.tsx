'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  TrendingUp, TrendingDown, DollarSign, Package,
  ShoppingCart, Users, RefreshCw, Calendar
} from 'lucide-react';
import { DashboardLayout } from '@/components/layout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCurrency } from '@/lib/utils/helpers';
import { useAuthStore } from '@/hooks/store';
import { collection, query, orderBy, where } from 'firebase/firestore';
// onSnapshot vient d'ici : l'enveloppe remonte les échecs au bandeau global
// (voir lib/firebase/watch.ts), au lieu de laisser l'écran vide sans explication.
import { onSnapshot } from '@/lib/firebase/watch';
import { db } from '@/lib/firebase/client';
import dynamic from 'next/dynamic';

// Graphiques chargés À LA DEMANDE : `recharts` pèse ~120 ko et bloquait
// l'affichage de la page. Les indicateurs chiffrés apparaissent maintenant
// tout de suite, les courbes se dessinent juste après.
// `ssr: false` car recharts mesure le conteneur pour se dimensionner : il n'a
// rien à faire côté serveur.
const chartFallback = (
  <div className="flex items-center justify-center h-[220px] text-sm text-gray-400">
    Chargement du graphique…
  </div>
);
const RevenueChart = dynamic(() => import('@/components/analytics/charts').then(m => m.RevenueChart), { ssr: false, loading: () => chartFallback });
const WeeklyChart = dynamic(() => import('@/components/analytics/charts').then(m => m.WeeklyChart), { ssr: false, loading: () => chartFallback });
const PaymentChart = dynamic(() => import('@/components/analytics/charts').then(m => m.PaymentChart), { ssr: false, loading: () => chartFallback });
const VolumeChart = dynamic(() => import('@/components/analytics/charts').then(m => m.VolumeChart), { ssr: false, loading: () => chartFallback });
import { tenantCol } from '@/lib/firebase/collections';

/** Agrégat quotidien pré-calculé (voir netlify/functions/aggregate-daily-stats). */
interface DailyStat {
  date: string;                 // AAAA-MM-JJ
  revenue: number;
  cost: number;                 // coût d'achat RÉEL, relevé à la vente
  margin: number;
  saleCount: number;
  uniqueCustomers: number;
  byPayment: Record<string, number>;
  byStore: Record<string, number>;
  revenueByCategory?: Record<string, number>;
  costByCategory?: Record<string, number>;
  marginByCategory?: Record<string, number>;
  topProducts: { productId: string; name: string; revenue: number; quantity: number }[];
  costIncomplete?: boolean;
}


const MONTHS_FR = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];

export default function AnalyticsPage() {
  const { tenant, currentStore, stores } = useAuthStore();
  const tenantId = tenant?.id;

  const [period, setPeriod] = useState<'3m' | '6m' | '12m'>('6m');
  const monthsCount = period === '3m' ? 3 : period === '6m' ? 6 : 12;
  const [dailyStats, setDailyStats] = useState<DailyStat[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [categoryNames, setCategoryNames] = useState<Record<string, string>>({});

  // Résolution des noms de catégorie pour la marge par catégorie — juste des
  // libellés, pas de donnée sensible, lue une fois indépendamment du reste.
  useEffect(() => {
    if (!tenantId) return;
    const unsub = onSnapshot(
      collection(db, tenantCol(tenantId, 'categories')),
      snap => {
        const names: Record<string, string> = {};
        snap.docs.forEach(d => { names[d.id] = (d.data().name as string) || d.id; });
        setCategoryNames(names);
      },
      () => setCategoryNames({})
    );
    return () => unsub();
  }, [tenantId]);

  // Lecture des agrégats pré-calculés (un document par journée), produits par
  // la fonction planifiée netlify/functions/aggregate-daily-stats.
  //
  // Avant : on lisait les 500 dernières ventes et on recalculait tout ici.
  // Au-delà de 500 ventes les chiffres devenaient faux SANS AVERTIR, et
  // chaque ouverture coûtait des centaines de lectures Firestore.
  useEffect(() => {
    if (!tenantId) return;
    setIsLoading(true);

    const from = new Date();
    from.setUTCDate(from.getUTCDate() - monthsCount * 31);
    const fromKey = from.toISOString().slice(0, 10);

    const unsub = onSnapshot(
      query(
        collection(db, tenantCol(tenantId, 'daily_stats')),
        where('date', '>=', fromKey),
        orderBy('date', 'asc')
      ),
      snap => {
        setDailyStats(snap.docs.map(d => d.data() as DailyStat));
        setIsLoading(false);
      },
      () => setIsLoading(false)
    );
    return () => unsub();
  }, [tenantId, monthsCount]);

  // Top produits : agrégés côté serveur sur TOUTES les lignes de vente.
  // L'ancienne version échantillonnait 20 ventes maximum — un « top » qui
  // ne reflétait donc pas la réalité dès qu'il y avait un peu de volume.
  const topProducts = useMemo(() => {
    const acc: Record<string, { productId: string; name: string; revenue: number; qty: number }> = {};
    for (const d of dailyStats) {
      for (const p of d.topProducts || []) {
        if (!acc[p.productId]) acc[p.productId] = { productId: p.productId, name: p.name, revenue: 0, qty: 0 };
        acc[p.productId].revenue += p.revenue || 0;
        acc[p.productId].qty += p.quantity || 0;
      }
    }
    return Object.values(acc).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  }, [dailyStats]);

  // Stock actuel des produits du top, tous magasins confondus — pour estimer
  // la rotation. Requête à part (les daily_stats ne contiennent que des
  // ventes, jamais un niveau de stock, qui est un état "maintenant", pas un
  // agrégat par journée passée).
  const [stockLevels, setStockLevels] = useState<Record<string, number>>({});
  const topProductIds = useMemo(() => topProducts.map(p => p.productId).sort().join(','), [topProducts]);
  useEffect(() => {
    const ids = topProductIds ? topProductIds.split(',') : [];
    if (!tenantId || ids.length === 0) { setStockLevels({}); return; }
    // "in" est limité à 30 valeurs côté Firestore — le top est plafonné à 5,
    // largement dans la marge.
    const unsub = onSnapshot(
      query(collection(db, tenantCol(tenantId, 'inventory')), where('productId', 'in', ids)),
      snap => {
        const totals: Record<string, number> = {};
        snap.docs.forEach(d => {
          const data = d.data();
          const pid = data.productId as string;
          totals[pid] = (totals[pid] || 0) + (Number(data.quantity) || 0);
        });
        setStockLevels(totals);
      },
      () => setStockLevels({})
    );
    return () => unsub();
  }, [tenantId, topProductIds]);

  // Rotation = vitesse de vente (unités/jour sur la période) rapportée au
  // stock actuel → "combien de jours avant rupture au rythme actuel". Plus
  // parlant pour un commerçant qu'un ratio de rotation abstrait, et
  // complémentaire du seuil d'alerte statique (lib/inventory/alert-threshold) :
  // celui-ci dit "c'est bas", la rotation dit "dans combien de temps".
  const periodDays = monthsCount * 30;
  const stockRotation = useMemo(() => {
    return topProducts
      .map(p => {
        const stock = stockLevels[p.productId] ?? null;
        const dailyVelocity = p.qty / periodDays;
        const daysLeft = stock !== null && dailyVelocity > 0 ? stock / dailyVelocity : null;
        return { ...p, stock, dailyVelocity, daysLeft };
      })
      // Un produit non suivi en stock (trackInventory: false) n'a pas de
      // ligne inventory : pas de niveau de stock à comparer, donc pas de
      // rotation calculable. On l'exclut plutôt que d'afficher un "—" vide.
      .filter(p => p.stock !== null);
  }, [topProducts, stockLevels, periodDays]);

  const now = new Date();

  const monthlyData = useMemo(() => {
    const data = [];
    for (let i = monthsCount - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const prefix = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const monthDays = dailyStats.filter(s => s.date.startsWith(prefix));
      data.push({
        month: MONTHS_FR[d.getMonth()],
        ca: monthDays.reduce((a, s) => a + (s.revenue || 0), 0),
        // Marge RÉELLE (chiffre d'affaires − coût d'achat relevé à la vente).
        // L'ancienne version appliquait un coût forfaitaire de 70 % du
        // sous-total : un chiffre inventé, sans rapport avec les achats.
        marge: Math.round(monthDays.reduce((a, s) => a + (s.margin || 0), 0)),
        ventes: monthDays.reduce((a, s) => a + (s.saleCount || 0), 0),
      });
    }
    return data;
  }, [dailyStats, monthsCount]);

  const weeklyData = useMemo(() => {
    const days = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];
    const today = new Date();
    const dow = today.getDay() === 0 ? 6 : today.getDay() - 1;
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - dow);
    return days.map((day, i) => {
      const d = new Date(startOfWeek);
      d.setDate(startOfWeek.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      const stat = dailyStats.find(s => s.date === key);
      return { day, ca: stat?.revenue || 0, ventes: stat?.saleCount || 0 };
    });
  }, [dailyStats]);

  const paymentData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const d of dailyStats) {
      for (const [k, v] of Object.entries(d.byPayment || {})) {
        counts[k] = (counts[k] || 0) + v;
      }
    }
    const labels: Record<string, string> = { CASH:'Espèces', MOBILE_MONEY:'Mobile Money', CARD:'Carte', CREDIT:'Crédit' };
    return Object.entries(counts).map(([k, v]) => ({ name: labels[k] || k, value: Math.round(v) }));
  }, [dailyStats]);

  // Comparaison entre magasins : la donnée (byStore) est déjà calculée par
  // l'agrégation quotidienne (netlify/functions/aggregate-daily-stats), il
  // manquait juste sa lecture ici. N'a de sens qu'à partir de 2 magasins —
  // un tenant mono-magasin n'a rien à comparer.
  const storeComparison = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const d of dailyStats) {
      for (const [storeId, revenue] of Object.entries(d.byStore || {})) {
        totals[storeId] = (totals[storeId] || 0) + revenue;
      }
    }
    const grandTotal = Object.values(totals).reduce((a, v) => a + v, 0);
    return Object.entries(totals)
      .map(([storeId, revenue]) => ({
        storeId,
        name: stores.find(s => s.id === storeId)?.name || 'Magasin supprimé',
        revenue: Math.round(revenue),
        pct: grandTotal > 0 ? (revenue / grandTotal) * 100 : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [dailyStats, stores]);

  // Marge par catégorie : revenu/coût déjà pré-calculés par jour (voir
  // aggregate-daily-stats), il ne reste qu'à les cumuler sur la période et
  // résoudre les noms. Champs optionnels : les journées agrégées avant ce
  // chantier n'ont pas ces trois champs — traitées comme "rien à ajouter",
  // pas comme une erreur.
  const categoryMargin = useMemo(() => {
    const revenue: Record<string, number> = {};
    const cost: Record<string, number> = {};
    for (const d of dailyStats) {
      for (const [catId, v] of Object.entries(d.revenueByCategory || {})) {
        revenue[catId] = (revenue[catId] || 0) + v;
      }
      for (const [catId, v] of Object.entries(d.costByCategory || {})) {
        cost[catId] = (cost[catId] || 0) + v;
      }
    }
    const catIds = new Set([...Object.keys(revenue), ...Object.keys(cost)]);
    return Array.from(catIds)
      .map(catId => {
        const rev = revenue[catId] || 0;
        const c = cost[catId] || 0;
        return {
          catId,
          name: catId === 'uncategorized' ? 'Sans catégorie' : (categoryNames[catId] || 'Catégorie supprimée'),
          revenue: Math.round(rev),
          margin: Math.round(rev - c),
          marginPct: rev > 0 ? ((rev - c) / rev) * 100 : 0,
        };
      })
      .sort((a, b) => b.revenue - a.revenue);
  }, [dailyStats, categoryNames]);

  const monthPrefix = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const thisMonth = dailyStats.filter(s => s.date.startsWith(monthPrefix(now)));
  const lastMonth = dailyStats.filter(s => s.date.startsWith(monthPrefix(new Date(now.getFullYear(), now.getMonth() - 1, 1))));

  const sum = (arr: DailyStat[], f: (s: DailyStat) => number) => arr.reduce((a, s) => a + (f(s) || 0), 0);

  const thisMonthCA = sum(thisMonth, s => s.revenue);
  const lastMonthCA = sum(lastMonth, s => s.revenue);
  const caEvolution = lastMonthCA > 0 ? ((thisMonthCA - lastMonthCA) / lastMonthCA) * 100 : 0;
  const totalCA = sum(dailyStats, s => s.revenue);
  const totalMargin = sum(dailyStats, s => s.margin);
  const totalSales = sum(dailyStats, s => s.saleCount);
  const avgTicket = totalSales > 0 ? totalCA / totalSales : 0;
  // Somme des clients uniques par jour : un client venu deux jours compte
  // deux fois. C'est une approximation assumée — dédupliquer sur la période
  // demanderait de relire les ventes, ce qu'on cherche précisément à éviter.
  const uniqueCustomers = sum(dailyStats, s => s.uniqueCustomers);
  const hasIncompleteCost = dailyStats.some(s => s.costIncomplete);
  const noData = !isLoading && dailyStats.length === 0;

  if (isLoading) return (
    <DashboardLayout>
      <div className="flex items-center justify-center h-64 text-gray-400">
        <RefreshCw className="h-6 w-6 animate-spin mr-3" />Chargement des analytics...
      </div>
    </DashboardLayout>
  );

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
            <p className="text-sm text-gray-500 mt-1">Tableaux de bord et rapports de performance</p>
          </div>
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-gray-500" />
            <Select value={period} onValueChange={v => setPeriod(v as '3m'|'6m'|'12m')}>
              <SelectTrigger className="w-40 border-2"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="3m">3 derniers mois</SelectItem>
                <SelectItem value="6m">6 derniers mois</SelectItem>
                <SelectItem value="12m">12 derniers mois</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {noData && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            <p className="font-semibold">Aucune statistique disponible pour cette période.</p>
            <p className="mt-1">
              Les chiffres sont calculés chaque nuit à partir des ventes de la veille.
              Les ventes du jour n&apos;apparaîtront donc qu&apos;à partir de demain.
            </p>
          </div>
        )}

        {hasIncompleteCost && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            La marge affichée est partielle : le coût d&apos;achat n&apos;a pas pu être
            retrouvé pour certaines ventes de la période.
          </div>
        )}

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label:'CA total', value: formatCurrency(totalCA), sub:`${totalSales} ventes`, icon:DollarSign, color:'text-primary-600', bg:'bg-primary-100' },
            { label:'CA ce mois', value: formatCurrency(thisMonthCA), sub:`${caEvolution >= 0 ? '+' : ''}${caEvolution.toFixed(1)}% vs mois dernier`, icon: caEvolution >= 0 ? TrendingUp : TrendingDown, color: caEvolution >= 0 ? 'text-green-600' : 'text-red-600', bg: caEvolution >= 0 ? 'bg-green-100' : 'bg-red-100' },
            { label:'Ticket moyen', value: formatCurrency(avgTicket), sub:'par transaction', icon:ShoppingCart, color:'text-blue-600', bg:'bg-blue-100' },
            { label:'Clients actifs', value: uniqueCustomers, sub:'depuis le début', icon:Users, color:'text-purple-600', bg:'bg-purple-100' },
          ].map((kpi, i) => (
            <Card key={i}><CardContent className="p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className={`h-10 w-10 rounded-xl ${kpi.bg} flex items-center justify-center flex-shrink-0`}>
                  <kpi.icon className={`h-5 w-5 ${kpi.color}`} />
                </div>
                <p className="text-sm font-medium text-gray-600">{kpi.label}</p>
              </div>
              <p className="text-2xl font-bold text-gray-900">{kpi.value}</p>
              <p className={`text-xs mt-1 font-medium ${kpi.color}`}>{kpi.sub}</p>
            </CardContent></Card>
          ))}
        </div>

        {/* CA mensuel */}
        <Card>
          <CardHeader>
            <CardTitle>Chiffre d&apos;affaires & Marge estimée</CardTitle>
            <CardDescription>Évolution sur les {monthsCount} derniers mois</CardDescription>
          </CardHeader>
          <CardContent>
            <RevenueChart data={monthlyData} />
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Activité semaine */}
          <Card>
            <CardHeader>
              <CardTitle>Activité cette semaine</CardTitle>
              <CardDescription>CA par jour</CardDescription>
            </CardHeader>
            <CardContent>
              <WeeklyChart data={weeklyData} />
            </CardContent>
          </Card>

          {/* Modes de paiement */}
          <Card>
            <CardHeader>
              <CardTitle>Modes de paiement</CardTitle>
              <CardDescription>Répartition du CA total</CardDescription>
            </CardHeader>
            <CardContent>
              <PaymentChart data={paymentData} />
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Top produits réels */}
          <Card>
            <CardHeader>
              <CardTitle>Top produits — ce mois</CardTitle>
              <CardDescription>Basé sur les ventes du mois en cours</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex items-center justify-center py-10 text-gray-400">
                  <RefreshCw className="h-4 w-4 animate-spin mr-2" />Calcul...
                </div>
              ) : topProducts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-gray-400">
                  <Package className="h-10 w-10 mb-2 opacity-30" />
                  <p className="text-sm">Aucune vente ce mois</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {topProducts.map((p, i) => {
                    const maxRev = topProducts[0].revenue;
                    const pct = maxRev > 0 ? (p.revenue / maxRev) * 100 : 0;
                    return (
                      <div key={i} className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                            <span className={`h-6 w-6 rounded-lg flex items-center justify-center text-xs font-bold text-white ${i === 0 ? 'bg-amber-500' : i === 1 ? 'bg-gray-400' : i === 2 ? 'bg-orange-400' : 'bg-gray-200 text-gray-600'}`}>{i+1}</span>
                            <span className="font-medium text-gray-800 truncate max-w-[160px]">{p.name}</span>
                          </div>
                          <div className="text-right">
                            <p className="font-bold text-gray-900">{formatCurrency(p.revenue)}</p>
                            <p className="text-xs text-gray-400">{p.qty} vendu{p.qty > 1 ? 's' : ''}</p>
                          </div>
                        </div>
                        <div className="h-2 bg-gray-100 rounded-full">
                          <div className="h-2 rounded-full bg-primary-500 transition-all" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Volume de ventes */}
          <Card>
            <CardHeader>
              <CardTitle>Volume de ventes</CardTitle>
              <CardDescription>Nombre de transactions par mois</CardDescription>
            </CardHeader>
            <CardContent>
              <VolumeChart data={monthlyData} />
            </CardContent>
          </Card>
        </div>

        {/* Rotation de stock — jours restants au rythme de vente actuel */}
        {stockRotation.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Rotation de stock — top produits</CardTitle>
              <CardDescription>Stock actuel rapporté au rythme de vente des {monthsCount} derniers mois</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produit</TableHead>
                    <TableHead className="text-right">Vendu (période)</TableHead>
                    <TableHead className="text-right">Stock actuel</TableHead>
                    <TableHead className="text-right">Estimation</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stockRotation.map(p => {
                    const urgent = p.daysLeft !== null && p.daysLeft < 7;
                    const bas = p.daysLeft !== null && p.daysLeft < 30;
                    return (
                      <TableRow key={p.name}>
                        <TableCell className="font-medium text-gray-800">{p.name}</TableCell>
                        <TableCell className="text-right text-sm">{p.qty}</TableCell>
                        <TableCell className="text-right text-sm">{p.stock}</TableCell>
                        <TableCell className="text-right">
                          {p.daysLeft === null ? (
                            <span className="text-sm text-gray-400">Pas de vente récente</span>
                          ) : (
                            <span className={`text-sm font-bold ${urgent ? 'text-red-600' : bas ? 'text-amber-600' : 'text-green-600'}`}>
                              ~{Math.round(p.daysLeft)} jour{Math.round(p.daysLeft) > 1 ? 's' : ''}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Marge par catégorie — seulement si des daily_stats récents portent
            déjà ces champs (rien pour les journées agrégées avant ce chantier) */}
        {categoryMargin.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Marge par catégorie</CardTitle>
              <CardDescription>Sur les {monthsCount} derniers mois</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Catégorie</TableHead>
                    <TableHead className="text-right">CA</TableHead>
                    <TableHead className="text-right">Marge</TableHead>
                    <TableHead className="text-right">Taux</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {categoryMargin.map(c => (
                    <TableRow key={c.catId}>
                      <TableCell className="font-medium text-gray-800">{c.name}</TableCell>
                      <TableCell className="text-right text-sm">{formatCurrency(c.revenue)}</TableCell>
                      <TableCell className={`text-right text-sm font-bold ${c.margin >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {formatCurrency(c.margin)}
                      </TableCell>
                      <TableCell className="text-right text-sm text-gray-500">{c.marginPct.toFixed(1)}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Comparaison entre magasins — uniquement si le tenant en a plusieurs */}
        {stores.length > 1 && (
          <Card>
            <CardHeader>
              <CardTitle>Comparaison entre magasins</CardTitle>
              <CardDescription>CA par magasin sur les {monthsCount} derniers mois</CardDescription>
            </CardHeader>
            <CardContent>
              {storeComparison.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-gray-400">
                  <Package className="h-10 w-10 mb-2 opacity-30" />
                  <p className="text-sm">Aucune vente sur la période</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {storeComparison.map(s => (
                    <div key={s.storeId} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium text-gray-800">{s.name}</span>
                        <div className="text-right">
                          <p className="font-bold text-gray-900">{formatCurrency(s.revenue)}</p>
                          <p className="text-xs text-gray-400">{s.pct.toFixed(1)}% du CA total</p>
                        </div>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full">
                        <div className="h-2 rounded-full bg-primary-500 transition-all" style={{ width: `${s.pct}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Stats textuelles */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { title:'Ce mois', items:[
              { label:'CA', value: formatCurrency(thisMonthCA), color:'text-primary-600' },
              { label:'Transactions', value: sum(thisMonth, s => s.saleCount), color:'text-gray-900' },
              { label:'Ticket moyen', value: sum(thisMonth, s => s.saleCount) > 0 ? formatCurrency(thisMonthCA / sum(thisMonth, s => s.saleCount)) : '—', color:'text-gray-900' },
              { label:'vs mois dernier', value: `${caEvolution >= 0 ? '+' : ''}${caEvolution.toFixed(1)}%`, color: caEvolution >= 0 ? 'text-green-600' : 'text-red-600' },
            ]},
            { title:'Rentabilité', items:[
              { label:'Marge brute', value: formatCurrency(totalMargin), color: totalMargin >= 0 ? 'text-green-600' : 'text-red-600' },
              { label:'Taux de marge', value: totalCA > 0 ? `${((totalMargin / totalCA) * 100).toFixed(1)}%` : '—', color:'text-gray-900' },
              { label:'Coût des ventes', value: formatCurrency(totalCA - totalMargin), color:'text-gray-900' },
            ]},
            { title:'All-time', items:[
              { label:'CA total', value: formatCurrency(totalCA), color:'text-green-600' },
              { label:'Total ventes', value: totalSales, color:'text-gray-900' },
              { label:'Clients servis', value: uniqueCustomers, color:'text-gray-900' },
            ]},
          ].map((block, i) => (
            <Card key={i}><CardContent className="p-5">
              <p className="font-bold text-gray-900 mb-4 pb-3 border-b">{block.title}</p>
              <div className="space-y-2.5">
                {block.items.map((item, j) => (
                  <div key={j} className="flex justify-between items-center">
                    <span className="text-sm text-gray-500">{item.label}</span>
                    <span className={`text-sm font-bold ${item.color}`}>{item.value}</span>
                  </div>
                ))}
              </div>
            </CardContent></Card>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}
