# Kafora

SaaS multi-tenant de gestion commerciale (POS, stock, ventes, crédit client, multi-magasins) pour les commerces d'Afrique de l'Ouest — bâti sur Next.js 13 (App Router) + Firebase.

## Prérequis

- Node.js 18+
- Un projet Firebase avec Authentication, Firestore, Realtime Database et Storage activés
- (Optionnel mais recommandé) Un compte SendGrid pour l'envoi d'emails transactionnels (mot de passe oublié, notifications propriétaire)

## Installation

```bash
npm install
cp .env.example .env.local
```

Remplir `.env.local` avec les valeurs de ton projet Firebase (voir `.env.example` pour le détail de chaque variable et où la trouver).

## Démarrage

```bash
npm run dev       # serveur de développement — http://localhost:3000
npm run build     # build de production
npm run start     # servir le build de production
npm run typecheck # vérification TypeScript sans build complet
```

## Déploiement des règles Firestore

Les règles de sécurité vivent dans `firestore.rules` à la racine et doivent être déployées séparément du code applicatif (Netlify/Vercel ne les déploie pas automatiquement) :

```bash
firebase deploy --only firestore:rules
```

À faire à chaque modification de `firestore.rules`, pas seulement à l'installation initiale.

## Structure du projet

```
app/
  (auth)/         Connexion, mot de passe oublié
  (onboarding)/   Création de compte + choix du forfait
  (dashboard)/    Toutes les pages internes (POS, stock, ventes, crédits, utilisateurs...)
  api/            Routes serveur (Admin SDK) — logique métier sensible : caisse,
                  crédit, création/suppression d'utilisateurs, ventes, etc.
lib/
  firebase/       Clients Firebase (browser + Admin SDK) et helpers de quotas
  types/          Types TypeScript partagés
  utils/          Fonctions utilitaires (formatage, PDF, import produits...)
  constants/      Forfaits, permissions par rôle, plans — source unique de vérité
firestore.rules  Règles de sécurité Firestore (isolation multi-tenant, rôles)
```

## Notes importantes

- **Isolation multi-tenant** : chaque donnée est scopée par `tenantId`, vérifié via les *custom claims* du token Firebase (pas via le contenu du document, qui serait falsifiable côté client).
- **Rôles** : `OWNER > ADMIN > MANAGER > CASHIER`, permissions détaillées dans `lib/constants/index.ts` (`ROLE_PERMISSIONS`).
- **Suppression d'un Manager/Caissier par un Admin** : passe obligatoirement par une double vérification (justification + validation du Propriétaire) — voir `app/api/users/delete/route.ts`.
- **Mode hors-ligne du POS** : les ventes faites sans connexion sont mises en file locale et synchronisées automatiquement au retour du réseau — voir `lib/offline-queue.ts`.
- **Numérotation des factures** : séquentielle par tenant et par année fiscale (`FAC-2026-000001`), via un compteur atomique Firestore — nécessaire pour la conformité OHADA/SYSCOHADA (numérotation continue, sans trou).

## Ce qui n'est pas encore fait (connu, pas oublié)

- Pas de module comptable SYSCOHADA complet (grand livre, bilan) — l'app couvre la gestion commerciale (ventes/stock/crédit), pas la comptabilité générale.
- Pas d'intégration mobile money automatisée (vérification serveur du paiement) — le mode de paiement MOBILE_MONEY est aujourd'hui une déclaration du caissier, pas une confirmation via un agrégateur (PayDunya, CinetPay...).
