import { Store, Building2, Warehouse, Truck, MapPin, Network } from 'lucide-react';

// Volontairement générique : chaque description reste ancrée dans des
// fonctionnalités réelles (stock, crédits, transferts, comparaison entre
// magasins, permissions par rôle) plutôt que d'inventer des besoins
// spécifiques à chaque secteur qu'on ne peut pas encore servir précisément.
const AUDIENCES = [
  {
    icon: Store,
    title: 'Commerces & boutiques',
    description: 'Gérez votre caisse, votre stock et vos ventes au quotidien.',
  },
  {
    icon: Building2,
    title: 'PME',
    description: 'Centralisez ventes, stocks et équipe dans un seul outil.',
  },
  {
    icon: Warehouse,
    title: 'Grossistes',
    description: 'Suivez de gros volumes de stock et les ventes à crédit.',
  },
  {
    icon: Truck,
    title: 'Distributeurs',
    description: 'Coordonnez vos points de vente et vos transferts de stock.',
  },
  {
    icon: MapPin,
    title: 'Entreprises multi-boutiques',
    description: 'Suivez chaque boutique et comparez leurs performances.',
  },
  {
    icon: Network,
    title: 'Siège & points de vente',
    description: 'Vue consolidée au siège, accès limités en boutique.',
  },
];

export function WhoItsForSection() {
  return (
    <section className="py-20 bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
            Pour qui est Kafora ?
          </h2>
          <p className="text-xl text-gray-500 max-w-2xl mx-auto">
            D&apos;une boutique unique à une entreprise avec plusieurs points de
            vente, Kafora grandit avec vous.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
          {AUDIENCES.map((a) => (
            <div
              key={a.title}
              className="p-5 rounded-2xl bg-white border border-gray-100 hover:border-gray-200 hover:shadow-md transition-all"
            >
              <div className="h-10 w-10 rounded-xl bg-primary-100 flex items-center justify-center mb-3">
                <a.icon className="h-5 w-5 text-primary-600" />
              </div>
              <h3 className="font-semibold text-gray-900 mb-1">{a.title}</h3>
              <p className="text-sm text-gray-500">{a.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
