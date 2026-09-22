import { useEffect, useState } from 'react';
import { getQueue, syncOfflineQueue, type QueuedSale } from '@/lib/offline-queue';

export function useOfflineSync() {
  const [isOnline, setIsOnline] = useState(true);
  const [pendingQueue, setPendingQueue] = useState<QueuedSale[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);

  const refreshQueue = () => setPendingQueue(getQueue());

  const runSync = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      await syncOfflineQueue();
    } finally {
      refreshQueue();
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    // navigator.onLine et localStorage (via refreshQueue) sont des API
    // navigateur, indisponibles/non fiables pendant le rendu serveur.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshQueue();
    setIsOnline(typeof navigator !== 'undefined' ? navigator.onLine : true);

    const handleOnline = () => { setIsOnline(true); runSync(); };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Nouvelle tentative périodique — utile si le navigateur ne détecte pas
    // toujours fidèlement le retour de connexion (fréquent en 3G/4G instable)
    const interval = setInterval(() => {
      if (navigator.onLine) runSync();
    }, 30000);

    // Tentative de sync au chargement de la page, au cas où des ventes
    // seraient restées en attente d'une session précédente
    if (typeof navigator !== 'undefined' && navigator.onLine) runSync();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { isOnline, setIsOnline, pendingQueue, refreshQueue, isSyncing, runSync };
}
