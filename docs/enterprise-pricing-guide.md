# Méthode de calcul d'un devis Enterprise

> **Statut : proposition de départ, à valider.** Ancrée sur les tarifs
> réels déjà publiés (`SUBSCRIPTION_PLANS` dans [`lib/constants/index.ts`](../lib/constants/index.ts)),
> mais les seuils et taux ci-dessous n'ont pas été confirmés par le
> fondateur — ce sont des points de départ raisonnables, pas des règles
> figées. Document interne, jamais publié sur le site.

## Pourquoi ces chiffres et pas d'autres

En comparant les deux forfaits à prix fixe :

| Forfait | Prix | Boutiques | Prix / boutique |
|---|---|---|---|
| Starter | 25 000 FCFA | 1 | **25 000 FCFA** |
| Business | 75 000 FCFA | 3 | **25 000 FCFA** |

Les deux prix existants impliquent déjà, sans l'avoir cherché, un taux de
**25 000 FCFA par boutique/mois**. C'est le point de départ le plus honnête
pour Enterprise : continuer la même logique plutôt qu'en inventer une
nouvelle.

## Grille proposée

### 1. Base récurrente (abonnement mensuel)

- **Boutiques 1 à 5** : 25 000 FCFA/boutique/mois (même taux que Starter/Business)
- **Boutiques au-delà de 5** : taux dégressif suggéré, 18 000–20 000 FCFA/boutique/mois
  — encourage les grands comptes sans brader les petits Enterprise (6-8 boutiques)

*Exemple : 8 boutiques → (5 × 25 000) + (3 × 19 000) = 182 000 FCFA/mois.*

Utilisateurs et produits restent illimités dans ce prix, comme déjà annoncé
— ne pas les facturer séparément, ça complexifie le devis sans vraie
justification (Business inclut déjà ~3,3 utilisateurs/boutique en moyenne,
généreux).

### 2. Support

- **Support prioritaire** (inclus dans le taux de base ci-dessus) : temps de
  réponse plus rapide que Business, aux heures ouvrées.
- **Support dédié/étendu** (majoration à définir, ex. +15-20 % sur la base) :
  **seulement si une vraie astreinte existe côté Kafora.** Ne pas vendre une
  disponibilité qu'on ne peut pas tenir — voir la remarque déjà faite sur
  "24/7" dans l'audit de la landing page.

### 3. Mise en place (coût unique, hors abonnement)

Reprend exactement le contenu de la section "Mise en place Kafora" de la
landing (configuration entreprise/boutiques, création utilisateurs, import
Excel, configuration caisses, formation, accompagnement démarrage) —
volontairement sans prix fixe publié. Pour le devis :

- Estimer en jours d'accompagnement plutôt qu'en forfait fixe (le besoin
  varie trop entre 4 boutiques et 20).
- Une fois un tarif journalier/horaire décidé, l'appliquer ici plutôt que
  d'improviser à chaque devis.

### 4. Intégrations et personnalisation spécifiques

Cas par cas, hors grille — accès API, intégration bancaire (voir
[`lib/payments/`](../lib/payments/types.ts), rien de branché aujourd'hui),
imports de données non standards. Devis séparé, pas de règle générale
possible tant qu'aucun de ces besoins n'a été rencontré en pratique.

## Exemple complet

> Entreprise avec 8 boutiques, formation initiale (3 jours), support
> prioritaire standard (pas d'astreinte étendue) :
>
> - Abonnement : (5 × 25 000) + (3 × 19 000) = **182 000 FCFA/mois**
> - Mise en place : 3 jours × tarif journalier à définir
> - Support : inclus dans le taux de base

## Ce qui reste à trancher

- Le taux dégressif au-delà de 5 boutiques (18-20k proposé, à confirmer)
- Le tarif journalier de mise en place/formation
- La majoration éventuelle pour un support réellement étendu (24/7)
- Le seuil exact où "Business" ne suffit plus et où "Enterprise" démarre
  (actuellement : dès qu'on dépasse 3 boutiques ou les autres plafonds
  Business — cohérent avec le menu du formulaire de contact, voir
  [`components/landing/contact-section.tsx`](../components/landing/contact-section.tsx))
