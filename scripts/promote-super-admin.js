/**
 * Attribue le rôle SUPER_ADMIN à un compte tenant EXISTANT — accès à la
 * console éditeur en plus de son rôle normal dans son entreprise.
 *
 * Différent de create-publisher-account.js : celui-ci crée un compte
 * éditeur autonome, sans tenant. Celui-ci élève en place un utilisateur qui
 * appartient déjà à un tenant (garde son tenant_id, son entreprise, ses
 * données) — la table `super_admins` (réservée aux comptes éditeur sans
 * tenant, voir app/api/auth/login/route.ts) n'entre pas en jeu ici.
 *
 * Ce rôle donne la visibilité sur TOUS les clients, il traverse donc
 * volontairement l'isolation multi-tenant. Il ne peut pas être attribué
 * depuis l'application (la création d'utilisateur n'accepte que
 * ADMIN/MANAGER/CASHIER) : c'est précisément la garantie recherchée — même
 * un compte Propriétaire compromis ne peut pas se l'octroyer.
 *
 * Usage :
 *   node --env-file=.env scripts/promote-super-admin.js <email>
 *
 * Pour RETIRER le rôle (repasse en OWNER), relancer avec --revoke :
 *   node --env-file=.env scripts/promote-super-admin.js <email> --revoke
 *
 * Lit NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY depuis
 * l'environnement (voir .env).
 */

const { createClient } = require('@supabase/supabase-js');

const [email, flag] = process.argv.slice(2);
const revoke = flag === '--revoke';

if (!email) {
  console.error('Usage : node --env-file=.env scripts/promote-super-admin.js <email> [--revoke]');
  process.exit(1);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  console.error('NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY doivent être définies (voir .env).');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const { data: user, error: findError } = await supabase
    .from('users')
    .select('id, tenant_id, role')
    .ilike('email', email)
    .maybeSingle();
  if (findError) throw findError;

  if (!user) {
    console.error(
      `Aucun profil tenant trouvé pour ${email}.\n` +
      "S'il s'agit d'un compte éditeur autonome (sans tenant), utilisez " +
      'create-publisher-account.js à la place — ce script-ci ne concerne que ' +
      'les comptes qui appartiennent déjà à un tenant.'
    );
    process.exit(1);
  }

  const newRole = revoke ? 'OWNER' : 'SUPER_ADMIN';

  // Rien à faire côté Supabase Auth / app_metadata ici : la route de
  // connexion (app/api/auth/login/route.ts) resynchronise app_metadata.role
  // depuis users.role à CHAQUE connexion. Modifier seulement le jeton sans
  // toucher la ligne `users` serait écrasé dès la reconnexion suivante —
  // exactement le piège qu'avait cette même remarque côté Firestore.
  const { error: updateError } = await supabase
    .from('users')
    .update({ role: newRole, updated_at: new Date().toISOString() })
    .eq('id', user.id);
  if (updateError) throw updateError;

  console.log(
    revoke
      ? `Rôle SUPER_ADMIN retiré à ${email} (repassé en OWNER).`
      : `${email} est maintenant SUPER_ADMIN (garde son tenant existant).`
  );
  console.log(
    "\nIMPORTANT : le rôle est porté par le jeton d'authentification.\n" +
    "L'utilisateur doit se DÉCONNECTER puis se reconnecter pour que le\n" +
    'changement prenne effet.'
  );
  process.exit(0);
}

main().catch((err) => {
  console.error('Échec :', err.message || err);
  process.exit(1);
});
