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
      const hasCache = storeUser?.id === firebaseUser.uid;
      if (hasCache) {
        setLoading(false); // on affiche le cache immédiatement
      }

      // RAFRAÎCHISSEMENT LIMITÉ DANS LE TEMPS.
      //
      // /api/auth/login est protégée par un rate-limit (15 appels / 5 min).
      // Rafraîchir à CHAQUE navigation épuisait ce quota en une quinzaine de
      // pages, et le refus qui suivait était pris pour une session expirée :
      // l'utilisateur se retrouvait déconnecté en pleine utilisation.
      //
      // On rafraîchit donc au plus une fois toutes les 5 minutes, ce qui
      // suffit largement pour qu'un changement de rôle ou d'affectation
      // magasin soit pris en compte rapidement, sans matraquer l'API.
      const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
      const lastRefresh = Number(sessionStorage.getItem('auth-refreshed-at') || 0);
      if (hasCache && Date.now() - lastRefresh < REFRESH_INTERVAL_MS) {
        return;
      }

      // Re-fetch du profil depuis l'API.
      try {
        const idToken = await firebaseUser.getIdToken();
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken }),
        });

        if (!res.ok) {
          // On ne déconnecte QUE si le serveur rejette l'identité (401/403).
          // Une erreur réseau, un rate-limit (429) ou une panne serveur (5xx)
          // ne signifient pas que la session est invalide — déconnecter dans
          // ces cas-là revient à éjecter un utilisateur légitime, parfois en
          // pleine vente.
          if (res.status === 401 || res.status === 403) {
            logout();
            router.push('/login');
          } else if (!hasCache) {
            // Pas de cache à afficher et le serveur ne répond pas : on ne
            // peut rien montrer d'utile, on renvoie vers la connexion.
            router.push('/login');
          }
          setLoading(false);
          return;
        }

        sessionStorage.setItem('auth-refreshed-at', String(Date.now()));
        let data = await res.json();

        // Les droits ont changé côté serveur : le cookie tout juste reçu a
        // été fabriqué à partir d'un jeton périmé. On force le rafraîchissement
        // du jeton et on rejoue UNE fois, pour que la session porte enfin les
        // bons droits — sans cela, l'utilisateur verrait le bon menu mais se
        // ferait refuser par les routes API.
        if (data?.claimsUpdated) {
          const freshToken = await firebaseUser.getIdToken(true);
          const retry = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken: freshToken }),
          });
          if (retry.ok) data = await retry.json();
        }

        setUser(data.user);
        setTenant(data.tenant);
        setStores(data.stores);
        if (data.stores.length > 0 && !useAuthStore.getState().currentStore) {
          setCurrentStore(data.stores[0]);
        }
      } catch (err) {
        // Coupure réseau, requête interrompue par une navigation, serveur
        // injoignable… Rien de tout cela n'invalide la session. Si on a
        // déjà un profil affiché, on le garde : déconnecter quelqu'un
        // parce que sa connexion a hoqueté serait bien pire que de le
        // laisser continuer avec des données d'il y a quelques minutes —
        // a fortiori sur une caisse, en clientèle, avec un réseau instable.
        console.error('Auth init error:', err);
        if (!hasCache) {
          logout();
          router.push('/login');
        }
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
