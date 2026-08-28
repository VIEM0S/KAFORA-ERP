-- L'app n'a jamais eu qu'une seule caisse par magasin (l'ancien etat RTDB
-- vivait sous une cle synthetique register_${storeId}, jamais un vrai
-- identifiant de caisse choisi par l'utilisateur). cash_registers n'etait
-- alimentee par aucune route — trouve en portant cash-register/page.tsx.
-- Cette contrainte permet aux routes open/close de resoudre (ou creer) LA
-- caisse d'un magasin sans jamais faire confiance a un identifiant fourni
-- par le client.
alter table cash_registers add constraint uq_cash_registers_tenant_store unique (tenant_id, store_id);
