/**
 * Export complet de la base Firestore vers des fichiers JSON locaux.
 *
 * POURQUOI CE SCRIPT : les sauvegardes automatiques de Firestore exigent le
 * forfait Blaze. Tant que le projet est sur Spark, ceci est le seul filet
 * disponible — et un filet imparfait vaut infiniment mieux que pas de filet.
 *
 * SA LIMITE, à connaître : il ne s'exécute QUE quand vous le lancez. Une
 * sauvegarde d'il y a trois semaines ne rattrape pas les ventes des trois
 * dernières semaines. Dès que Kafora aura de vrais clients, il faudra passer
 * en Blaze et activer les sauvegardes planifiées côté Google Cloud.
 *
 * Usage :
 *   node scripts/export-firestore.js <chemin/serviceAccount.json> [dossier]
 *
 * Exemple :
 *   node scripts/export-firestore.js C:\clés\sa.json D:\sauvegardes-kafora
 *
 * Sans dossier précisé, l'export va dans ./backups/<date>/ — pensez alors à
 * l'exclure de Git (voir la note en fin de fichier).
 *
 * Le script ne fait que LIRE : il ne modifie ni ne supprime rien.
 */

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const fs = require('fs');
const path = require('path');

const saPath = process.argv[2];
const outRoot = process.argv[3] || path.join(process.cwd(), 'backups');

if (!saPath || !fs.existsSync(saPath)) {
  console.error('Usage : node scripts/export-firestore.js <serviceAccount.json> [dossier]');
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

const db = getFirestore();

/**
 * Convertit les types Firestore en JSON lisible et réimportable.
 * Sans ça, une date deviendrait `{"_seconds":...}` — techniquement
 * exploitable, mais illisible le jour où on ouvre le fichier en urgence.
 */
function serialize(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Timestamp) {
    return { __type: 'timestamp', value: value.toDate().toISOString() };
  }
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === 'object') {
    if (value._path && value.id) {
      return { __type: 'reference', path: value.path };
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = serialize(v);
    return out;
  }
  return value;
}

let docCount = 0;
let collCount = 0;

/** Parcourt une collection et toutes ses sous-collections, en profondeur. */
async function exportCollection(ref, targetDir) {
  const snap = await ref.get();
  if (snap.empty) return;

  collCount++;
  fs.mkdirSync(targetDir, { recursive: true });

  const docs = {};
  for (const doc of snap.docs) {
    docs[doc.id] = serialize(doc.data());
    docCount++;

    // Les sous-collections ne sont pas incluses dans les données d'un
    // document : il faut les parcourir explicitement, sinon on exporterait
    // les entreprises sans leurs ventes, leur stock ni leurs utilisateurs.
    const subs = await doc.ref.listCollections();
    for (const sub of subs) {
      await exportCollection(sub, path.join(targetDir, doc.id, sub.id));
    }
  }

  fs.writeFileSync(
    path.join(targetDir, '_documents.json'),
    JSON.stringify(docs, null, 2),
    'utf8'
  );
}

async function main() {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const outDir = path.join(outRoot, stamp);

  console.log(`Export vers ${outDir}\n`);

  const roots = await db.listCollections();
  if (roots.length === 0) {
    console.log('Base vide — rien à exporter.');
    process.exit(0);
  }

  for (const coll of roots) {
    process.stdout.write(`  ${coll.id}… `);
    const before = docCount;
    await exportCollection(coll, path.join(outDir, coll.id));
    console.log(`${docCount - before} document(s)`);
  }

  fs.writeFileSync(
    path.join(outDir, '_export.json'),
    JSON.stringify(
      {
        projectId: sa.project_id,
        exportedAt: new Date().toISOString(),
        documentCount: docCount,
        collectionCount: collCount,
      },
      null,
      2
    ),
    'utf8'
  );

  console.log(`\nTerminé : ${docCount} document(s), ${collCount} collection(s).`);
  console.log(
    '\nRAPPEL : cet export contient les données commerciales de vos clients\n' +
    "(ventes, marges, coordonnées). Conservez-le en lieu sûr, jamais dans le\n" +
    'dépôt Git, et de préférence sur un disque ou un stockage chiffré.'
  );
  process.exit(0);
}

main().catch(err => {
  console.error('Échec de l\'export :', err.message || err);
  process.exit(1);
});
