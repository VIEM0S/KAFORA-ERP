'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/lib/firebase/client';
import { useAuthStore } from './store';

/**
 * useAuth — initialise et synchronise la session Firebase Auth avec le store Zustand.
 *
 * À monter dans le layout dashboard uniquement.
 * Redirige vers /login si Firebase Auth n'a pas de session active.
 */
export function useAuth() {
  const { setUser, setTenant, setStores, setCurrentStore, setLoading, logout } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        // Plus de session Firebase côté client → on vide le store et on redirige
        logout();
        router.push('/login');
        return;
      }

      // Le profil persisté (localStorage Zustand) sert uniquement à afficher
      // quelque chose immédiatement, sans écran de chargement. On le
      // considère comme un CACHE D'AFFICHAGE, jamais comme la vérité.
      //
      // Il est systématiquement rafraîchi derrière : sans ça, un changement
      // de rôle ou d'affectation magasin décidé par un administrateur ne
      // prendrait jamais effet pour un utilisateur qui garde son navigateur
      // ouvert — il continuerait de voir son ancien menu, alors que le
      // serveur, lui, applique déjà les nouveaux droits. Deux vérités
      // divergentes, et un utilisateur qui ne comprend pas pourquoi ses
      // actions sont refusées.
      const storeUser = useAuthStore.getState().user;
      if (storeUser?.id === firebaseUser.uid) {
        setLoading(false); // on affiche le cache, et on continue pour le rafraîchir
      }

      // Re-fetch systématique du profil depuis l'API.
      try {
        const idToken = await firebaseUser.getIdToken();
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken }),
        });

        if (!res.ok) {
          logout();
          router.push('/login');
          return;
        }

        const data = await res.json();
        setUser(data.user);
        setTenant(data.tenant);
        setStores(data.stores);
        if (data.stores.length > 0 && !useAuthStore.getState().currentStore) {
          setCurrentStore(data.stores[0]);
        }
      } catch (err) {
        console.error('Auth init error:', err);
        logout();
        router.push('/login');
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);
}

/**
 * useLogout — déconnexion propre (Firebase Auth + cookie serveur + store)
 */
export function useLogout() {
  const { logout } = useAuthStore();
  const router = useRouter();

  return async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      await auth.signOut();
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      logout();
      router.push('/login');
    }
  };
}
