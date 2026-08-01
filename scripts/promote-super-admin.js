/**
 * Attribue le rôle SUPER_ADMIN à un compte — accès à la console éditeur.
 *
 * Ce rôle donne la visibilité sur TOUS les clients, il traverse donc
 * volontairement l'isolation multi-tenant. Il ne peut pas être attribué
 * depuis l'application (la création d'utilisateur n'accepte que
 * ADMIN/MANAGER/CASHIER) : c'est précisément la garantie recherchée — même
 * un compte Propriétaire compromis ne peut pas se l'octroyer.
 *
 * Usage :
 *   node scripts/promote-super-admin.js <email> <chemin/serviceAccount.json>
 *
 * Pour RETIRER le rôle, relancer avec --revoke :
 *   node scripts/promote-super-admin.js <email> <serviceAccount.json> --revoke
 *
 * ATTENTION : conservez le fichier JSON du compte de service HORS du dépôt.
 * C'est une clé d'administration complète de votre base.
 */

const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const fs = require('fs');

const [email, saPath, flag] = process.argv.slice(2);
const revoke = flag === '--revoke';

if (!email || !saPath) {
  console.error(
    'Usage : node scripts/promote-super-admin.js <email> <serviceAccount.json> [--revoke]'
  );
  process.exit(1);
}
if (!fs.existsSync(saPath)) {
  console.error(`Fichier introuvable : ${saPath}`);
  process.exit(1);
}

const sa = JSON.parse(fs.readFileSync(saPath, 'utf8'));
initializeApp({
  credential: cert({
    projectId: sa.project_id,
    clientEmail: sa.client_email,
    privateKey: sa.private_key,
  }),
});

async function main() {
  const auth = getAuth();
  const user = await auth.getUserByEmail(email);
  const existing = user.customClaims || {};

  if (revoke) {
    // On retire SUPER_ADMIN sans toucher au reste : le compte garde son
    // tenant et ses magasins, il redevient un utilisateur normal.
    const { role, ...rest } = existing;
    await auth.setCustomUserClaims(user.uid, { ...rest, role: 'OWNER' });
    console.log(`Rôle SUPER_ADMIN retiré à ${email} (repassé en OWNER).`);
  } else {
    await auth.setCustomUserClaims(user.uid, { ...existing, role: 'SUPER_ADMIN' });
    console.log(`${email} est maintenant SUPER_ADMIN.`);
  }

  console.log(
    "\nIMPORTANT : le rôle est porté par le jeton d'authentification.\n" +
    "L'utilisateur doit se DÉCONNECTER puis se reconnecter pour que le\n" +
    'changement prenne effet.'
  );
  process.exit(0);
}

main().catch(err => {
  console.error('Échec :', err.message || err);
  process.exit(1);
});
