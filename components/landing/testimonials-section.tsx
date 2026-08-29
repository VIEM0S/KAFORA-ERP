import { Star } from 'lucide-react';

export interface Testimonial {
  quote: string;
  name: string;
  role: string;
  company: string;
}

// Vide pour l'instant : Kafora n'a pas encore de vrai client en
// production (base de données remise à zéro, confirmé lors de l'audit
// du 2026-08-28). Ne JAMAIS remplir ce tableau avec des témoignages
// inventés — dès le premier retour réel d'un commerçant, ajouter un
// objet ici (voir Testimonial ci-dessus) et la section apparaît
// automatiquement sur la landing page (voir app/page.tsx, qui ne
// l'affiche que si ce tableau n'est pas vide).
export const TESTIMONIALS: Testimonial[] = [];

export function TestimonialsSection({ testimonials }: { testimonials: Testimonial[] }) {
  if (testimonials.length === 0) return null;

  return (
    <section id="testimonials" className="py-20 bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
            Ils utilisent Kafora au quotidien
          </h2>
          <p className="text-xl text-gray-500 max-w-2xl mx-auto">
            Des commerçants qui nous font confiance pour gérer leur activité
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {testimonials.map((t) => (
            <div
              key={t.name}
              className="p-6 rounded-2xl bg-white border border-gray-100 hover:shadow-lg transition-all"
            >
              <div className="flex gap-1 mb-4" aria-hidden="true">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} className="h-4 w-4 fill-amber-400 text-amber-400" />
                ))}
              </div>
              <p className="text-gray-700 mb-6">&ldquo;{t.quote}&rdquo;</p>
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-primary-100 flex items-center justify-center text-primary-700 font-semibold">
                  {t.name.charAt(0)}
                </div>
                <div>
                  <p className="font-semibold text-gray-900">{t.name}</p>
                  <p className="text-sm text-gray-500">{t.role}, {t.company}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
