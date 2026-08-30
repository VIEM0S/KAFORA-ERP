'use client';

import { Settings, Users, FileSpreadsheet, DollarSign, GraduationCap, LifeBuoy } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Pas de prix affiché ici : aucun tarif défini pour cette prestation
// aujourd'hui. Décrire ce qui est possible, renvoyer vers le contact pour en
// discuter — pas inventer un montant.
const ITEMS = [
  { icon: Settings, label: 'Configuration de votre entreprise et de vos boutiques' },
  { icon: Users, label: 'Création des utilisateurs et des rôles' },
  { icon: FileSpreadsheet, label: 'Importation de vos produits depuis Excel' },
  { icon: DollarSign, label: 'Configuration des caisses' },
  { icon: GraduationCap, label: 'Formation de votre équipe' },
  { icon: LifeBuoy, label: 'Accompagnement au démarrage' },
];

export function SetupServiceSection() {
  return (
    <section className="py-20 bg-white">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-gray-200 p-8 md:p-12">
          <div className="text-center mb-10">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              Mise en place Kafora
            </h2>
            <p className="text-xl text-gray-500 max-w-2xl mx-auto">
              Pour bien démarrer, on peut vous accompagner sur la configuration
              complète de votre entreprise.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 gap-4 mb-10">
            {ITEMS.map((item) => (
              <div key={item.label} className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-primary-100 flex items-center justify-center flex-shrink-0">
                  <item.icon className="h-4 w-4 text-primary-600" />
                </div>
                <span className="text-gray-700">{item.label}</span>
              </div>
            ))}
          </div>

          <div className="text-center">
            <p className="text-sm text-gray-400 mb-4">
              Prestation distincte de l&apos;abonnement, à discuter selon vos besoins.
            </p>
            <Button
              variant="outline"
              onClick={() => document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth' })}
            >
              En discuter avec nous
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
