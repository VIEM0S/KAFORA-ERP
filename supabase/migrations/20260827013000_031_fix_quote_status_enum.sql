-- L'enum quote_status (migration 001) reprenait lib/types/index.ts, qui
-- s'avère aspirationnel : l'app REELLE (quotes/page.tsx) n'utilise que
-- PENDING/ACCEPTED/CONVERTED/REFUSED/EXPIRED — jamais DRAFT/SENT/REJECTED.
-- Trouvé en portant customers/[id]/page.tsx et quotes/page.tsx vers Supabase.
-- Aucune donnée réelle en base (pré-lancement) : on recrée le type au lieu
-- de porter un enum erroné.
alter table quotes alter column status drop default;
alter table quotes alter column status type text;
drop type quote_status;
create type quote_status as enum ('PENDING','ACCEPTED','CONVERTED','REFUSED','EXPIRED');
alter table quotes alter column status type quote_status using status::quote_status;
alter table quotes alter column status set default 'PENDING';
