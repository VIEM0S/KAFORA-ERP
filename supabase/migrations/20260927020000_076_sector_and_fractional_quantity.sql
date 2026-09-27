-- Secteurs réellement fonctionnels, phase 1 (quincaillerie + épicerie) —
-- demandé le 2026-09-27 : les pages /solutions/[secteur] étaient purement
-- des pages d'atterrissage marketing (voir lib/utils/vertical-pages.ts),
-- aucun champ ne permettait au produit de savoir dans quel secteur est un
-- tenant, ni de s'y adapter. Premier vrai gain concret : la vente en
-- quantité fractionnée (kg, mètre, litre) — le schéma supporte déjà les
-- quantités décimales partout (quantity numeric depuis le début), seule la
-- caisse (POS) est aujourd'hui entier-only.

alter table tenants add column sector text
  check (sector in ('quincaillerie','epicerie','boutique-mode','electronique-telephonie'));

-- Explicite plutôt que déduit du texte libre products.unit (aucun
-- vocabulaire imposé sur ce champ, donc pas fiable pour piloter le
-- comportement de la caisse) : le commerçant coche "vendu en quantité
-- fractionnée" à la création du produit.
alter table products add column fractional_quantity boolean not null default false;
