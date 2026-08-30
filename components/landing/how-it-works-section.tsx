import { Building2, Store, ShoppingCart, LayoutDashboard } from 'lucide-react';

const STEPS = [
  {
    icon: Building2,
    title: 'Créez votre entreprise',
    description: "Renseignez votre entreprise et choisissez votre forfait.",
  },
  {
    icon: Store,
    title: 'Ajoutez vos boutiques et utilisateurs',
    description: 'Un ou plusieurs magasins, chacun avec son équipe et ses rôles.',
  },
  {
    icon: ShoppingCart,
    title: 'Gérez vos ventes et vos stocks',
    description: 'Encaissez, suivez le stock, gérez les crédits clients.',
  },
  {
    icon: LayoutDashboard,
    title: 'Pilotez votre activité',
    description: 'Depuis votre dashboard, avec une vue par boutique ou consolidée.',
  },
];

export function HowItWorksSection() {
  return (
    <section className="py-20 bg-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
            Comment ça marche ?
          </h2>
          <p className="text-xl text-gray-500 max-w-2xl mx-auto">
            Quatre étapes pour démarrer.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {STEPS.map((step, i) => (
            <div key={step.title} className="text-center">
              <div className="relative mx-auto mb-4 h-14 w-14">
                <div className="h-14 w-14 rounded-2xl bg-primary-600 flex items-center justify-center">
                  <step.icon className="h-6 w-6 text-white" />
                </div>
                <span className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-primary-100 text-primary-700 text-xs font-bold flex items-center justify-center">
                  {i + 1}
                </span>
              </div>
              <h3 className="font-semibold text-gray-900 mb-1">{step.title}</h3>
              <p className="text-sm text-gray-500">{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
