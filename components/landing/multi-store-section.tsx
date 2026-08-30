import { Building2, Store, ArrowDown, Check, ArrowRightLeft, Users, DollarSign } from 'lucide-react';

// Section volontairement forte visuellement (fond sombre, comme le CTA final)
// — le multi-magasins est la fonctionnalité stratégique de Kafora. Chaque
// point de la liste correspond à une fonctionnalité réellement construite :
// transferts (app/(dashboard)/transfers), caisse par magasin
// (app/(dashboard)/cash-register), permissions par rôle/magasin
// (REGIONAL_MANAGER + store_ids), comparaison au siège (analytics).
const CAPABILITIES = [
  'Plusieurs points de vente gérés depuis un seul compte',
  'Stock par boutique et transferts inter-boutiques',
  'Une caisse par boutique, ouverte et fermée séparément',
  'Permissions par rôle, et par boutique si besoin',
  'Rapports consolidés et comparaison entre boutiques au siège',
];

const BOUTIQUE_TAGS = [
  { icon: DollarSign, label: 'Caisse' },
  { icon: ArrowRightLeft, label: 'Stock' },
  { icon: Users, label: 'Équipe' },
];

export function MultiStoreSection() {
  return (
    <section className="py-20 bg-primary-900">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
            Une seule entreprise. Plusieurs boutiques. Un seul contrôle.
          </h2>
          <p className="text-xl text-primary-200 max-w-2xl mx-auto">
            Depuis le siège, gardez une vue d&apos;ensemble sur toutes vos
            boutiques. Sur le terrain, chaque équipe garde des accès limités à
            ce qui la concerne.
          </p>
        </div>

        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Diagramme hiérarchique simple : Siège → Boutiques */}
          <div>
            <div className="mx-auto w-fit rounded-xl bg-white/10 border border-white/20 px-6 py-3 flex items-center gap-2">
              <Building2 className="h-5 w-5 text-white" />
              <div className="text-left">
                <p className="text-sm font-semibold text-white leading-tight">Siège</p>
                <p className="text-xs text-primary-300 leading-tight">Vue consolidée</p>
              </div>
            </div>
            <div className="flex justify-center py-2">
              <ArrowDown className="h-5 w-5 text-white/40" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[1, 2, 3].map((n) => (
                <div
                  key={n}
                  className="rounded-xl bg-white/5 border border-white/10 p-3 text-center"
                >
                  <Store className="h-4 w-4 text-primary-300 mx-auto mb-1" />
                  <p className="text-xs font-medium text-white mb-2">Boutique {n}</p>
                  <div className="flex justify-center gap-1.5">
                    {BOUTIQUE_TAGS.map((t) => (
                      <span key={t.label} title={t.label}>
                        <t.icon className="h-3 w-3 text-primary-400" />
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Capacités */}
          <ul className="space-y-4">
            {CAPABILITIES.map((c) => (
              <li key={c} className="flex items-start gap-3">
                <div className="h-6 w-6 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Check className="h-3.5 w-3.5 text-white" />
                </div>
                <span className="text-primary-100">{c}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
