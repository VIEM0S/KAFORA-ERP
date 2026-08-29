'use client';

import { useRouter } from 'next/navigation';
import { ArrowRight, Check } from 'lucide-react';
import { LandingLayout } from '@/components/landing/landing-layout';
import { Button } from '@/components/ui/button';
import { getVerticalPage } from '@/lib/utils/vertical-pages';

// Prend un `slug` (chaîne, sérialisable) plutôt que l'objet VerticalPage
// complet : ce composant est 'use client', mais les fichiers
// app/solutions/*/page.tsx qui l'appellent sont des Server Components par
// défaut — leur passer directement `data.icon` (un composant Lucide, donc
// une fonction) plante avec "Functions cannot be passed directly to Client
// Components". Résolu ici, côté client, à partir du slug seul.
export function VerticalLandingPage({ slug }: { slug: string }) {
  const router = useRouter();
  const data = getVerticalPage(slug);
  if (!data) return null;
  const Icon = data.icon;

  return (
    <LandingLayout>
      {/* Hero */}
      <section className="relative py-20 lg:py-28 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary-950 via-primary-900 to-primary-800" />
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-white/10 backdrop-blur-sm mb-8">
            <Icon className="h-10 w-10 text-white" />
          </div>
          <p className="text-primary-300 font-medium mb-3">Kafora pour votre secteur</p>
          <h1 className="text-3xl md:text-5xl font-bold text-white mb-6">
            {data.headline}
          </h1>
          <p className="text-xl text-primary-200 max-w-2xl mx-auto mb-8">
            {data.painPoint}
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button
              size="lg"
              className="bg-white text-primary-900 hover:bg-gray-100 h-14 px-8 text-lg"
              onClick={() => router.push('/setup')}
            >
              Commencer gratuitement
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="bg-transparent border-white/30 text-white hover:bg-white/10 h-14 px-8 text-lg"
              onClick={() => router.push('/#pricing')}
            >
              Voir les tarifs
            </Button>
          </div>
        </div>
      </section>

      {/* Highlights */}
      <section className="py-20 bg-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-3 gap-8">
            {data.highlights.map((h) => (
              <div
                key={h.title}
                className="p-6 rounded-2xl border border-gray-100 hover:border-gray-200 hover:shadow-lg transition-all"
              >
                <div className="h-10 w-10 rounded-xl bg-primary-100 flex items-center justify-center mb-4">
                  <Check className="h-5 w-5 text-primary-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">{h.title}</h3>
                <p className="text-gray-500">{h.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-primary-900">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
            Prêt à essayer Kafora ?
          </h2>
          <p className="text-xl text-primary-200 mb-8">
            Créez votre compte en quelques minutes, sans engagement.
          </p>
          <Button
            size="lg"
            className="bg-white text-primary-900 hover:bg-gray-100 h-14 px-8 text-lg"
            onClick={() => router.push('/setup')}
          >
            Démarrer maintenant
            <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
        </div>
      </section>
    </LandingLayout>
  );
}
