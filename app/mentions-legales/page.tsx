'use client';

import { LandingLayout } from '@/components/landing/landing-layout';

/**
 * Mentions légales.
 *
 * Rédigé pour être directement exploitable. Deux points restent à vérifier
 * avant publication : l'adresse du siège et le NIF (repères [À VÉRIFIER]).
 * Tout le reste décrit l'infrastructure réellement utilisée et doit être
 * maintenu à jour si elle change.
 */
export default function MentionsLegalesPage() {
  return (
    <LandingLayout>
      <div className="max-w-3xl mx-auto px-4 py-16">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Mentions légales</h1>
        <p className="text-sm text-gray-500 mb-10">En vigueur au 1er août 2026</p>

        <div className="space-y-8 text-gray-700 leading-relaxed">
          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">Éditeur</h2>
            <p>
              Le service Kafora est édité par <strong>ABC STUDY</strong>,
              entreprise individuelle immatriculée au Registre du Commerce et du
              Crédit Mobilier sous le numéro <strong>MA.SIK.2026.A.0048</strong>,
              exerçant une activité de commerce général et de services.
            </p>
            <p className="mt-2">Siège : [ADRESSE À VÉRIFIER], Bamako, Mali.</p>
            <p className="mt-2">Numéro d&apos;identification fiscale : [NIF À VÉRIFIER].</p>
            <p className="mt-2">
              Directeur de la publication : Mohamed Solomani Doumbia, gérant.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">Nous joindre</h2>
            <p>
              Téléphone :{' '}
              <a href="tel:+22375992482" className="text-primary-600 hover:underline">
                +223 75 99 24 82
              </a>
              <br />
              Courriel :{' '}
              <a href="mailto:kaforaerp@gmail.com" className="text-primary-600 hover:underline">
                kaforaerp@gmail.com
              </a>
            </p>
            <p className="mt-2 text-sm text-gray-500">
              Les demandes relatives aux données personnelles sont traitées à
              cette même adresse (voir la politique de confidentialité).
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">
              Hébergement et localisation des données
            </h2>
            <p>
              L&apos;application est distribuée par <strong>Netlify, Inc.</strong>,
              512 2nd Street, San Francisco, Californie, États-Unis.
            </p>
            <p className="mt-2">
              Les données des entreprises clientes sont stockées sur
              l&apos;infrastructure <strong>Google Cloud Platform</strong>, région{' '}
              <strong>europe-west1</strong> (Saint-Ghislain, Belgique).
            </p>
            <p className="mt-2 text-sm text-gray-500">
              Cette information engage l&apos;éditeur sur le lieu de stockage : toute
              migration d&apos;infrastructure impose de mettre cette page à jour et
              d&apos;en informer les clients.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">Propriété intellectuelle</h2>
            <p>
              Le logiciel Kafora, sa dénomination, son interface, ses éléments
              graphiques et sa documentation demeurent la propriété exclusive de
              l&apos;éditeur. L&apos;abonnement confère un droit d&apos;usage personnel et non
              exclusif, limité à sa durée. Il n&apos;emporte aucune cession de droits.
            </p>
            <p className="mt-2">
              Sont notamment interdits, sauf autorisation écrite : la reproduction
              du logiciel, sa décompilation, sa revente, sa mise à disposition de
              tiers, ainsi que l&apos;usage de la marque Kafora.
            </p>
            <p className="mt-2">
              <strong>
                Les données saisies par chaque entreprise cliente — produits,
                ventes, stocks, fichier clients, historique de caisse — restent sa
                propriété pleine et entière.
              </strong>{' '}
              L&apos;éditeur n&apos;en acquiert aucun droit d&apos;exploitation.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">Responsabilité éditoriale</h2>
            <p>
              Les informations publiées sur le site de présentation (tarifs,
              fonctionnalités) sont indicatives et peuvent évoluer. Seules les
              conditions en vigueur au jour de la souscription sont opposables au
              client.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">Droit applicable</h2>
            <p>
              Les présentes mentions sont régies par le droit malien et, pour ce
              qui relève du droit des affaires, par les Actes uniformes de l&apos;OHADA.
              Les modalités de règlement des différends figurent dans les
              conditions générales.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">Autres documents</h2>
            <p>
              <a href="/cgv" className="text-primary-600 hover:underline">
                Conditions générales
              </a>
              {' · '}
              <a href="/confidentialite" className="text-primary-600 hover:underline">
                Politique de confidentialité
              </a>
            </p>
          </section>
        </div>
      </div>
    </LandingLayout>
  );
}
