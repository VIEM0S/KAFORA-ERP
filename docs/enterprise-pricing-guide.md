# Méthode de calcul d'un devis Enterprise

> **Statut : validé par le fondateur le 2026-09-07.** Ancrée sur les tarifs
> réels déjà publiés (`SUBSCRIPTION_PLANS` dans [`lib/constants/index.ts`](../lib/constants/index.ts)).
> Document interne, jamais publié sur le site — la page Tarifs continue
> d'afficher "Sur devis" pour Enterprise.

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

## Grille validée

### 1. Base récurrente (abonnement mensuel)

- **Boutiques 1 à 5** : 25 000 FCFA/boutique/mois (même taux que Starter/Business)
- **Boutiques 6 et au-delà** : **20 000 FCFA/boutique/mois**

*Exemple : 8 boutiques → (5 × 25 000) + (3 × 20 000) = **185 000 FCFA/mois**.*

Utilisateurs et produits restent illimités dans ce prix, comme déjà annoncé
— ne pas les facturer séparément.

### 2. Support

**Support prioritaire**, inclus dans le taux de base ci-dessus — temps de
réponse plus rapide que Business, aux heures ouvrées.

Pas de support étendu/astreinte au catalogue pour l'instant : aucune
astreinte réelle n'existe côté Kafora aujourd'hui, donc rien à vendre à ce
titre — même logique que le retrait du "24/7" de la landing page et la
formulation prudente du CGV (art. 8, "moyens raisonnables"). À réintroduire
dans ce document (avec une majoration) le jour où une vraie astreinte est
mise en place.

### 3. Mise en place (coût unique, hors abonnement)

Reprend exactement le contenu de la section "Mise en place Kafora" de la
landing (configuration entreprise/boutiques, création utilisateurs, import
Excel, configuration caisses, formation, accompagnement démarrage) —
volontairement sans prix fixe publié.

**Tarif validé : 15 000 FCFA/jour d'accompagnement** (sur site ou à
distance). Estimer le nombre de jours au cas par cas selon le nombre de
boutiques et la complexité de l'import de données existantes — le besoin
varie trop entre 4 boutiques et 20 pour un forfait fixe.

### 4. Intégrations et personnalisation spécifiques

Cas par cas, hors grille — accès API, intégration bancaire (voir
[`lib/payments/`](../lib/payments/types.ts), rien de branché aujourd'hui),
imports de données non standards. Devis séparé, pas de règle générale
possible tant qu'aucun de ces besoins n'a été rencontré en pratique.

### 5. Seuil de bascule Business → Enterprise

**Dès que le client dépasse 3 boutiques** (le plafond Business) — cohérent
avec le menu du formulaire de contact
([`components/landing/contact-section.tsx`](../components/landing/contact-section.tsx)).
Les autres plafonds Business (10 utilisateurs, 5 000 produits, 5 000
clients) ne déclenchent volontairement pas Enterprise à eux seuls : en
pratique, une entreprise qui les atteint sans dépasser 3 boutiques reste un
cas rare à traiter au cas par cas plutôt qu'une règle générale.

## Exemple complet

> Entreprise avec 8 boutiques, formation initiale de 3 jours, support
> prioritaire standard (pas d'astreinte étendue) :
>
> - Abonnement : (5 × 25 000) + (3 × 20 000) = **185 000 FCFA/mois**
> - Mise en place : 3 jours × 15 000 FCFA = **45 000 FCFA** (unique)
> - Support : inclus dans le taux de base, aucun supplément

## Historique

- 2026-09-07 : grille validée par le fondateur (taux dégressif 20 000 FCFA,
  mise en place 15 000 FCFA/jour, pas d'astreinte au catalogue, seuil à 3
  boutiques). Prête à être utilisée pour les devis Enterprise réels.
