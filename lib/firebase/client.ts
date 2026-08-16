import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL!,
};

// Singleton — évite la double initialisation en dev (hot-reload Next.js)
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);

// Fix : Firestore n'avait aucun cache local persistant configuré — une
// coupure réseau (fréquente en boutique) bloquait toute l'appli (plus de
// lecture ni écriture possible). `persistentLocalCache` garde les dernières
// données lues en IndexedDB et met en file les écritures pour les rejouer
// au retour du réseau. `initializeFirestore` doit être appelé une seule fois
// et avant tout autre usage de Firestore — donc uniquement côté navigateur.
// `persistentMultipleTabManager` : le cache IndexedDB est partagé entre
// onglets (ex. Analytics ouvert à côté du POS). Avec le gestionnaire
// single-tab utilisé avant, un second onglet perdait silencieusement la
// persistance (repli sur cache mémoire, sans erreur visible) — inutile ici,
// les écritures métier sensibles (encaissement...) passent de toute façon
// par les routes API (Admin SDK), jamais par une écriture Firestore directe
// depuis le client.
export const db = (() => {
  if (typeof window === 'undefined') return getFirestore(app);
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    // Déjà initialisé (ex: hot-reload Next.js en dev) — récupérer l'instance existante.
    return getFirestore(app);
  }
})();

export const rtdb = getDatabase(app);

export default app;
