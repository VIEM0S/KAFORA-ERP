/**
 * Crée un compte ÉDITEUR (SUPER_ADMIN) — sans tenant, donc sans être client.
 *
 * Un super-admin administre Kafora, il n'en est pas utilisateur : il n'a ni
 * commerce, ni magasin, ni stock. Son profil vit dans `_super_admin/{uid}`,
 * en dehors de l'arborescence `tenants/`, et son claim `tenantId` vaut null.
 *
 * Concrètement, ça garantit qu'il n'apparaît jamais dans sa propre liste de
 * clients — et donc qu'on ne risque pas d'enregistrer un paiement sur un vrai
 * client en croyant agir sur son compte de test.
 *
 * Usage :
 *   node scripts/create-publisher-account.js <email> <motdepasse> <serviceAccount.json>
 *
 * Si le compte existe déjà dans Firebase Auth, il est réutilisé (le mot de
 * passe n'est alors pas modifié).
 *
 * ATTENTION : conservez le fichier JSON du compte de service HORS du dépôt.
 */

const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const fs = require('fs');

const [email, password, saPath] = process.argv.slice(2);

if (!email || !password || !saPath) {
  console.error(
    'Usage : node scripts/create-publisher-account.js <email> <motdepasse> <serviceAccount.json>'
  );
  process.exit(1);
}
if (password.length < 8) {
  console.error('Mot de passe : 8 caractères minimum.');
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
  const db = getFirestore();

  let user;
  try {
    user = await auth.getUserByEmail(email);
    console.log(`Compte existant réutilisé (${user.uid}).`);
  } catch {
    user = await auth.createUser({ email, password, emailVerified: true });
    console.log(`Compte créé (${user.uid}).`);
  }

  // Profil éditeur, hors de l'arborescence des clients.
  await db.doc(`_super_admin/${user.uid}`).set(
    {
      uid: user.uid,
      email,
      firstName: 'Administration',
      lastName: 'Kafora',
      isActive: true,
      createdAt: new Date().toISOString(),
    },
    { merge: true }
  );

  // tenantId null : aucun client rattaché. Les règles Firestore ne lui
  // ouvrent donc aucun tenant ; son seul accès est /api/admin/*, qui
  // vérifie le rôle côté serveur.
  await auth.setCustomUserClaims(user.uid, {
    tenantId: null,
    role: 'SUPER_ADMIN',
    storeIds: null,
  });

  console.log(`\n${email} est un compte éditeur (SUPER_ADMIN), sans tenant.`);
  console.log('Connectez-vous avec ce compte : vous arriverez sur la console clients.');
  process.exit(0);
}

main().catch(err => {
  console.error('Échec :', err.message || err);
  process.exit(1);
});
