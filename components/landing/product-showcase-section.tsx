import Image from 'next/image';

// Captures réelles de l'application (tenant de démonstration TRIVIA) — pas
// de maquette. Noms de clients/fournisseurs et montants sont des données de
// test créées pour cette démonstration, pas de vrais clients Kafora.
const SCREENSHOTS = [
  {
    src: '/screenshots/dashboard.png',
    title: 'Tableau de bord',
    description: "Chiffre d'affaires, stock, crédits et ventes récentes en un coup d'œil.",
  },
  {
    src: '/screenshots/pos.png',
    title: 'Point de vente',
    description: 'Une caisse pensée pour aller vite : produits en un clic, panier clair.',
  },
  {
    src: '/screenshots/inventaire.png',
    title: 'Gestion des stocks',
    description: 'Chaque produit, sa quantité et sa valeur, avec les seuils d\'alerte.',
  },
  {
    src: '/screenshots/credits.png',
    title: 'Suivi des crédits clients',
    description: 'Qui doit combien, depuis quand, et à quelle échéance.',
  },
];

export function ProductShowcaseSection() {
  return (
    <section className="py-20 bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
            Découvrez Kafora en action
          </h2>
          <p className="text-xl text-gray-500 max-w-2xl mx-auto">
            De vraies captures de l&apos;application, pas une maquette.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          {SCREENSHOTS.map((s) => (
            <div
              key={s.title}
              className="rounded-2xl overflow-hidden border border-gray-200 bg-white hover:shadow-lg transition-shadow"
            >
              <div className="relative aspect-[16/10] bg-gray-100 border-b border-gray-100">
                <Image
                  src={s.src}
                  alt={s.title}
                  fill
                  className="object-cover object-top"
                  sizes="(max-width: 768px) 100vw, 50vw"
                />
              </div>
              <div className="p-5">
                <h3 className="font-semibold text-gray-900 mb-1">{s.title}</h3>
                <p className="text-sm text-gray-500">{s.description}</p>
              </div>
            </div>
          ))}
        </div>

        <p className="text-center text-xs text-gray-400 mt-8">
          Captures réalisées sur un compte de démonstration — les noms et montants sont fictifs.
        </p>
      </div>
    </section>
  );
}
