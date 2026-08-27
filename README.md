# Kafora

SaaS multi-tenant de gestion commerciale (POS, stock, ventes, crédit client, multi-magasins) pour les commerces d'Afrique de l'Ouest — bâti sur Next.js (App Router) + Supabase (Postgres, Auth, RLS, Realtime).

## Prérequis

- Node.js 20+
- Un projet Supabase (Postgres, Auth, Realtime)
- Docker Desktop (optionnel — uniquement pour lancer la suite de tests RLS en local, voir plus bas)
- (Optionnel mais recommandé) Un compte SendGrid pour l'envoi d'emails transactionnels (mot de passe oublié, notifications propriétaire)

## Installation

```bash
npm install
cp .env.example .env.local
```

Remplir `.env.local` avec les valeurs de ton projet Supabase (voir `.env.example` pour le détail de chaque variable et où la trouver dans le Dashboard).

## Démarrage

```bash
npm run dev       # serveur de développement — http://localhost:3000
npm run build     # build de production
npm run start     # servir le build de production
npm run typecheck # vérification TypeScript sans build complet
npm test          # suite de tests unitaires (logique métier pure, pas de dépendance externe)
```

## Migrations Postgres

Le schéma vit dans `supabase/migrations/` (une base par tenant serait ingérable — tout est une seule base Postgres, isolée par `tenant_id` + Row Level Security). Les migrations ne se déploient pas automatiquement avec le code applicatif (Netlify ne s'en charge pas) :

```bash
npx supabase link --project-ref <ref-du-projet>
npx supabase db push
```

À faire à chaque nouvelle migration, pas seulement à l'installation initiale.

### Tests RLS en local

Une suite dédiée (`__tests__/rls/*`) vérifie les politiques Row Level Security contre un vrai Postgres local (Supabase CLI + Docker) :

```bash
npm run db:start   # démarre Postgres local (rejoue supabase/migrations/)
npm run test:rls   # lance la suite RLS contre cette base
npm run db:stop
```

## Structure du projet

```
app/
  (auth)/         Connexion, mot de passe oublié
  (onboarding)/   Création de compte + choix du forfait
  (dashboard)/    Toutes les pages internes (POS, stock, ventes, crédits, utilisateurs...)
  api/            Routes serveur (client service-role Supabase) — logique métier
                  sensible : caisse, crédit, création/suppression d'utilisateurs, ventes, etc.
lib/
  supabase/       Clients Supabase (browser + service-role), mappers snake_case→camelCase,
                  wrapper Realtime (watch.ts)
  types/          Types TypeScript partagés
  utils/          Fonctions utilitaires (formatage, PDF, import produits...)
  constants/      Forfaits, permissions par rôle, plans — source unique de vérité
supabase/
  migrations/     Schéma Postgres, RLS, fonctions RPC — source de vérité du schéma
__tests__/rls/    Tests des politiques RLS (isolation tenant/magasin/rôle), contre Postgres local
```

## Notes importantes

- **Isolation multi-tenant** : chaque donnée est scopée par `tenant_id` (colonne, pas nesting), vérifié côté base par Row Level Security via `app_metadata` du JWT Supabase (pas via le contenu de la ligne, qui serait falsifiable côté client) — voir `supabase/migrations/006_auth_helper_functions.sql` et `007_rls_policies.sql`.
- **Rôles** : `OWNER > ADMIN > REGIONAL_MANAGER > MANAGER > CASHIER`, permissions détaillées dans `lib/constants/index.ts` (`ROLE_PERMISSIONS`).
- **Suppression d'un Manager/Caissier par un Admin** : passe obligatoirement par une double vérification (justification + validation du Propriétaire) — voir `app/api/users/delete/route.ts`.
- **Mode hors-ligne du POS** : les ventes faites sans connexion sont mises en file locale et synchronisées automatiquement au retour du réseau — voir `lib/offline-queue.ts`.
- **Numérotation des factures** : séquentielle par tenant et par année fiscale (`FAC-2026-000001`), via une séquence Postgres — nécessaire pour la conformité OHADA/SYSCOHADA (numérotation continue, sans trou).

## Ce qui n'est pas encore fait (connu, pas oublié)

- Pas de module comptable SYSCOHADA complet (grand livre, bilan) — l'app couvre la gestion commerciale (ventes/stock/crédit), pas la comptabilité générale.
- Pas d'intégration mobile money automatisée (vérification serveur du paiement) — le mode de paiement MOBILE_MONEY est aujourd'hui une déclaration du caissier, pas une confirmation via un agrégateur (PayDunya, CinetPay...).
