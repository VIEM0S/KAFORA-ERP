'use client';

import { LandingLayout } from '@/components/landing/landing-layout';

/**
 * Conditions générales de vente et d'utilisation.
 *
 * Les clauses de fonctionnement décrivent EXACTEMENT ce que fait le logiciel
 * aujourd'hui : essai de 14 jours, lecture seule à l'échéance, tolérance de
 * 7 jours au point de vente, suspension motivée et journalisée, non-accès de
 * l'éditeur aux données commerciales. Si le produit change, ce document doit
 * changer avec lui — promettre autre chose que ce que fait le code est la
 * meilleure façon de perdre un litige.
 *
 * Les choix commerciaux (durée d'engagement, remboursement, conservation
 * après résiliation, disponibilité) ont été tranchés dans le sens le plus
 * défendable pour une jeune structure : engagements mesurés, rien qui ne
 * puisse être tenu. Ils restent modifiables.
 */
export default function CGVPage() {
  return (
    <LandingLayout>
      <div className="max-w-3xl mx-auto px-4 py-16">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          Conditions générales de vente et d&apos;utilisation
        </h1>
        <p className="text-sm text-gray-500 mb-10">En vigueur au 1er août 2026</p>

        <div className="space-y-8 text-gray-700 leading-relaxed">
          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">1. Objet et acceptation</h2>
            <p>
              Kafora est un logiciel de gestion commerciale accessible en ligne :
              point de vente, gestion des stocks et des ventes, crédit client,
              multi-magasins, facturation et rapports. Il est proposé sous forme
              d&apos;abonnement aux entreprises et commerçants.
            </p>
            <p className="mt-2">
              La création d&apos;un compte vaut acceptation des présentes conditions.
              Le client déclare disposer de la capacité juridique nécessaire pour
              engager l&apos;entreprise qu&apos;il représente.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">2. Période d&apos;essai</h2>
            <p>
              Toute inscription ouvre une période d&apos;essai de{' '}
              <strong>14 jours</strong>, sans engagement, sans moyen de paiement
              requis et sans reconduction automatique en abonnement payant.
            </p>
            <p className="mt-2">
              À l&apos;issue de l&apos;essai, si aucun abonnement n&apos;est souscrit, le compte
              bascule dans les conditions de l&apos;article 5. Les données saisies
              pendant l&apos;essai sont conservées et redeviennent pleinement
              accessibles dès la souscription.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">3. Abonnement, tarifs et paiement</h2>
            <p>
              Les tarifs applicables sont ceux affichés sur le site au jour de la
              souscription, exprimés en francs CFA (XOF). L&apos;abonnement est
              mensuel, sans durée minimale d&apos;engagement : le client peut cesser
              de le renouveler à tout moment.
            </p>
            <p className="mt-2">
              Le règlement s&apos;effectue par Mobile Money, Orange Money, Wave,
              virement bancaire ou espèces. Il est constaté manuellement par
              l&apos;éditeur, qui enregistre la période couverte et en informe le
              client.
            </p>
            <p className="mt-2">
              <strong>Paiement anticipé :</strong> lorsqu&apos;un règlement intervient
              avant l&apos;échéance en cours, la nouvelle période s&apos;ajoute à celle-ci.
              Payer en avance ne fait perdre aucun jour au client.
            </p>
            <p className="mt-2">
              <strong>Modification tarifaire :</strong> toute évolution des tarifs
              est notifiée au moins 30 jours à l&apos;avance et ne s&apos;applique qu&apos;aux
              périodes postérieures. Le client qui refuse peut cesser de
              renouveler son abonnement sans pénalité.
            </p>
            <p className="mt-2">
              <strong>Remboursement :</strong> les périodes entamées ne sont pas
              remboursées au prorata. En cas d&apos;indisponibilité prolongée imputable
              à l&apos;éditeur, une prolongation gratuite d&apos;une durée équivalente est
              accordée.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">4. Comptes et utilisateurs</h2>
            <p>
              Le client crée et administre les comptes de ses collaborateurs, dans
              la limite des quotas de son forfait. Il leur attribue les rôles
              appropriés et demeure responsable des actions effectuées depuis ces
              comptes.
            </p>
            <p className="mt-2">
              Les identifiants sont strictement personnels. Le client informe
              sans délai l&apos;éditeur de toute utilisation non autorisée qu&apos;il
              constaterait.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">5. Échéance et défaut de paiement</h2>
            <p>
              À l&apos;échéance de l&apos;abonnement, le compte passe en{' '}
              <strong>lecture seule</strong> : le client conserve l&apos;accès à
              l&apos;intégralité de ses données et peut les consulter, sans pouvoir en
              créer ni en modifier.
            </p>
            <p className="mt-2">
              L&apos;encaissement au point de vente reste possible pendant{' '}
              <strong>7 jours</strong> après l&apos;échéance, afin qu&apos;aucun commerce ne
              se trouve dans l&apos;impossibilité de vendre sans préavis. Passé ce
              délai, il est suspendu jusqu&apos;au règlement.
            </p>
            <p className="mt-2">
              <strong>Aucune donnée n&apos;est supprimée du fait d&apos;un défaut de
              paiement.</strong> Le règlement rétablit l&apos;accès complet
              immédiatement.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">6. Suspension et résiliation</h2>
            <p>
              L&apos;éditeur peut suspendre l&apos;accès d&apos;une entreprise en cas d&apos;impayé
              persistant, d&apos;usage manifestement contraire aux présentes conditions
              ou à la demande du client. Toute suspension est motivée et consignée
              dans le journal d&apos;activité du compte, que le client peut consulter.
            </p>
            <p className="mt-2">
              Le client peut résilier à tout moment, sans préavis ni frais, en
              cessant de renouveler son abonnement ou en le demandant par écrit.
            </p>
            <p className="mt-2">
              L&apos;éditeur peut résilier moyennant un préavis de <strong>60 jours</strong>,
              délai destiné à permettre au client de récupérer ses données et de
              s&apos;organiser. Ce préavis ne s&apos;applique pas en cas d&apos;usage frauduleux
              ou illicite avéré.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">7. Données du client</h2>
            <p>
              Les données saisies par le client lui appartiennent. L&apos;éditeur les
              héberge et les traite pour les seuls besoins du service.
            </p>
            <p className="mt-2">
              <strong>Accès de l&apos;éditeur :</strong> les outils d&apos;administration ne
              donnent accès qu&apos;aux informations de compte — raison sociale,
              forfait, nombre d&apos;utilisateurs et de magasins, état de
              l&apos;abonnement. Ils <strong>n&apos;exposent ni les ventes, ni les marges,
              ni le fichier clients</strong>. Toute consultation effectuée à des
              fins de support est enregistrée dans le journal d&apos;activité du
              client.
            </p>
            <p className="mt-2">
              <strong>Récupération :</strong> le client peut demander à tout
              moment une copie de ses données, remise sous format exploitable
              (CSV ou JSON) dans un délai de 15 jours ouvrés.
            </p>
            <p className="mt-2">
              <strong>Après résiliation :</strong> les données sont conservées{' '}
              <strong>90 jours</strong>, période pendant laquelle le client peut
              encore en demander une copie ou réactiver son compte. Elles sont
              ensuite supprimées définitivement.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">8. Disponibilité, maintenance et sauvegardes</h2>
            <p>
              L&apos;éditeur met en œuvre les moyens raisonnables pour assurer la
              disponibilité du service, sans garantie d&apos;un fonctionnement
              ininterrompu. Le service dépend d&apos;infrastructures tierces et de la
              connexion internet du client.
            </p>
            <p className="mt-2">
              Les interventions de maintenance programmées sont annoncées à
              l&apos;avance et planifiées, autant que possible, en dehors des heures
              d&apos;ouverture des commerces.
            </p>
            <p className="mt-2">
              <strong>Sauvegardes :</strong> l&apos;éditeur procède à des sauvegardes
              régulières des données. Elles visent à faire face à un incident
              technique et ne constituent pas un service d&apos;archivage : il
              appartient au client de conserver ses propres exports, notamment à
              des fins comptables.
            </p>
            <p className="mt-2">
              <strong>Mode hors connexion :</strong> le point de vente continue de
              fonctionner sans réseau et synchronise les ventes au rétablissement
              de la connexion. Le client veille à ce que la synchronisation
              aboutisse avant de fermer l&apos;application.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">9. Obligations du client</h2>
            <p>
              Le client est responsable de l&apos;exactitude des données qu&apos;il saisit et
              du respect de ses obligations comptables, fiscales et sociales.
            </p>
            <p className="mt-2">
              <strong>
                Kafora est un outil de gestion : il n&apos;exonère l&apos;entreprise
                d&apos;aucune obligation légale, notamment en matière de tenue de
                comptabilité et de conservation des pièces justificatives.
              </strong>{' '}
              Les documents produits par le logiciel ne se substituent pas à
              l&apos;appréciation d&apos;un comptable ou d&apos;un conseil.
            </p>
            <p className="mt-2">
              Le client s&apos;interdit toute utilisation illicite du service, toute
              tentative d&apos;accès aux données d&apos;une autre entreprise, ainsi que
              toute action visant à contourner les limites de son forfait.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">10. Responsabilité</h2>
            <p>
              L&apos;éditeur répond des dommages directs résultant d&apos;un manquement qui
              lui serait imputable. Sa responsabilité est plafonnée aux sommes
              effectivement versées par le client au titre des{' '}
              <strong>12 derniers mois</strong> d&apos;abonnement.
            </p>
            <p className="mt-2">
              Sont exclus les dommages indirects, notamment la perte de chiffre
              d&apos;affaires, de clientèle ou d&apos;image, ainsi que les conséquences
              d&apos;une saisie erronée par le client, d&apos;une défaillance de sa
              connexion ou de son matériel.
            </p>
            <p className="mt-2 text-sm text-gray-500">
              Ces limitations ne s&apos;appliquent pas en cas de faute lourde ou
              intentionnelle.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">11. Évolution du service et des conditions</h2>
            <p>
              L&apos;éditeur peut faire évoluer les fonctionnalités du service. Aucune
              fonctionnalité substantielle n&apos;est retirée sans information
              préalable du client dans un délai de 30 jours.
            </p>
            <p className="mt-2">
              Toute modification des présentes conditions est notifiée 30 jours
              avant son entrée en vigueur. Le client qui la refuse peut résilier
              sans frais.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">12. Droit applicable et différends</h2>
            <p>
              Les présentes conditions sont régies par le droit malien et, pour ce
              qui relève du droit des affaires, par les Actes uniformes de l&apos;OHADA.
            </p>
            <p className="mt-2">
              En cas de différend, les parties s&apos;efforcent d&apos;abord de trouver une
              solution amiable. À défaut d&apos;accord dans un délai de 30 jours, le
              litige relève des juridictions compétentes de Bamako.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">Autres documents</h2>
            <p>
              <a href="/mentions-legales" className="text-primary-600 hover:underline">
                Mentions légales
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
