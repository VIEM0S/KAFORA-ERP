import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

// Chaque réponse correspond exactement à ce qui existe dans le produit
// aujourd'hui — voir l'audit landing du 2026-08-29. Ne pas ajouter de
// question dont la réponse promettrait une fonctionnalité non construite.
const FAQ_ITEMS: { question: string; answer: string }[] = [
  {
    question: 'Kafora est-il adapté aux petites entreprises ?',
    answer:
      "Oui. Le forfait Starter est pensé pour une boutique unique : caisse, stock et suivi des crédits clients, sans payer pour des fonctions dont vous n'avez pas encore besoin.",
  },
  {
    question: 'Puis-je gérer plusieurs boutiques ?',
    answer:
      'Oui, à partir du forfait Business : transferts de stock entre boutiques et comparaison de leurs performances depuis le siège.',
  },
  {
    question: 'Puis-je avoir plusieurs caisses ?',
    answer:
      'Oui, chaque boutique gère sa propre caisse : ouverture, fermeture et rapprochement en fin de journée.',
  },
  {
    question: 'Puis-je importer mon stock depuis Excel ?',
    answer:
      "Oui. Un modèle de fichier est fourni, et l'import peut se faire par fichier ou par copier-coller directement dans l'application.",
  },
  {
    question: 'Puis-je gérer les crédits clients ?',
    answer:
      'Oui : dettes en cours, paiements reçus, échéances à venir et historique complet, par client.',
  },
  {
    question: 'Puis-je gérer plusieurs utilisateurs ?',
    answer:
      "Oui, avec des rôles définis (caissier, manager, propriétaire...) selon le nombre d'utilisateurs inclus dans votre forfait.",
  },
  {
    question: 'Mes employés peuvent-ils avoir des permissions différentes ?',
    answer:
      "Oui. Chaque rôle a des droits précis, et un responsable régional peut être limité à certaines boutiques seulement.",
  },
  {
    question: 'Kafora fonctionne-t-il sur téléphone ?',
    answer:
      "Oui, Kafora est accessible depuis le navigateur de votre téléphone — aucune application à installer pour le moment.",
  },
  {
    question: 'Quels moyens de paiement sont supportés à la caisse ?',
    answer:
      'Espèces, Mobile Money (Orange Money, Moov Money, Wave), carte et vente à crédit.',
  },
  {
    question: 'Mes données sont-elles sécurisées ?',
    answer:
      "Les données de chaque entreprise sont isolées dans notre base, et l'accès est contrôlé selon le rôle de chaque utilisateur.",
  },
  {
    question: "Que se passe-t-il si Internet tombe ?",
    answer:
      "À la caisse, Kafora continue d'enregistrer les ventes hors connexion et les synchronise automatiquement dès le retour d'Internet.",
  },
  {
    question: "Comment fonctionne l'abonnement ?",
    answer:
      "Vous démarrez avec un essai gratuit de 14 jours sur le forfait choisi. Le règlement se fait ensuite directement avec notre équipe (Mobile Money, Orange Money, Wave, virement ou espèces) — aucun paiement en ligne automatique pour le moment.",
  },
  {
    question: 'Puis-je demander une démonstration ?',
    answer: 'Oui, via le formulaire de contact ci-dessous — nous revenons vers vous rapidement.',
  },
  {
    question: 'Qui répond quand je contacte le support ?',
    answer:
      "Aujourd'hui, c'est le fondateur de Kafora qui répond personnellement à chaque demande — par téléphone, WhatsApp ou email. Comptez une réponse sous 24h ouvrées (lundi-vendredi).",
  },
  {
    question: 'Que se passe-t-il si je décide d\'arrêter Kafora ?',
    answer:
      "Vos données vous appartiennent. Vous pouvez en demander une copie exploitable (CSV ou JSON) à tout moment, y compris après résiliation : elles restent disponibles 90 jours avant suppression définitive.",
  },
];

export function FaqSection() {
  return (
    <section id="faq" className="py-20 bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
            Questions fréquentes
          </h2>
          <p className="text-xl text-gray-500">
            Tout ce qu&apos;il faut savoir avant de commencer.
          </p>
        </div>

        <Accordion type="single" collapsible className="bg-white rounded-2xl border border-gray-100 px-6">
          {FAQ_ITEMS.map((item) => (
            <AccordionItem key={item.question} value={item.question}>
              <AccordionTrigger className="text-left text-gray-900 hover:no-underline">
                {item.question}
              </AccordionTrigger>
              <AccordionContent className="text-gray-500">{item.answer}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
