"use client";

import { ContactSection } from "@/components/landing/contact-section";
import { LandingLayout } from "@/components/landing/landing-layout";
import { Button } from "@/components/ui/button";
import { PLAN_DISPLAY_LIST } from "@/lib/utils/plan-display";
import {
  REFERRAL_REFERRER_BONUS_DAYS,
  REFERRAL_REFEREE_BONUS_DAYS,
} from "@/lib/constants";
import {
  ArrowRight,
  BarChart3,
  Gift,
  Package,
  Shield,
  ShoppingCart,
  Store,
  Zap,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

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
              Kafora
            </h1>
            <p className="text-xl md:text-2xl text-primary-200 mb-8 max-w-3xl mx-auto">
              La solution de gestion moderne pour les commerces africains.
              Inventaire, ventes, crédits, analytics - tout en un seul système.
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
                onClick={() => router.push("/login")}
              >
                Se connecter
              </Button>
            </div>
          </div>

          {/* Stats */}
          <div className="mt-20 grid grid-cols-2 md:grid-cols-4 gap-8">
            {[
              { value: "500+", label: "Entreprises" },
              { value: "50M+", label: "Transactions" },
              { value: "99.9%", label: "Disponibilité" },
              { value: "24/7", label: "Support" },
            ].map((stat) => (
              <div key={stat.label} className="text-center">
                <p className="text-3xl md:text-4xl font-bold text-white">
                  {stat.value}
                </p>
                <p className="text-primary-300">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              Tout ce dont vous avez besoin
            </h2>
            <p className="text-xl text-gray-500 max-w-2xl mx-auto">
              Une solution complète pour gérer votre entreprise du quotidien
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              {
                icon: Package,
                title: "Gestion des stocks",
                description:
                  "Suivez vos produits en temps réel, alertes automatiques de stock bas, mouvements traqués.",
              },
              {
                icon: ShoppingCart,
                title: "Point de vente rapide",
                description:
                  "Interface POS ultra-rapide, scan code-barres, paiement mobile money, factures automatiques.",
              },
              {
                icon: BarChart3,
                title: "Analytics avancés",
                description:
                  "Tableaux de bord interactifs, rapports de ventes, analysis de rentabilité par produit.",
              },
              {
                icon: Shield,
                title: "Multi-utilisateurs",
                description:
                  "Gérez les accès par rôle: caissier, manager, propriétaire. Historique complet des actions.",
              },
              {
                icon: Zap,
                title: "Gestion des crédits",
                description:
                  "Suivez les créances clients, rappels automatiques, historique des paiements.",
              },
              {
                icon: Store,
                title: "Multi-magasins",
                description:
                  "Gérez plusieurs points de vente, transferts inter-magasins, rapport consolidé.",
              },
            ].map((feature) => (
              <div
                key={feature.title}
                className="p-6 rounded-2xl border border-gray-100 hover:border-gray-200 hover:shadow-lg transition-all group"
              >
                <div className="h-12 w-12 rounded-xl bg-primary-100 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <feature.icon className="h-6 w-6 text-primary-600" />
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">
                  {feature.title}
                </h3>
                <p className="text-gray-500">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

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
        </div>
      </section>

      {/* Parrainage Section */}
      <section id="parrainage" className="py-20 bg-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="rounded-2xl bg-gradient-to-br from-pink-50 to-primary-50 border border-pink-100 p-8 md:p-12 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-pink-100 mb-6">
              <Gift className="h-8 w-8 text-pink-600" />
            </div>
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              Parrainez un commerçant, gagnez du temps
            </h2>
            <p className="text-xl text-gray-500 max-w-2xl mx-auto mb-8">
              Chaque client Kafora a son propre lien de parrainage. Vous
              recevez {REFERRAL_REFERRER_BONUS_DAYS} jours offerts sur votre
              abonnement dès le premier paiement de la personne que vous
              parrainez, et elle profite immédiatement de{" "}
              {REFERRAL_REFEREE_BONUS_DAYS} jours d&apos;essai en plus.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button
                size="lg"
                className="bg-primary-600 text-white hover:bg-primary-700 h-14 px-8 text-lg"
                onClick={() => router.push("/login")}
              >
                Voir mon lien de parrainage
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-14 px-8 text-lg"
                onClick={() => router.push("/setup")}
              >
                Devenir client Kafora
              </Button>
            </div>
            <p className="text-sm text-gray-400 mt-4">
              Déjà client ? Retrouvez votre lien dans Réglages → Parrainage.
            </p>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 bg-primary-900">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
            Prêt à transformer votre entreprise ?
          </h2>
          <p className="text-xl text-primary-200 mb-8">
            Rejoignez des centaines d&apos;entreprises qui font confiance à KAFORA
            ERP
          </p>
          <Button
            size="lg"
            className="bg-white text-primary-900 hover:bg-gray-100 h-14 px-8 text-lg"
            onClick={() => router.push("/setup")}
          >
            Démarrer maintenant
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
