'use client';

import { LandingLayout } from '@/components/landing/landing-layout';

/**
 * Politique de confidentialité.
 *
 * Décrit ce que le logiciel fait RÉELLEMENT : les catégories de données
 * listées correspondent aux collections effectivement stockées, et les
 * engagements d'accès correspondent aux limites codées dans les routes
 * d'administration. Toute évolution du produit doit se refléter ici.
 *
 * Distinction importante maintenue tout au long du texte : Kafora est
 * RESPONSABLE du traitement des données de ses clients (les commerçants),
 * mais simple SOUS-TRAITANT pour les données que ceux-ci saisissent sur
 * LEURS propres clients finaux. Confondre les deux est l'erreur la plus
 * courante — et celle qui expose le plus.
 */
export default function ConfidentialitePage() {
  return (
    <LandingLayout>
      <div className="max-w-3xl mx-auto px-4 py-16">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Politique de confidentialité</h1>
        <p className="text-sm text-gray-500 mb-10">En vigueur au 1er août 2026</p>

        <div className="space-y-8 text-gray-700 leading-relaxed">
          <section>
            <div className="rounded-lg border border-primary-200 bg-primary-50 p-4 text-sm">
              <p className="font-semibold text-gray-900 mb-1">Deux rôles distincts</p>
              <p>
                Kafora est <strong>responsable</strong> des données concernant ses
                entreprises clientes et leurs utilisateurs. En revanche, pour les
                données que ces entreprises saisissent sur{' '}
                <strong>leurs propres clients</strong> (nom, téléphone, crédit
                accordé), Kafora n&apos;agit que comme <strong>sous-traitant</strong> :
                c&apos;est le commerçant qui décide de ce qu&apos;il collecte et pourquoi.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">1. Données que nous traitons</h2>
            <p className="font-medium text-gray-900 mt-3">Données de compte</p>
            <p>
              Raison sociale, adresse, RCCM, NIF, coordonnées de contact ; nom,
              prénom, adresse électronique, téléphone et rôle des utilisateurs ;
              dates de connexion.
            </p>

            <p className="font-medium text-gray-900 mt-3">Données d&apos;abonnement</p>
            <p>
              Forfait souscrit, échéances, historique des règlements enregistrés,
              moyen de paiement déclaré. Aucune coordonnée bancaire ni numéro de
              carte n&apos;est collecté ni stocké : les règlements s&apos;effectuent en
              dehors de l&apos;application.
            </p>

            <p className="font-medium text-gray-900 mt-3">Données d&apos;exploitation saisies par le client</p>
            <p>
              Produits, stocks, ventes, factures, mouvements de caisse, et
              informations sur ses clients finaux (nom, téléphone, encours de
              crédit). Ces données appartiennent à l&apos;entreprise cliente.
            </p>

            <p className="font-medium text-gray-900 mt-3">Journaux techniques</p>
            <p>
              Traces de connexion, actions sensibles (suspension de compte, accès
              support), erreurs applicatives. Ils servent à la sécurité et au
              diagnostic.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">2. Pourquoi nous les traitons</h2>
            <p>
              Fournir le service souscrit ; authentifier les utilisateurs et
              cloisonner les accès ; facturer et suivre les abonnements ; assurer
              le support ; détecter et corriger les incidents ; respecter nos
              obligations légales et comptables.
            </p>
            <p className="mt-2">
              <strong>
                Nous n&apos;exploitons ni ne revendons les données commerciales de nos
                clients à des fins publicitaires, statistiques ou commerciales,
                sous quelque forme que ce soit.
              </strong>
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">3. Accès du support</h2>
            <p>
              Les outils d&apos;administration de Kafora sont volontairement limités
              aux informations de compte : raison sociale, forfait, nombre
              d&apos;utilisateurs et de magasins, volume d&apos;activité, état de
              l&apos;abonnement.
            </p>
            <p className="mt-2">
              <strong>
                Ils n&apos;exposent ni le détail des ventes, ni les marges, ni le
                fichier des clients finaux.
              </strong>{' '}
              Chaque consultation d&apos;un compte à des fins de support est
              enregistrée dans le journal d&apos;activité de l&apos;entreprise concernée,
              qui peut la constater à tout moment.
            </p>
            <p className="mt-2">
              Une intervention nécessitant un accès plus étendu ne peut avoir lieu
              qu&apos;à la demande explicite du client et pour la durée strictement
              nécessaire.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">4. Cloisonnement entre entreprises</h2>
            <p>
              Chaque entreprise cliente dispose d&apos;un espace de données isolé.
              L&apos;isolation repose sur des règles de sécurité appliquées côté
              serveur et sur des jetons d&apos;authentification non modifiables par
              l&apos;utilisateur.
            </p>
            <p className="mt-2">
              À l&apos;intérieur d&apos;une même entreprise, les accès peuvent être
              restreints magasin par magasin : un employé affecté à une boutique
              ne consulte ni le stock, ni les ventes, ni la caisse des autres.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">5. Hébergement et transferts</h2>
            <p>
              Les données sont stockées sur Google Cloud Platform, région
              europe-west1 (Belgique). L&apos;application est distribuée par Netlify,
              société de droit américain.
            </p>
            <p className="mt-2">
              Les courriels transactionnels (réinitialisation de mot de passe,
              messages de contact) transitent par SendGrid.
            </p>
            <p className="mt-2 text-sm text-gray-500">
              Ces prestataires n&apos;ont pas d&apos;autre usage autorisé des données que
              l&apos;exécution du service qui leur est confié.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">6. Durées de conservation</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>Données d&apos;exploitation : pendant toute la durée du contrat.</li>
              <li>
                Après résiliation : <strong>90 jours</strong>, pour permettre une
                récupération ou une réactivation, puis suppression définitive.
              </li>
              <li>
                Pièces comptables relatives aux abonnements : conservées selon les
                durées légales applicables à l&apos;éditeur.
              </li>
              <li>Journaux techniques : 12 mois.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">7. Sécurité</h2>
            <p>
              Chiffrement des échanges (HTTPS) et des données au repos ;
              authentification par jeton à durée limitée ; cloisonnement des accès
              par entreprise et par magasin ; journalisation des actions
              sensibles ; limitation des tentatives de connexion et d&apos;inscription.
            </p>
            <p className="mt-2">
              Aucun dispositif n&apos;offre une sécurité absolue. En cas d&apos;incident
              affectant des données, les clients concernés sont informés dans les
              meilleurs délais, avec la nature de l&apos;incident et les mesures prises.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">8. Vos droits</h2>
            <p>
              Toute personne concernée peut demander l&apos;accès à ses données, leur
              rectification, leur suppression, ou s&apos;opposer à leur traitement.
            </p>
            <p className="mt-2">
              Les employés d&apos;une entreprise cliente s&apos;adressent d&apos;abord à leur
              employeur, qui administre leurs comptes. Les clients finaux d&apos;un
              commerce s&apos;adressent à ce commerce, qui décide seul des informations
              qu&apos;il conserve à leur sujet.
            </p>
            <p className="mt-2">
              Pour toute demande relevant de notre responsabilité :{' '}
              <a href="mailto:kaforaerp@gmail.com" className="text-primary-600 hover:underline">
                kaforaerp@gmail.com
              </a>
              . Nous répondons sous 30 jours.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">9. Cookies et traceurs</h2>
            <p>
              L&apos;application n&apos;utilise que les cookies strictement nécessaires à
              son fonctionnement : maintien de la session authentifiée et
              préférences d&apos;affichage. Aucun traceur publicitaire ni outil de
              profilage tiers n&apos;est déposé.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">10. Modifications</h2>
            <p>
              Toute évolution substantielle de la présente politique est notifiée
              aux clients 30 jours avant son entrée en vigueur.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">Autres documents</h2>
            <p>
              <a href="/mentions-legales" className="text-primary-600 hover:underline">
                Mentions légales
              </a>
              {' · '}
              <a href="/cgv" className="text-primary-600 hover:underline">
                Conditions générales
              </a>
            </p>
          </section>
        </div>
      </div>
    </LandingLayout>
  );
}
