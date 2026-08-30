"use client";

import { ContactSection } from "@/components/landing/contact-section";
import { LandingLayout } from "@/components/landing/landing-layout";
import { TestimonialsSection, TESTIMONIALS } from "@/components/landing/testimonials-section";
import { WhoItsForSection } from "@/components/landing/who-its-for-section";
import { ProductShowcaseSection } from "@/components/landing/product-showcase-section";
import { OfflineSection } from "@/components/landing/offline-section";
import { MultiStoreSection } from "@/components/landing/multi-store-section";
import { HowItWorksSection } from "@/components/landing/how-it-works-section";
import { SetupServiceSection } from "@/components/landing/setup-service-section";
import { SecuritySection } from "@/components/landing/security-section";
import { FaqSection } from "@/components/landing/faq-section";
import { Button } from "@/components/ui/button";
import { PLAN_DISPLAY_LIST } from "@/lib/utils/plan-display";
import {
  REFERRAL_REFERRER_BONUS_DAYS,
  REFERRAL_REFEREE_BONUS_DAYS,
} from "@/lib/constants";
import {
  ArrowRight,
  BarChart3,
  Check,
  CreditCard,
  Gift,
  Package,
  Shield,
  ShoppingCart,
  Store,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import dynamic from "next/dynamic";

// `recharts` pèse ~120 ko — chargé à la demande pour ne pas retarder le
// premier affichage de la landing page (même raisonnement que la page
// Analytics, voir components/analytics/charts.tsx). `ssr: false` car
// recharts mesure son conteneur pour se dimensionner, rien à faire côté
// serveur.
const CostComparisonChart = dynamic(
  () => import("@/components/landing/cost-comparison-chart").then((m) => m.CostComparisonChart),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-[280px] text-sm text-gray-400">
        Chargement du graphique…
      </div>
    ),
  }
);

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    const user = localStorage.getItem("erp-user");
    if (user) {
      router.push("/dashboard");
    }
  }, [router]);

  return (
    <LandingLayout>
      {/* Hero Section */}
      <section className="relative py-20 lg:py-32 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary-950 via-primary-900 to-primary-800" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-white/10 backdrop-blur-sm mb-8">
              <Store className="h-10 w-10 text-white" />
            </div>
            <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold text-white mb-6">
              Gérez toute votre entreprise
              <br className="hidden md:block" /> depuis un seul endroit.
            </h1>
            <p className="text-xl md:text-2xl text-primary-200 mb-8 max-w-3xl mx-auto">
              Kafora centralise vos ventes, stocks, caisses, clients et
              boutiques dans un ERP conçu pour les entreprises africaines.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button
                size="lg"
                className="bg-white text-primary-900 hover:bg-gray-100 h-14 px-8 text-lg"
                onClick={() => router.push("/setup")}
              >
                Commencer gratuitement
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="bg-transparent border-white/30 text-white hover:bg-white/10 h-14 px-8 text-lg"
                onClick={() =>
                  document.getElementById("contact")?.scrollIntoView({ behavior: "smooth" })
                }
              >
                Demander une démo
              </Button>
            </div>
            <p className="mt-8 text-sm text-primary-300 tracking-wide">
              Stocks · POS · Multi-boutiques · Crédits · Analytics · Paiements
            </p>
          </div>
        </div>
      </section>

      <WhoItsForSection />

      {/* Problèmes → Solutions Section (remplace l'ancienne liste de
          fonctionnalités : on part de ce que vit un dirigeant, pas d'un
          catalogue de features — voir l'audit landing du 2026-08-29). */}
      <section id="features" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              Les problèmes que Kafora résout au quotidien
            </h2>
            <p className="text-xl text-gray-500 max-w-2xl mx-auto">
              Les mêmes difficultés reviennent, que vous ayez une boutique ou
              plusieurs. Voici comment Kafora y répond.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              {
                icon: Package,
                question: "Vous perdez le contrôle de vos stocks ?",
                intro: "Kafora vous montre en temps réel :",
                points: [
                  "ce qui est vendu",
                  "ce qui reste en stock",
                  "ce qui entre et ce qui sort",
                  "quels produits sont en rupture",
                ],
              },
              {
                icon: ShoppingCart,
                question: "Votre caisse vous fait perdre du temps ?",
                intro: "Un point de vente pensé pour aller vite :",
                points: [
                  "scan code-barres",
                  "espèces, Mobile Money, carte ou crédit",
                  "facture générée automatiquement",
                ],
              },
              {
                icon: BarChart3,
                question: "Vous pilotez votre activité à l'aveugle ?",
                intro: "Kafora vous donne une vue claire de votre activité :",
                points: [
                  "chiffre d'affaires et marge par produit",
                  "évolution des ventes dans le temps",
                  "produits les plus vendus et rotation du stock",
                ],
              },
              {
                icon: Shield,
                question: "Vous ne savez pas qui fait quoi dans votre équipe ?",
                intro: "Chaque utilisateur a un rôle et des droits définis :",
                points: [
                  "caissier, manager, propriétaire",
                  "accès limité par boutique si besoin",
                  "historique des actions sensibles",
                ],
              },
              {
                icon: CreditCard,
                question: "Vos clients achètent à crédit ?",
                intro: "Suivez chaque dossier de crédit :",
                points: [
                  "dettes en cours",
                  "paiements reçus",
                  "échéances à venir",
                  "historique complet par client",
                ],
              },
              {
                icon: Store,
                question: "Vous avez plusieurs boutiques ?",
                intro: "Depuis un seul endroit, suivez :",
                points: [
                  "les ventes de chaque boutique",
                  "les stocks et les transferts entre elles",
                  "les caisses de chaque point de vente",
                ],
              },
            ].map((item) => (
              <div
                key={item.question}
                className="p-6 rounded-2xl border border-gray-100 hover:border-gray-200 hover:shadow-lg transition-all group"
              >
                <div className="h-12 w-12 rounded-xl bg-primary-100 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <item.icon className="h-6 w-6 text-primary-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  {item.question}
                </h3>
                <p className="text-sm text-gray-500 mb-3">{item.intro}</p>
                <ul className="space-y-1.5">
                  {item.points.map((point) => (
                    <li key={point} className="flex items-start gap-2 text-sm text-gray-600">
                      <Check className="h-4 w-4 text-success-500 flex-shrink-0 mt-0.5" />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      <OfflineSection />

      <MultiStoreSection />

      <HowItWorksSection />

      <ProductShowcaseSection />

      {/* Pricing Section */}
      <section id="pricing" className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              Tarifs simples et transparents
            </h2>
            <p className="text-xl text-gray-500">
              Choisissez le plan adapté à votre entreprise
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {PLAN_DISPLAY_LIST.map((plan) => (
              <div
                key={plan.name}
                className={`rounded-2xl p-8 transition-all ${
                  plan.popular
                    ? "bg-primary-600 text-white ring-4 ring-primary-600 ring-offset-4 hover:shadow-xl hover:-translate-y-1"
                    : "bg-white border border-gray-200 hover:border-gray-300 hover:shadow-lg hover:-translate-y-1"
                }`}
              >
                {plan.popular && (
                  <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-white/20 mb-4">
                    Le plus populaire
                  </span>
                )}
                <h3 className="text-2xl font-bold mb-2">{plan.name}</h3>
                <div className="mb-4">
                  <span className="text-4xl font-bold">
                    {plan.price.toLocaleString("fr-FR")}
                  </span>
                  <span
                    className={
                      plan.popular ? "text-primary-200" : "text-gray-500"
                    }
                  >
                    {" "}
                    FCFA/mois
                  </span>
                </div>
                <p
                  className={`mb-6 ${plan.popular ? "text-primary-200" : "text-gray-500"}`}
                >
                  {plan.description}
                </p>
                <ul className="space-y-3 mb-8">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-center gap-2">
                      <svg
                        className={`h-5 w-5 ${plan.popular ? "text-primary-200" : "text-success-500"}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  className={`w-full ${
                    plan.popular
                      ? "bg-white text-primary-600 hover:bg-gray-100"
                      : "bg-primary-600 text-white hover:bg-primary-700"
                  }`}
                  onClick={() => {
                    if (plan.id === "ENTERPRISE") {
                      document
                        .getElementById("contact")
                        ?.scrollIntoView({ behavior: "smooth" });
                    } else {
                      router.push("/setup");
                    }
                  }}
                >
                  {plan.cta}
                </Button>
              </div>
            ))}
          </div>

          {/* Coût cumulé réel sur 5 ans, calculé depuis les mêmes tarifs que
              ci-dessus — voir components/landing/cost-comparison-chart.tsx */}
          <div className="mt-16 max-w-4xl mx-auto bg-white rounded-2xl border border-gray-200 p-6 md:p-8">
            <h3 className="text-xl font-bold text-gray-900 mb-1 text-center">
              Coût cumulé sur 5 ans
            </h3>
            <p className="text-gray-500 text-center mb-6">
              Visualisez votre engagement financier réel, forfait par forfait
            </p>
            <CostComparisonChart />
          </div>
        </div>
      </section>

      <SetupServiceSection />

      <SecuritySection />

      <FaqSection />

      {/* Témoignages — n'affiche rien tant que TESTIMONIALS est vide, voir
          components/landing/testimonials-section.tsx */}
      <TestimonialsSection testimonials={TESTIMONIALS} />

      {/* Parrainage — volontairement discret ici : ce n'est pas un argument
          de vente pour un premier visiteur, juste une information utile
          avant le contact/CTA final. Voir l'audit landing du 2026-08-29
          (section 18 de la mission : moins central que produit/tarifs/démo). */}
      <section id="parrainage" className="py-10 bg-gray-50 border-y border-gray-100">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center gap-4 sm:gap-6">
          <div className="h-10 w-10 rounded-xl bg-pink-100 flex items-center justify-center flex-shrink-0">
            <Gift className="h-5 w-5 text-pink-600" />
          </div>
          <p className="text-sm text-gray-600 flex-1 text-center sm:text-left">
            <strong className="text-gray-900">Programme de parrainage.</strong>{" "}
            Recevez {REFERRAL_REFERRER_BONUS_DAYS} jours offerts sur votre
            abonnement quand la personne que vous parrainez effectue son
            premier paiement — elle profite immédiatement de{" "}
            {REFERRAL_REFEREE_BONUS_DAYS} jours d&apos;essai en plus. Déjà
            client ? Retrouvez votre lien dans Réglages → Parrainage.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="flex-shrink-0"
            onClick={() => router.push("/login")}
          >
            Voir mon lien
          </Button>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 bg-primary-900">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
            Prêt à reprendre le contrôle de votre entreprise ?
          </h2>
          <p className="text-xl text-primary-200 mb-8">
            Créez votre compte en quelques minutes, sans engagement.
          </p>
          <Button
            size="lg"
            className="bg-white text-primary-900 hover:bg-gray-100 h-14 px-8 text-lg"
            onClick={() => router.push("/setup")}
          >
            Commencer avec Kafora
            <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
        </div>
      </section>

      {/* Contact Section */}
      <ContactSection />

      {/* Footer */}
      <footer className="bg-gray-900 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row justify-between items-center">
            <div className="flex items-center gap-2 mb-4 md:mb-0">
              <Store className="h-6 w-6 text-white" />
              <span className="text-xl font-bold text-white">Kafora</span>
            </div>
            <div className="flex flex-col md:flex-row items-center gap-4 md:gap-6">
              <nav className="flex gap-4 text-sm">
                <a href="/mentions-legales" className="text-gray-400 hover:text-white transition-colors">
                  Mentions légales
                </a>
                <a href="/cgv" className="text-gray-400 hover:text-white transition-colors">
                  CGV
                </a>
                <a href="/confidentialite" className="text-gray-400 hover:text-white transition-colors">
                  Confidentialité
                </a>
              </nav>
              {/* Année calculée : un copyright figé finit toujours par dater
                  le site, ce qui donne l'impression d'un produit abandonné. */}
              <p className="text-gray-400">
                © {new Date().getFullYear()} Kafora. Tous droits réservés.
              </p>
            </div>
          </div>
        </div>
      </footer>
    </LandingLayout>
  );
}
