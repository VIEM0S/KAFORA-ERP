-- payment_terms est un nombre de jours (0 = comptant), pas du texte libre —
-- l'app le traite partout comme un nombre (suppliers/page.tsx,
-- purchase-orders/page.tsx). Erreur de frappe en migration 003, trouvee en
-- construisant le mapper Supabase de Phase 5.
alter table suppliers alter column payment_terms type numeric using nullif(payment_terms, '')::numeric;
