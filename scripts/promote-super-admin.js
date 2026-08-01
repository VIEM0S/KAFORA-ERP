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
const { getFirestore } = require('firebase-admin/firestore');
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
  const db = getFirestore();
  const user = await auth.getUserByEmail(email);
  const existing = user.customClaims || {};
  const newRole = revoke ? 'OWNER' : 'SUPER_ADMIN';

  await auth.setCustomUserClaims(user.uid, { ...existing, role: newRole });

  // INDISPENSABLE : la route de connexion resynchronise les claims depuis le
  // profil Firestore à chaque login. Si on ne modifiait que le jeton, le
  // rôle serait écrasé dès la reconnexion suivante — c'est-à-dire
  // immédiatement, puisqu'une reconnexion est justement nécessaire pour
  // qu'un changement de rôle prenne effet.
  const tenantId = existing.tenantId;
  if (tenantId) {
    const ref = db.doc(`tenants/${tenantId}/users/${user.uid}`);
    const snap = await ref.get();
    if (snap.exists) {
      await ref.update({ role: newRole, updatedAt: new Date().toISOString() });
      console.log(`Profil Firestore mis à jour (tenants/${tenantId}/users/${user.uid}).`);
    } else {
      console.warn(
        `ATTENTION : profil Firestore introuvable pour ce compte.\n` +
        `Le rôle risque d'être écrasé à la prochaine connexion.`
      );
    }
  } else {
    console.warn(
      `ATTENTION : aucun tenantId dans les claims de ce compte.\n` +
      `Connectez-vous une fois à l'application avant de lancer ce script.`
    );
  }

  console.log(
    revoke
      ? `Rôle SUPER_ADMIN retiré à ${email} (repassé en OWNER).`
      : `${email} est maintenant SUPER_ADMIN.`
  );

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
