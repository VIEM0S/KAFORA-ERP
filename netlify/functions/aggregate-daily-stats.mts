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
function dayBounds(daysAgo: number) {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysAgo));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end, key: start.toISOString().slice(0, 10) };
}

interface DailyStats {
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
  topProducts: { productId: string; name: string; revenue: number; quantity: number }[];
  computedAt: FirebaseFirestore.FieldValue | Date;
  /** true si le coût réel n'a pas pu être trouvé pour toutes les ventes —
   *  la marge affichée est alors partielle, et l'UI doit le signaler plutôt
   *  que de présenter un chiffre incomplet comme s'il était exact. */
  costIncomplete: boolean;
}

async function aggregateTenantDay(
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
    byPayment: {}, byStore: {}, topProducts: [],
    computedAt: new Date(),
    costIncomplete: false,
  };

  const customers = new Set<string>();

  for (const doc of salesSnap.docs) {
    const s = doc.data();
    // Seules les ventes finalisées comptent : une vente annulée ou remboursée
    // ne doit pas gonfler le chiffre d'affaires.
    if (s.status !== 'COMPLETED') continue;

    stats.saleCount++;
    stats.revenue += s.total || 0;
    customers.add(s.customerId || 'comptoir');

    const pm = s.paymentMethod || 'CASH';
    stats.byPayment[pm] = (stats.byPayment[pm] || 0) + (s.total || 0);
    if (s.storeId) stats.byStore[s.storeId] = (stats.byStore[s.storeId] || 0) + (s.total || 0);
  }

  stats.uniqueCustomers = customers.size;

  // Coût réel, tel qu'enregistré au moment de la vente — jamais estimé.
  for (const doc of costSnap.docs) {
    stats.cost += doc.data().costTotal || 0;
  }
  stats.margin = stats.revenue - stats.cost;
  // Si le nombre de résumés de coût ne correspond pas au nombre de ventes,
  // la marge est incomplète : on le signale au lieu de faire comme si de rien.
  stats.costIncomplete = stats.saleCount > 0 && costSnap.size < stats.saleCount;

  // Top produits : agrégés sur TOUTES les lignes du jour, pas sur un
  // échantillon (l'ancienne page se limitait à 20 ventes).
  const perProduct: Record<string, { name: string; revenue: number; quantity: number }> = {};
  for (const doc of itemsSnap.docs) {
    const it = doc.data();
    const pid = it.productId as string;
    if (!pid) continue;
    if (!perProduct[pid]) perProduct[pid] = { name: it.productName || '—', revenue: 0, quantity: 0 };
    perProduct[pid].revenue += it.total || 0;
    perProduct[pid].quantity += it.quantity || 0;
    stats.itemCount += it.quantity || 0;
  }
  stats.topProducts = Object.entries(perProduct)
    .map(([productId, v]) => ({ productId, ...v }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

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
