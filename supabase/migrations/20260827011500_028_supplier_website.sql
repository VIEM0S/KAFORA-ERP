-- Champ present cote UI (suppliers/page.tsx) mais absent du schema 003 —
-- oubli, pas une suppression voulue.
alter table suppliers add column website text;
