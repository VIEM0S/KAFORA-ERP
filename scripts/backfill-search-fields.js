/**
 * Rattrapage des champs de recherche sur les données déjà en base.
 *
 * La recherche du POS s'appuie sur deux champs dénormalisés en minuscules
 * (Firestore ne sait pas faire de recherche insensible à la casse) :
 *   - products.nameLower
 *   - customers.searchName
 *
 * Ils sont désormais écrits automatiquement à chaque création/modification,
 * mais les documents créés AVANT ne les ont pas — ils resteraient donc
 * introuvables à la recherche. Ce script les remplit une bonne fois.
 *
 * À lancer une seule fois, depuis la racine du projet :
 *   node scripts/backfill-search-fields.js
 *
 * Il a besoin des mêmes variables que l'application (fichier .env.local) :
 *   FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL,
 *   FIREBASE_ADMIN_PRIVATE_KEY
 *
 * Sans risque : le script ne fait qu'ajouter des champs, il ne supprime et
 * ne modifie jamais de donnée existante. Il peut être relancé sans dommage.
 */

// firebase-admin v13+ n'expose plus `admin.credential` en CommonJS :
// il faut passer par les sous-modules.
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const fs = require('fs');
const path = require('path');

// Chargement minimal de .env.local (évite une dépendance à dotenv)
const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

if (!process.env.FIREBASE_ADMIN_PROJECT_ID || !process.env.FIREBASE_ADMIN_PRIVATE_KEY) {
  console.error(
    'Variables Firebase Admin manquantes.\n' +
    'Vérifiez que .env.local existe à la racine et contient ' +
    'FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL et FIREBASE_ADMIN_PRIVATE_KEY.'
  );
  process.exit(1);
}

initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
    clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
    privateKey: (process.env.FIREBASE_ADMIN_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  }),
});

const db = getFirestore();
const BATCH_SIZE = 400; // marge sous la limite Firestore de 500 écritures

async function backfillCollection(tenantId, name, buildField) {
  const col = db.collection(`tenants/${tenantId}/${name}`);
  const snap = await col.get();

  let batch = db.batch();
  let pending = 0;
  let updated = 0;

  for (const docSnap of snap.docs) {
    const value = buildField(docSnap.data());
    if (value === null) continue; // rien à écrire (déjà correct ou pas de nom)

    batch.update(docSnap.ref, value);
    pending++;
    updated++;

    if (pending >= BATCH_SIZE) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }

  if (pending > 0) await batch.commit();
  console.log(`  ${name} : ${updated} document(s) mis à jour sur ${snap.size}`);
}

async function main() {
  const tenants = await db.collection('tenants').get();
  console.log(`${tenants.size} tenant(s) à traiter\n`);

  for (const tenant of tenants.docs) {
    console.log(`Tenant ${tenant.id} (${tenant.data().name || 'sans nom'})`);

    await backfillCollection(tenant.id, 'products', data => {
      const expected = (data.name || '').toLowerCase();
      if (!expected || data.nameLower === expected) return null;
      return { nameLower: expected };
    });

    await backfillCollection(tenant.id, 'customers', data => {
      const expected = [data.firstName, data.lastName, data.companyName]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!expected || data.searchName === expected) return null;
      return { searchName: expected };
    });

    console.log('');
  }

  console.log('Terminé.');
  process.exit(0);
}

main().catch(err => {
  console.error('Échec du rattrapage :', err);
  process.exit(1);
});
