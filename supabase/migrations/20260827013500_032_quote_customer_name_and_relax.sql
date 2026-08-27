-- Instantané manquant (même principe que sales.customer_name / migration
-- 019) : l'app affiche partout le nom du client sur un devis, y compris
-- après suppression de ce client.
alter table quotes add column customer_name text;

-- L'app n'a jamais eu de numérotation de devis (contrairement aux ventes/BC,
-- qui ont une contrainte légale OHADA) — reference généré côté client par
-- commodité d'affichage, pas une exigence métier. NOT NULL restait donc trop
-- strict par rapport à l'usage réel.
alter table quotes alter column reference drop not null;
