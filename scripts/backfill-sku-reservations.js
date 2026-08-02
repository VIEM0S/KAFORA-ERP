/**
 * Réserve les SKU des produits DÉJÀ en base, et signale les doublons existants.
 *
 * La contrainte d'unicité (voir lib/products/sku.ts et firestore.rules) ne
 * protège que ce qui passe par la réservation. Les produits créés avant sa
 * mise en place n'en ont pas : sans ce rattrapage, on pourrait créer un
 * nouveau produit reprenant le SKU d'un ancien.
 *
 * Le script est SANS RISQUE : il n'ajoute que des réservations, il ne modifie
 * ni ne supprime aucun produit. Il peut être relancé autant de fois que voulu.
 *
 * Si des doublons existent déjà, il ne tranche pas à votre place — il les
 * liste. Décider lequel garder est une décision commerciale (lequel a des
 * ventes ? du stock ?), pas quelque chose qu'un script doit deviner.
 *
 * Usage :
 *   node scripts/backfill-sku-reservations.js <chemin/serviceAccount.json>
 */

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const fs = require('fs');

const saPath = process.argv[2];
if (!saPath || !fs.existsSync(saPath)) {
  console.error('Usage : node scripts/backfill-sku-reservations.js <serviceAccount.json>');
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

/** Doit rester identique à lib/products/sku.ts — sinon les clés divergent. */
function skuKey(sku) {
  const cleaned = String(sku).trim().toUpperCase().replace(/[/\\.#$[\]]/g, '_');
  return cleaned.replace(/^__+|__+$/g, '_');
}

async function main() {
  const tenants = await db.collection('tenants').get();
  console.log(`${tenants.size} entreprise(s) à traiter\n`);

  let totalDuplicates = 0;

  for (const tenant of tenants.docs) {
    const name = tenant.data().name || tenant.id;
    const products = await db.collection(`tenants/${tenant.id}/products`).get();

    const seen = new Map(); // clé -> premier produit rencontré
    const duplicates = [];
    let batch = db.batch();
    let pending = 0;
    let reserved = 0;

    for (const doc of products.docs) {
      const sku = doc.data().sku;
      if (!sku || !String(sku).trim()) continue;

      const key = skuKey(sku);
      if (seen.has(key)) {
        duplicates.push({ sku, keep: seen.get(key), other: doc.id });
        continue; // on ne réserve pas deux fois la même clé
      }
      seen.set(key, doc.id);

      batch.set(
        db.doc(`tenants/${tenant.id}/product_skus/${key}`),
        { sku: String(sku).trim(), productId: doc.id, createdAt: new Date().toISOString() },
        { merge: true }
      );
      pending++;
      reserved++;

      if (pending >= 400) {
        await batch.commit();
        batch = db.batch();
        pending = 0;
      }
    }

    if (pending > 0) await batch.commit();

    console.log(`${name} : ${reserved} SKU réservé(s) sur ${products.size} produit(s)`);

    if (duplicates.length > 0) {
      totalDuplicates += duplicates.length;
      console.log(`  /!\\ ${duplicates.length} DOUBLON(S) détecté(s) :`);
      for (const d of duplicates) {
        console.log(`     « ${d.sku} » → produits ${d.keep} et ${d.other}`);
      }
      console.log(
        '     La réservation pointe vers le premier. Corrigez ces produits\n' +
        "     dans l'application : un même code-barres scanné peut sinon\n" +
        '     désigner le mauvais article.'
      );
    }
    console.log('');
  }

  if (totalDuplicates > 0) {
    console.log(`Terminé — ${totalDuplicates} doublon(s) à traiter manuellement.`);
  } else {
    console.log('Terminé — aucun doublon détecté.');
  }
  process.exit(0);
}

main().catch(err => {
  console.error('Échec :', err.message || err);
  process.exit(1);
});
