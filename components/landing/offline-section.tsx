import { WifiOff, RefreshCw } from 'lucide-react';

// Section volontairement scopée au POS, pas à "toute l'application" — c'est
// exactement ce que fait lib/offline-queue.ts : les ventes continuent d'être
// enregistrées localement pendant une coupure, puis synchronisées vers
// /api/pos/checkout au retour de la connexion. Même promesse que le CGV
// (art. 8, "Mode hors connexion") : le texte ne doit pas en dire plus que
// le code ne fait, ni ici ni là-bas.
export function OfflineSection() {
  return (
    <section className="py-16 bg-primary-50 border-y border-primary-100">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row items-center gap-8 text-center md:text-left">
          <div className="h-16 w-16 rounded-2xl bg-white flex items-center justify-center flex-shrink-0 shadow-sm">
            <WifiOff className="h-8 w-8 text-primary-600" />
          </div>
          <div className="flex-1">
            <h2 className="text-2xl md:text-3xl font-bold text-gray-900 mb-2">
              Même sans connexion, votre caisse continue
            </h2>
            <p className="text-gray-600">
              Une coupure Internet n&apos;arrête pas vos ventes. Le point de vente
              Kafora continue d&apos;encaisser normalement, et synchronise
              automatiquement chaque vente dès que la connexion revient.
            </p>
          </div>
          <div className="hidden md:flex flex-col items-center gap-1 flex-shrink-0 text-primary-600">
            <RefreshCw className="h-6 w-6" />
            <span className="text-xs text-gray-500 whitespace-nowrap">Sync auto</span>
          </div>
        </div>
      </div>
    </section>
  );
}
