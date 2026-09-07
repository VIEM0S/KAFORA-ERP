/**
 * Crée (ou réinitialise le mot de passe d') un compte dédié aux tests E2E
 * Playwright — distinct du compte QA humain (qa-onboarding-test@...)
 * partagé par toute l'équipe. Rôle MANAGER (assez de droits pour tous les
 * flux financiers testés : POS, crédits, retours, transferts, BC, caisse),
 * cantonné au magasin de test existant.
 *
 * Génère un mot de passe aléatoire à chaque exécution et l'écrit dans
 * .env.test.local (jamais commité, voir .gitignore) — jamais affiché en
 * clair dans un terminal partagé.
 *
 * Usage :
 *   node --env-file=.env scripts/create-e2e-test-user.js
 */

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const EMAIL = 'e2e-test@kafora-test.local';
const TENANT_ID = '6ba35d5b-bc8c-49c8-88b8-e2f69d325c5a'; // QA Onboarding Test
const STORE_ID = 'b1a0ea3b-b139-4fc8-bf16-be184a23f2a1'; // Magasin Test QA

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
  const password = crypto.randomBytes(24).toString('base64url');

  // Compte Auth : créé s'il n'existe pas, mot de passe réinitialisé sinon —
  // idempotent, rejouable sans nettoyage manuel.
  const { data: existing } = await supabase.auth.admin.listUsers();
  const existingUser = existing?.users?.find((u) => u.email === EMAIL);

  let userId;
  if (existingUser) {
    userId = existingUser.id;
    const { error } = await supabase.auth.admin.updateUserById(userId, { password });
    if (error) throw error;
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email: EMAIL,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    userId = data.user.id;
  }

  // Profil applicatif (table `users`) — même schéma que la synchro faite par
  // app/api/auth/login/route.ts, posé directement ici pour éviter un aller-
  // retour de connexion.
  const { error: upsertError } = await supabase.from('users').upsert(
    {
      id: userId,
      tenant_id: TENANT_ID,
      email: EMAIL,
      first_name: 'E2E',
      last_name: 'Test',
      role: 'MANAGER',
      store_ids: [STORE_ID],
      is_active: true,
    },
    { onConflict: 'id' }
  );
  if (upsertError) throw upsertError;

  const envPath = path.join(__dirname, '..', '.env.test.local');
  const envContent = `# Généré par scripts/create-e2e-test-user.js — ne pas commiter (voir .gitignore).\nE2E_TEST_EMAIL=${EMAIL}\nE2E_TEST_PASSWORD=${password}\nE2E_TENANT_ID=${TENANT_ID}\nE2E_STORE_ID=${STORE_ID}\n`;
  fs.writeFileSync(envPath, envContent, 'utf8');

  console.log(`Compte E2E prêt (${EMAIL}). Identifiants écrits dans .env.test.local.`);
}

main().catch((err) => {
  console.error('Échec :', err.message || err);
  process.exit(1);
});
