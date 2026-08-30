import { Lock, ShieldCheck, KeyRound, ScrollText } from 'lucide-react';

// Chaque point est vérifié contre le code réel (audit landing du
// 2026-08-29) : isolation par tenant via Row Level Security (39 tables,
// 61 politiques), rôles/permissions appliqués côté serveur (pas seulement
// masqués côté écran), authentification Supabase Auth, journalisation des
// actions sensibles (lib/supabase/audit-log.ts). Volontairement absent :
// sauvegardes/reprise après incident — non vérifiées, donc non affirmées.
const POINTS = [
  {
    icon: Lock,
    title: 'Données isolées par entreprise',
    description:
      "Chaque entreprise n'accède qu'à ses propres données, imposé au niveau de la base de données, pas seulement de l'affichage.",
  },
  {
    icon: ShieldCheck,
    title: 'Rôles et permissions',
    description:
      'Caissier, manager, propriétaire... chaque rôle a des droits précis, vérifiés côté serveur à chaque action.',
  },
  {
    icon: KeyRound,
    title: 'Authentification sécurisée',
    description: 'Connexion par email et mot de passe, avec une longueur minimale imposée.',
  },
  {
    icon: ScrollText,
    title: 'Actions sensibles journalisées',
    description:
      'Connexions, changements de rôle, annulations de vente : les actions sensibles sont enregistrées.',
  },
];

export function SecuritySection() {
  return (
    <section className="py-20 bg-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
            Sécurité et confidentialité
          </h2>
          <p className="text-xl text-gray-500 max-w-2xl mx-auto">
            Vos données d&apos;entreprise vous appartiennent, et restent
            cloisonnées des autres clients Kafora.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {POINTS.map((p) => (
            <div key={p.title} className="text-center">
              <div className="h-12 w-12 rounded-xl bg-primary-100 flex items-center justify-center mb-4 mx-auto">
                <p.icon className="h-6 w-6 text-primary-600" />
              </div>
              <h3 className="font-semibold text-gray-900 mb-2">{p.title}</h3>
              <p className="text-sm text-gray-500">{p.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
