import type { LucideIcon } from 'lucide-react';
import { Wrench, ShoppingBasket, Shirt, Smartphone } from 'lucide-react';

/**
 * Contenu des pages d'atterrissage par secteur (app/solutions/[secteur]).
 *
 * Kafora est un produit généraliste — ces pages ne décrivent AUCUNE
 * fonctionnalité qui n'existe pas ailleurs sur le site, elles reformulent
 * les mêmes fonctionnalités réelles (stock, POS, crédits, multi-magasins)
 * avec le vocabulaire et les exemples concrets de chaque métier. Source
 * unique : la liste ici pilote à la fois la navigation (menu "Secteurs")
 * et le contenu de chaque page.
 */
export interface VerticalPage {
  slug: string;
  name: string;
  icon: LucideIcon;
  headline: string;
  painPoint: string;
  highlights: { title: string; description: string }[];
}

export const VERTICAL_PAGES: VerticalPage[] = [
  {
    slug: 'quincaillerie',
    name: 'Quincaillerie',
    icon: Wrench,
    headline: 'Le logiciel de gestion pensé pour les quincailleries',
    painPoint:
      "Des centaines de références (clous, vis, tuyaux, outillage), des clients qui achètent souvent à crédit, et un stock qui doit être juste — un client qui redemande \"les clous de 4cm\" ne doit jamais tomber sur une rupture non signalée.",
    highlights: [
      {
        title: 'Stock précis, référence par référence',
        description:
          "Chaque produit (même les petites pièces vendues à l'unité) a son propre suivi de stock et son seuil d'alerte — vous savez ce qu'il vous reste avant d'être à sec.",
      },
      {
        title: 'Vente à crédit maîtrisée',
        description:
          "Beaucoup de clients quincaillerie (artisans, chantiers) paient en plusieurs fois. Kafora suit chaque créance et vous alerte en cas de dépassement de plafond.",
      },
      {
        title: 'Plusieurs dépôts, une seule vue',
        description:
          'Si vous avez un dépôt et un point de vente séparés, gérez les deux depuis le même endroit, avec transferts de stock entre eux.',
      },
    ],
  },
  {
    slug: 'epicerie',
    name: 'Épicerie / alimentation générale',
    icon: ShoppingBasket,
    headline: 'La caisse et la gestion de stock pour votre épicerie',
    painPoint:
      "Des dizaines de clients par heure, un stock qui tourne vite, et une marge qu'il faut suivre produit par produit — pas juste en fin de mois quand il est trop tard pour corriger.",
    highlights: [
      {
        title: 'Caisse rapide',
        description:
          'Scan code-barres, paiement mobile money ou espèces, ticket généré automatiquement — pensé pour encaisser vite aux heures de pointe.',
      },
      {
        title: 'Alertes de stock bas automatiques',
        description:
          'Soyez prévenu avant la rupture sur vos produits à forte rotation, sans avoir à compter les rayons vous-même chaque jour.',
      },
      {
        title: 'Rentabilité par produit',
        description:
          "Voyez quels produits vous rapportent vraiment, pas seulement votre chiffre d'affaires global.",
      },
    ],
  },
  {
    slug: 'boutique-mode',
    name: 'Boutique de mode / vêtements',
    icon: Shirt,
    headline: 'Gérez votre boutique de mode sans perdre le fil',
    painPoint:
      "Chaque taille et chaque couleur compte comme une référence à part. Sans suivi précis, on découvre une rupture seulement quand le client la demande.",
    highlights: [
      {
        title: 'Une référence par taille/couleur',
        description:
          "Enregistrez chaque variante (ex: \"Robe bleue - M\") comme un produit suivi séparément, avec son propre stock et son propre prix si besoin.",
      },
      {
        title: 'Multi-utilisateurs par rôle',
        description:
          'Vendeuse en caisse, gérant qui suit les chiffres — chacun a accès à ce dont il a besoin, pas plus.',
      },
      {
        title: 'Analytics par saison',
        description:
          'Identifiez vos meilleures ventes pour mieux réapprovisionner à la prochaine collection.',
      },
    ],
  },
  {
    slug: 'electronique-telephonie',
    name: 'Électronique / Téléphonie',
    icon: Smartphone,
    headline: 'La gestion adaptée aux boutiques d\'électronique et d\'accessoires téléphone',
    painPoint:
      "Des dizaines de références qui changent vite (coques, chargeurs, écouteurs...), des prix d'achat qui varient d'un arrivage à l'autre, et parfois plusieurs points de vente à suivre en même temps.",
    highlights: [
      {
        title: 'Marge suivie à chaque arrivage',
        description:
          "Le prix d'achat peut varier d'une commande à l'autre — Kafora calcule votre marge réelle sur chaque vente, pas une moyenne approximative.",
      },
      {
        title: 'Multi-magasins en temps réel',
        description:
          'Plusieurs boutiques ? Suivez le stock et les ventes de chacune séparément, avec un rapport consolidé pour la vue d\'ensemble.',
      },
      {
        title: "Pas besoin de développer votre propre outil",
        description:
          "Certaines enseignes du secteur ont dû construire leur propre système faute d'option adaptée. Kafora vous évite ce détour.",
      },
    ],
  },
];

export function getVerticalPage(slug: string): VerticalPage | undefined {
  return VERTICAL_PAGES.find((v) => v.slug === slug);
}
