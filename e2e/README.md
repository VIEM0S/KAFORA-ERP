# Tests E2E (Playwright)

Suite de tests de bout en bout sur les flux financiers critiques (vente,
crédit, retour, caisse) — pilote un vrai navigateur contre le serveur de dev
et le tenant Supabase "QA Onboarding Test", déjà utilisé pour toutes les
vérifications manuelles de ce projet.

**Pourquoi cette suite existe** : l'audit du 2026-09-07 a trouvé plusieurs
bugs réels (badge de statut incorrect, panneau de détail jamais rafraîchi,
solde jamais remis à zéro) qui n'étaient visibles qu'en cliquant vraiment
dans l'interface — invisibles aux 101 tests unitaires (`npm test`, logique
pure) et à la suite RLS (`npm run test:rls`, policies Postgres en isolation).
Chaque test de ce dossier est la régression directe d'un bug réellement
trouvé — voir le commentaire en tête de chaque fichier `.spec.ts`.

## Lancer la suite

```bash
# Une seule fois (ou si le mot de passe a expiré/été perdu) : crée un compte
# de test dédié (MANAGER, tenant QA) et écrit ses identifiants dans
# .env.test.local (jamais commité).
npm run test:e2e:setup

# Le serveur de dev doit tourner (npm run dev) — ou laissez playwright.config.ts
# le démarrer lui-même (webServer, reuseExistingServer: true).
npm run test:e2e
```

## Principes

- **Un compte dédié**, pas le compte QA humain partagé (`qa-onboarding-test@...`)
  — évite toute interférence avec une vérification manuelle en cours.
- **Chaque test crée ses propres données** (produit, client, vente...) avec un
  suffixe unique (`uniqueSuffix()`) et les supprime dans `afterAll`/`afterEach`,
  y compris en cas d'échec — le tenant QA partagé doit rester dans son état de
  référence après chaque exécution, réussie ou non.
- **Jamais de recherche/filtre texte** pour trouver une ligne dans une liste :
  vérifié en direct que les champs de recherche du POS et de l'historique des
  ventes ne filtrent pas réellement la liste affichée. Cibler les lignes par
  un texte unique qu'on contrôle (montant précis, nom généré) via
  `page.locator('tr', { hasText: ... })`, jamais par un texte ambigu qui peut
  aussi apparaître dans une carte de statistiques ou le panneau de détail
  encore ouvert.
- **`getByText` est insensible à la casse** (comportement Playwright) : une
  recherche non scopée à une table peut matcher un mot ailleurs sur la page
  (ex. `"Annulée"` correspond aussi à `"Ventes annulées"`). Scoper avec
  `page.locator('table').getByText(...)` dès qu'il y a ambiguïté.
- **Attendre un signal qui ne peut être vrai qu'après la mutation**, jamais un
  texte qui existe déjà avant l'action (ex. ne pas attendre "0 FCFA" après une
  annulation de crédit — "Total versé" affiche déjà 0 FCFA avant toute
  action).

## Étendre la suite

Bons candidats pour un prochain ajout : transfert entre magasins, réception
de commande fournisseur (les deux testés manuellement pendant l'audit du
2026-09-07, pas encore automatisés — nécessitent un 2ᵉ magasin et un
fournisseur, mis en place à la main dans l'audit).
