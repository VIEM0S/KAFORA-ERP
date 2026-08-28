/**
 * Crée un compte ÉDITEUR (SUPER_ADMIN) — sans tenant, donc sans être client.
 *
 * Un super-admin administre Kafora, il n'en est pas utilisateur : il n'a ni
 * commerce, ni magasin, ni stock. Son profil vit dans la table
 * `super_admins`, séparée de `users` (qui exige un tenant_id) — même
 * séparation qu'avec `_super_admin/{uid}` sous Firestore, pour la même
 * raison : garantir qu'il n'apparaît jamais dans sa propre liste de clients,
 * et donc qu'on ne risque pas d'enregistrer un paiement sur un vrai client
 * en croyant agir sur son compte de test. Voir app/api/auth/login/route.ts
 * (branche SUPER_ADMIN) : app_metadata est synchronisé automatiquement à la
 * prochaine connexion dès que la ligne super_admins existe, pas besoin de le
 * faire ici à la main.
 *
 * Usage :
 *   node --env-file=.env scripts/create-publisher-account.js <email> <motdepasse>
 *
 * Si le compte existe déjà dans Supabase Auth, il est réutilisé (le mot de
 * passe n'est alors pas modifié).
 *
 * Lit NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY depuis
 * l'environnement (voir .env) — pas de fichier de compte de service séparé
 * comme avec Firebase, la clé de service Supabase suffit.
 */

const { createClient } = require('@supabase/supabase-js');

const [email, password] = process.argv.slice(2);

if (!email || !password) {
  console.error('Usage : node --env-file=.env scripts/create-publisher-account.js <email> <motdepasse>');
  process.exit(1);
}
if (password.length < 8) {
  console.error('Mot de passe : 8 caractères minimum.');
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

async function findUserByEmail(email) {
  // L'API admin GoTrue n'a pas de "getUserByEmail" direct — on liste et on
  // filtre. Un projet Kafora a un nombre de comptes largement sous la
  // pagination par défaut (1000/page) ; pas besoin de boucler les pages ici.
  const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  return data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null;
}

async function main() {
  let user = await findUserByEmail(email);

  if (user) {
    console.log(`Compte existant réutilisé (${user.id}).`);
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    user = data.user;
    console.log(`Compte créé (${user.id}).`);
  }

  const { error: upsertError } = await supabase.from('super_admins').upsert(
    {
      id: user.id,
      email,
      first_name: 'Administration',
      last_name: 'Kafora',
      is_active: true,
    },
    { onConflict: 'id' }
  );
  if (upsertError) throw upsertError;

  console.log(`\n${email} est un compte éditeur (SUPER_ADMIN), sans tenant.`);
  console.log('Connectez-vous avec ce compte : vous arriverez sur la console clients.');
  console.log("(app_metadata est synchronisé à la connexion — pas besoin de vous reconnecter deux fois.)");
  process.exit(0);
}

main().catch((err) => {
  console.error('Échec :', err.message || err);
  process.exit(1);
});
