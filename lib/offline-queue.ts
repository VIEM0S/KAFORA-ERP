// ─────────────────────────────────────────────────────────────────────────
// File d'attente des ventes hors-ligne du POS.
//
// Pourquoi localStorage et pas Firestore : la connexion est justement coupée.
// Le but est de ne JAMAIS bloquer un caissier qui a un client devant lui.
//
// Compromis assumé : pendant la coupure, on fait confiance aux prix
// calculés côté client (comme n'importe quel POS avec mode hors-ligne,
// Odoo inclus) — la vérification serveur (prix, coût, stock réel) se fait
// au moment de la synchronisation, pas avant. Un caissier malveillant a le
// même niveau d'accès pendant la panne qu'avant notre migration serveur ;
// dès la connexion rétablie, tout redevient vérifié normalement.
// ─────────────────────────────────────────────────────────────────────────

export interface QueuedSale {
  localId: string; // identifiant côté client, évite les doublons à la sync
  createdAtLocal: number;
  payload: {
    tenantId: string;
    storeId: string;
    items: { productId: string; quantity: number; discount?: number }[];
    customerId?: string | null;
    paymentMethod: string;
    amountReceived?: number;
    discountPercent?: number;
    userName?: string;
  };
  // Pour l'affichage du reçu immédiat, sans attendre la sync
  displayTotal: number;
  status: 'PENDING' | 'SYNCING' | 'ERROR';
  errorMessage?: string;
  attempts: number;
}

const STORAGE_KEY = 'alpha_pos_offline_queue';

export function generateLocalSaleId(): string {
  return `offline_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function readQueue(): QueuedSale[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: QueuedSale[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch (e) {
    console.error('Impossible d\'écrire la file hors-ligne (localStorage plein ?)', e);
  }
}

export function getQueue(): QueuedSale[] {
  return readQueue();
}

export function enqueueSale(payload: QueuedSale['payload'], displayTotal: number, existingLocalId?: string): QueuedSale {
  const sale: QueuedSale = {
    localId: existingLocalId || generateLocalSaleId(),
    createdAtLocal: Date.now(),
    payload,
    displayTotal,
    status: 'PENDING',
    attempts: 0,
  };
  const queue = readQueue();
  queue.push(sale);
  writeQueue(queue);
  return sale;
}

export function removeFromQueue(localId: string) {
  writeQueue(readQueue().filter(s => s.localId !== localId));
}

export function updateQueueItem(localId: string, patch: Partial<QueuedSale>) {
  const queue = readQueue();
  const idx = queue.findIndex(s => s.localId === localId);
  if (idx === -1) return;
  queue[idx] = { ...queue[idx], ...patch };
  writeQueue(queue);
}

/**
 * Tente de synchroniser toute la file vers /api/pos/checkout.
 * Retourne le nombre de ventes synchronisées avec succès.
 */
export async function syncOfflineQueue(): Promise<{ synced: number; failed: number }> {
  const queue = readQueue();
  let synced = 0;
  let failed = 0;

  for (const sale of queue) {
    if (sale.status === 'SYNCING') continue;
    updateQueueItem(sale.localId, { status: 'SYNCING' });
    try {
      const res = await fetch('/api/pos/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Offline-Sync-Id': sale.localId },
        body: JSON.stringify(sale.payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur de synchronisation');
      removeFromQueue(sale.localId);
      synced++;
    } catch (e) {
      failed++;
      updateQueueItem(sale.localId, {
        status: 'ERROR',
        attempts: sale.attempts + 1,
        errorMessage: e instanceof Error ? e.message : 'Erreur inconnue',
      });
    }
  }

  return { synced, failed };
}
