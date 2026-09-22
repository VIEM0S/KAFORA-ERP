# Étude comparative — MANDE-SOLAIRE-DEYE-ERP vs Kafora

**Date :** 21-22 septembre 2026
**Demande initiale :** « fais une analyse, étude comparative, deep searching de mande_solaire_deye, je pense qu'il y a des fonctionnalités intéressantes que l'on peut intégrer ici »

## Méthodologie

Comparaison code à code entre les deux dépôts du même atelier — `MANDE-SOLAIRE-DEYE-ERP` (secteur solaire, mono-entreprise) et `KAFORA-ERP` (multi-commerce, multi-tenant) — sur les tables, fonctions SQL, politiques RLS et écrans, avec citation de fichier des deux côtés. Chaque hypothèse a été vérifiée en réel sur le tenant QA de production Kafora, avec des comptes et données jetables créés puis supprimés (ou restaurés, avec vérification d'égalité) dans le même passage.

## Comparatif fonctionnalité par fonctionnalité

| Fonctionnalité | MANDE-SOLAIRE-DEYE-ERP | Kafora (avant) | Verdict |
|---|---|---|---|
| **Dépenses** | Table `depenses` + `fn_creer_depense()` : catégorie, justificatif, seuil `seuil_validation_depense` au-dessus duquel la dépense reste `en_attente` (`supabase/migrations/20260101002700_0028.sql`) | Inexistante — aucune table, aucun écran | **Porté** (`bf7705e`) : table `expenses`, seuil configurable, double validation sans auto-approbation |
| **Ajustement de stock (pertes/casse)** | `fn_ajuster_stock()` : au-dessus de `seuil_validation_perte_casse`, la perte reste `en_attente` d'une revue siège (`20260101002700_0028.sql`) | `adjust_inventory()` acceptait toute sortie, motif facultatif, aucune relecture (`20260904235500_050_adjust_inventory_rpc.sql`) | **Porté** (`ae7491a`) : seuil de perte au prix d'achat, réservé Owner/Admin au-dessus |
| **Inventaire physique (comptage)** | `fn_demarrer_inventaire()`/`fn_valider_inventaire()` : session de comptage par ligne produit, écart valorisé, mise en attente si écart important (`20260101002700_0028.sql`, `20260101005900_0060.sql`) | Inexistant | **Porté** (`ae7491a`) : `stocktakes`/`stocktake_lines`, écarts appliqués en delta sur le stock réel (jamais écrasés par une vente concurrente pendant le comptage), même principe de seuil |
| **Piste d'audit générique** | `log_audit()` appelée par la quasi-totalité des fonctions métier (ventes, stock, dépenses, inventaire, utilisateurs...) — couverture large dès l'origine (`20260101000100_0002.sql`) | `audit_log` limité aux annulations/limites de crédit (`20260902100000_045_credit_governance.sql`) ; `audit_logs` (autre table, générique) ne recevait que LOGIN/ROLE_CHANGED/SUPPORT_* | **Partiellement porté** (`886de04`) : ajout du suivi des changements de prix produit ; reste plus étroit que MSD (voir « reste ouvert ») |
| **Garanties / SAV** | Tables `garanties`, `numeros_serie` + `fn_declarer_sav()`/`fn_cloturer_sav()`/`fn_reclamer_garantie()` (`20260101000000_0001.sql`, `20260101001400_0015.sql`) | Suivi par numéro de série existe (migration 041), mais aucun SAV/garantie | **Écarté** — décision explicite du fondateur : « je ne mets pas de garanties ni SAV, car je n'en vois pas l'utilité si mes clients n'en ont pas besoin » |
| **Permissions individuelles** | `permissions`/`role_permissions`/`user_permissions`, avec dérogation temporaire par utilisateur et expiration (`user_permissions.expire_at`, `20260101004500_0046.sql`) | 5 rôles fixes (`OWNER`/`ADMIN`/`REGIONAL_MANAGER`/`MANAGER`/`CASHIER`), permissions câblées dans `ROLE_PERMISSIONS` (`lib/constants/index.ts`) | **Écarté** — granularité de grande structure, sans valeur pour la cible actuelle de Kafora (petits commerces) |
| **Revue périodique des accès** | `fn_enregistrer_revue_acces()` : attestation « j'ai vérifié qui a quel accès », réservée DG/RA (`20260101004500_0046.sql`) | Inexistant | **Écarté** — même raisonnement que ci-dessus |
| **Numérotation des documents** | Compteur générique `compteurs_documents` (type_document, année) réutilisé pour achats/transferts, sans trou (`20260101002700_0028.sql`) | Compteurs dédiés pour ventes (migration 014) et bons de commande (migration 022) uniquement | **Non porté** — Kafora a déjà l'équivalent sur ses deux types principaux ; pas vérifié sur les autres types de document, pas signalé comme un problème réel |
| **Sauvegardes** | Fonction planifiée `sauvegarde-planifiee` (Edge Function) + route `/api/sauvegarde` | Aucune (Supabase en plan gratuit, pas de sauvegarde automatique) | **Différé** — décision explicite du fondateur (« pour la sauvegarde on laisse ça pour plus tard »), déjà documenté comme écart CGV connu |
| **Caisse (ouverture/fermeture)** | Clôture de caisse propre à MSD | `close_cash_register()` recalcule depuis les tables source par propriétaire/fenêtre, sans risque de mouvement orphelin (`20260903090000_047_per_cashier_registers.sql`) | **Kafora déjà meilleur** — rien à importer |
| **Multi-tenant / abonnements** | Mono-entreprise, pas de notion de tenant | Multi-tenant complet, plans et limites par forfait | **Kafora déjà meilleur** |
| **Gouvernance du crédit** | Pas d'équivalent direct | Seuil + double validation sans auto-approbation, modèle « agence bancaire » (magasin d'inscription du client) | **Kafora déjà meilleur** |
| **Mode hors ligne** | Pas d'équivalent identifié | File de synchronisation hors ligne (`hooks/use-offline-sync.ts`) | **Kafora déjà meilleur** |

## Faille critique trouvée en creusant (sans rapport direct avec une fonctionnalité comparée)

En vérifiant si Kafora avait le même défaut que MSD avait eu et corrigé chez lui (« compte désactivé gardait tous ses droits »), la comparaison a fait remonter cinq failles de sécurité réelles, toutes corrigées et en production :

| # | Faille | Commit |
|---|---|---|
| 1 | Helpers d'autorisation SQL renvoyant `NULL` au lieu de `false` — un compte sans rôle passait les contrôles `is_manager()`/`can_write()` sur les RPC de crédit | `91c03bd` |
| 2 | Désactiver un compte ne bannissait pas la session Supabase Auth — un jeton déjà émis restait valide indéfiniment | `e529818` |
| 3 | Le stock pouvait être modifié directement (PostgREST) sans passer par les RPC qui écrivent le mouvement associé — disparition possible sans trace | `bf4d625` |
| 4 | Le prix d'achat des produits était lisible par API par n'importe quel rôle, y compris un Caissier | `e841f7b` → `dd236c1` |
| 5 | La page de réinitialisation de mot de passe n'établissait jamais de session — « lien invalide » sur un lien qui vient d'être généré, pour tout compte | `aa0687c` |

## Piste d'audit — étendue le 22 septembre 2026

Kafora avait en réalité **deux** tables d'audit distinctes, pas une doublon de l'autre : `audit_logs` (générique, alimente surtout la console éditeur — LOGIN, rôle modifié...) et `audit_log` (piste de gouvernance du tenant, lue par sa propre page `/audit-log`, Owner/Admin). En vérifiant qui écrivait quoi, trois routes se sont révélées ne rien journaliser du tout malgré le bannissement Auth posé la veille : désactiver, supprimer et restaurer un compte n'avaient **aucune trace**, ni dans l'une ni dans l'autre table.

Corrigé : un nouvel helper `writeGovernanceLog()` (`lib/supabase/audit-log.ts`) alimente `audit_log` depuis `toggle-status`, `delete`, `restore`, `update` (changement de rôle) et `sales/cancel` — en plus des écritures déjà en place, sans rien retirer. Chaque entrée porte l'acteur, la personne/vente ciblée et le détail (ancien/nouveau rôle, motif d'annulation...). Vérifié en réel avec un compte Propriétaire et une cible jetables : désactivation, réactivation, changement de rôle, suppression, restauration et annulation de vente produisent chacune leur entrée, visible sur `/audit-log` avec un libellé lisible.

**Trouvé en testant** : un double-clic rapide (moins d'une seconde) sur l'interrupteur Actif/Inactif d'un utilisateur peut envoyer deux fois la même action au lieu d'alterner — `toggleActive()` calcule la nouvelle valeur à partir de l'état local du tableau (`!u.isActive`), qui n'a pas toujours eu le temps de se resynchroniser via le temps réel avant le second clic. Sans conséquence de sécurité (bannir deux fois de suite ne fait rien de plus), mais peut désorienter si quelqu'un veut réactiver juste après avoir désactivé. Non corrigé, à faire si jugé utile — la correction consiste à recalculer la valeur depuis la réponse du serveur plutôt que depuis l'état local.

## Reste ouvert

- **Sauvegardes planifiées** — système MSD prêt à reprendre, différé par le fondateur.
- **Mentions légales** — adresse/NIF à remplir, sans rapport avec cette étude.
