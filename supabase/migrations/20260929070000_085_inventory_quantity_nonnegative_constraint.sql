-- inventory.quantity n'avait aucune contrainte CHECK >= 0 -- contrairement
-- a product_lots.quantity (migration 041) qui en a une. Aucun bug actif
-- trouve (toutes les ecritures connues sont deja des updates atomiques
-- correctement bornees par greatest(0, ...)), mais c'est la table la plus
-- ecrite de l'app (chaque vente POS la touche) et elle n'avait aucun filet
-- de securite en base si un futur chemin de code oubliait cette discipline.
-- Trouve lors de l'audit de concurrence du 2026-09-29. Confirme via SQL
-- avant application : aucune ligne existante n'est negative.
alter table inventory add constraint inventory_quantity_nonnegative check (quantity >= 0);
