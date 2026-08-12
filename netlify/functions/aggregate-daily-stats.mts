/**
 * Agrégation quotidienne des ventes — fonction planifiée Netlify.
 *
 * POURQUOI : la page Analytics lisait les 500 dernières ventes et recalculait
 * tout dans le navigateur. Trois problèmes : au-delà de 500 ventes les chiffres
 * devenaient faux sans le dire, chaque ouverture coûtait des centaines de
 * lectures Firestore, et la marge affichée était une estimation inventée
 * (coût = sous-total × 0,7) alors que le coût réel est stocké à chaque vente.
 *
 * Cette fonction calcule une fois par jour un document par tenant et par
 * journée dans `tenants/{tenantId}/daily_stats/{AAAA-MM-JJ}`. La page
 * Analytics n'a plus qu'à lire ces documents : ~30 lectures pour un mois au
 * lieu de plusieurs centaines, et des chiffres justes quel que soit le volume.
 *
 * FUSEAU HORAIRE : le Mali est à UTC+0 toute l'année (pas d'heure d'été), donc
 * une journée UTC correspond exactement à une journée locale. Si Kafora devait
 * un jour servir un pays à décalage, c'est ici qu'il faudrait décaler les
 * bornes — d'où le calcul explicite ci-dessous plutôt qu'un raccourci.
 *
 * LIMITE : les fonctions planifiées Netlify s'arrêtent à 30 secondes. D'où
 * trois requêtes groupées par tenant plutôt qu'une lecture par vente, et un
 * traitement séquentiel qui s'interrompt proprement s'il approche du délai.
 */

import type { Config } from '@netlify/functions';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const TIME_BUDGET_MS = 25_000; // marge sous la limite de 30 s

function getDb() {
  if (getApps().length === 0) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey: (process.env.FIREBASE_ADMIN_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      }),
    });
  }
  return getFirestore();
}

/** Bornes [début, fin[ d'une journée, et sa clé AAAA-MM-JJ. */
export function dayBounds(daysAgo: number) {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysAgo));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end, key: start.toISOString().slice(0, 10) };
}

export interface DailyStats {
  date: string;
  tenantId: string;
  revenue: number;
  cost: number;
  margin: number;
  saleCount: number;
  itemCount: number;
  uniqueCustomers: number;
  byPayment: Record<string, number>;
  byStore: Record<string, number>;
  revenueByCategory: Record<string, number>;
  costByCategory: Record<string, number>;
  marginByCategory: Record<string, number>;
  topProducts: { productId: string; name: string; revenue: number; quantity: number }[];
  computedAt: FirebaseFirestore.FieldValue | Date;
  /** true si le coût réel n'a pas pu être trouvé pour toutes les ventes —
   *  la marge affichée est alors partielle, et l'UI doit le signaler plutôt
   *  que de présenter un chiffre incomplet comme s'il était exact. */
  costIncomplete: boolean;
}

export async function aggregateTenantDay(
  db: FirebaseFirestore.Firestore,
  tenantId: string,
  day: { start: Date; end: Date; key: string }
): Promise<DailyStats> {
  const startTs = Timestamp.fromDate(day.start);
  const endTs = Timestamp.fromDate(day.end);

  // Trois requêtes seulement, quel que soit le nombre de ventes du jour.
  const [salesSnap, costSnap, itemsSnap] = await Promise.all([
    db.collection(`tenants/${tenantId}/sales`)
      .where('createdAt', '>=', startTs).where('createdAt', '<', endTs).get(),
    db.collectionGroup('cost_summary')
      .where('tenantId', '==', tenantId)
      .where('createdAt', '>=', startTs).where('createdAt', '<', endTs).get(),
    db.collectionGroup('sale_items')
      .where('tenantId', '==', tenantId)
      .where('createdAt', '>=', startTs).where('createdAt', '<', endTs).get(),
  ]);

  const stats: DailyStats = {
    date: day.key,
    tenantId,
    revenue: 0, cost: 0, margin: 0,
    saleCount: 0, itemCount: 0, uniqueCustomers: 0,
    byPayment: {}, byStore: {},
    revenueByCategory: {}, costByCategory: {}, marginByCategory: {},
    topProducts: [],
    computedAt: new Date(),
    costIncomplete: false,
  };

  const customers = new Set<string>();
  // sale_items et cost_summary vivent en sous-collection d'une vente et ne
  // portent PAS son statut : annuler une vente (/api/sales/cancel) ne les
  // touche jamais (voir la route), ils restent tels qu'écrits au checkout.
  // Sans ce filtre, une vente annulée gonflait quand même topProducts,
  // revenueByCategory ET costByCategory/cost/margin — alors que stats.revenue
  // l'excluait déjà correctement ci-dessous : les chiffres ne se
  // recoupaient plus (marge par catégorie ≠ marge totale affichée à côté).
  const completedSaleIds = new Set<string>();

  for (const doc of salesSnap.docs) {
    const s = doc.data();
    // Seules les ventes finalisées comptent : une vente annulée ou remboursée
    // ne doit pas gonfler le chiffre d'affaires.
    if (s.status !== 'COMPLETED') continue;
    completedSaleIds.add(doc.id);

    stats.saleCount++;
    stats.revenue += s.total || 0;
    customers.add(s.customerId || 'comptoir');

    const pm = s.paymentMethod || 'CASH';
    stats.byPayment[pm] = (stats.byPayment[pm] || 0) + (s.total || 0);
    if (s.storeId) stats.byStore[s.storeId] = (stats.byStore[s.storeId] || 0) + (s.total || 0);
  }

  stats.uniqueCustomers = customers.size;

  /** Extrait l'id de vente du chemin .../sales/{saleId}/{sousCollection}/{docId}. */
  const saleIdFromPath = (path: string): string | undefined => path.split('/').at(-3);

  // Coût réel, tel qu'enregistré au moment de la vente — jamais estimé.
  //
  // Une vente peut porter un coût PARTIEL : le prix d'achat étant facultatif,
  // certaines lignes n'en ont pas. Le résumé de coût le signale via
  // `costIncomplete`. Sans cette prise en compte, la marge du jour serait
  // présentée comme exacte alors qu'elle est surestimée.
  let partialCostSales = 0;
  let completedCostSummaryCount = 0;
  for (const doc of costSnap.docs) {
    const saleId = saleIdFromPath(doc.ref.path);
    if (!saleId || !completedSaleIds.has(saleId)) continue;
    completedCostSummaryCount++;
    const d = doc.data();
    stats.cost += d.costTotal || 0;
    if (d.costIncomplete) partialCostSales++;
    for (const [catKey, cost] of Object.entries((d.costByCategory || {}) as Record<string, number>)) {
      stats.costByCategory[catKey] = (stats.costByCategory[catKey] || 0) + cost;
    }
  }
  stats.margin = stats.revenue - stats.cost;
  // Si le nombre de résumés de coût ne correspond pas au nombre de ventes,
  // la marge est incomplète : on le signale au lieu de faire comme si de rien.
  // Incomplet si un résumé de coût manque, OU si l'un d'eux ne couvre pas
  // toutes ses lignes.
  stats.costIncomplete =
    (stats.saleCount > 0 && completedCostSummaryCount < stats.saleCount) || partialCostSales > 0;

  // Top produits : agrégés sur TOUTES les lignes du jour, pas sur un
  // échantillon (l'ancienne page se limitait à 20 ventes).
  const perProduct: Record<string, { name: string; revenue: number; quantity: number }> = {};
  for (const doc of itemsSnap.docs) {
    const saleId = saleIdFromPath(doc.ref.path);
    if (!saleId || !completedSaleIds.has(saleId)) continue;
    const it = doc.data();
    const pid = it.productId as string;
    if (!pid) continue;
    if (!perProduct[pid]) perProduct[pid] = { name: it.productName || '—', revenue: 0, quantity: 0 };
    perProduct[pid].revenue += it.total || 0;
    perProduct[pid].quantity += it.quantity || 0;
    stats.itemCount += it.quantity || 0;

    // Revenu par catégorie : déductible de sale_items (non sensible), à la
    // différence du coût qui vient de cost_summary (Managers+, ci-dessus).
    const catKey = (it.categoryId as string | null) || 'uncategorized';
    stats.revenueByCategory[catKey] = (stats.revenueByCategory[catKey] || 0) + (it.total || 0);
  }
  stats.topProducts = Object.entries(perProduct)
    .map(([productId, v]) => ({ productId, ...v }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  // Marge par catégorie = revenu (sale_items) − coût (cost_summary), calculée
  // ici plutôt que stockée telle quelle : les deux sources sont indépendantes
  // et une catégorie peut apparaître dans l'une sans l'autre (ex. produit
  // sans prix d'achat renseigné → 0 dans costByCategory).
  const allCategoryKeys = new Set([
    ...Object.keys(stats.revenueByCategory),
    ...Object.keys(stats.costByCategory),
  ]);
  for (const catKey of allCategoryKeys) {
    stats.marginByCategory[catKey] = (stats.revenueByCategory[catKey] || 0) - (stats.costByCategory[catKey] || 0);
  }

  return stats;
}

export default async function handler(req: Request) {
  const started = Date.now();
  const db = getDb();

  // Par défaut on traite la veille (journée complète). `?days=N` permet de
  // rattraper N journées à la main depuis le bouton "Run now" de Netlify.
  const url = new URL(req.url);
  const daysParam = Number(url.searchParams.get('days') || '1');
  const days = Number.isFinite(daysParam) ? Math.min(Math.max(daysParam, 1), 30) : 1;

  const tenants = await db.collection('tenants').get();
  let written = 0;
  let skipped = 0;

  for (const tenant of tenants.docs) {
    for (let d = 1; d <= days; d++) {
      if (Date.now() - started > TIME_BUDGET_MS) {
        // On s'arrête proprement : les journées non traitées le seront au
        // prochain passage (ou via ?days=N). Mieux vaut un agrégat partiel
        // qu'une fonction tuée en plein milieu d'une écriture.
        console.warn(`Budget temps atteint — ${skipped} journée(s) non traitée(s)`);
        skipped++;
        continue;
      }

      const day = dayBounds(d);
      try {
        const stats = await aggregateTenantDay(db, tenant.id, day);
        // On écrit même une journée sans vente : l'absence de document ne doit
        // pas être confondue avec "pas encore calculé" côté Analytics.
        await db.doc(`tenants/${tenant.id}/daily_stats/${day.key}`).set(stats, { merge: true });
        written++;
      } catch (err) {
        console.error(`Échec agrégation tenant ${tenant.id} / ${day.key} :`, err);
      }
    }
  }

  const summary = `${written} agrégat(s) écrit(s), ${skipped} reporté(s), ${tenants.size} tenant(s), ${Date.now() - started} ms`;
  console.log(summary);
  return new Response(summary, { status: 200 });
}

export const config: Config = {
  // 02h00 UTC : la journée précédente est terminée partout au Mali, et le
  // trafic est nul — aucune vente en cours ne risque d'être comptée à moitié.
  schedule: '0 2 * * *',
};
