'use client';

import Link from 'next/link';
import { Store, Menu, X, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { useState } from 'react';
import { VERTICAL_PAGES } from '@/lib/utils/vertical-pages';

// Les ancres (#pricing, #features...) n'existent que sur la page d'accueil.
// LandingLayout est maintenant partagé avec les pages sectorielles
// (app/solutions/*), qui n'ont pas ces sections — un lien "#pricing" tout
// court y resterait sans effet (pas d'id correspondant sur la page
// courante). Toujours préfixer par "/" pour forcer un retour à l'accueil
// avant de sauter à la section, quelle que soit la page de départ.
export function LandingLayout({ children }: { children: React.ReactNode }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-white">
      {/* Navbar */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-lg border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link href="/" className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-primary-600 flex items-center justify-center">
                <Store className="h-5 w-5 text-white" />
              </div>
              <span className="text-xl font-bold text-gray-900">KAFORA</span>
            </Link>

            {/* Desktop Navigation */}
            <div className="hidden md:flex items-center gap-8">
              <Link href="/#features" className="text-sm font-medium text-gray-600 hover:text-gray-900">
                Fonctionnalités
              </Link>
              <DropdownMenu>
                <DropdownMenuTrigger className="flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900 outline-none">
                  Secteurs
                  <ChevronDown className="h-3.5 w-3.5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {VERTICAL_PAGES.map((v) => (
                    <DropdownMenuItem key={v.slug} asChild>
                      <Link href={`/solutions/${v.slug}`}>{v.name}</Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Link href="/#pricing" className="text-sm font-medium text-gray-600 hover:text-gray-900">
                Tarifs
              </Link>
              <Link href="/#parrainage" className="text-sm font-medium text-gray-600 hover:text-gray-900">
                Parrainage
              </Link>
              <Link href="/#contact" className="text-sm font-medium text-gray-600 hover:text-gray-900">
                Contact
              </Link>
            </div>

            <div className="hidden md:flex items-center gap-4">
              <Link href="/login">
                <Button variant="ghost">Connexion</Button>
              </Link>
              <Link href="/setup">
                <Button>Essai gratuit</Button>
              </Link>
            </div>

            {/* Mobile Menu Button */}
            <button
              className="md:hidden p-2 text-gray-600 hover:text-gray-900"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden bg-white border-b border-gray-100">
            <div className="px-4 py-4 space-y-3">
              <Link href="/#features" onClick={() => setMobileMenuOpen(false)} className="block text-sm font-medium text-gray-600 hover:text-gray-900">
                Fonctionnalités
              </Link>
              <div>
                <p className="text-sm font-medium text-gray-400 mb-2">Secteurs</p>
                <div className="space-y-2 pl-2">
                  {VERTICAL_PAGES.map((v) => (
                    <Link
                      key={v.slug}
                      href={`/solutions/${v.slug}`}
                      onClick={() => setMobileMenuOpen(false)}
                      className="block text-sm font-medium text-gray-600 hover:text-gray-900"
                    >
                      {v.name}
                    </Link>
                  ))}
                </div>
              </div>
              <Link href="/#pricing" onClick={() => setMobileMenuOpen(false)} className="block text-sm font-medium text-gray-600 hover:text-gray-900">
                Tarifs
              </Link>
              <Link href="/#parrainage" onClick={() => setMobileMenuOpen(false)} className="block text-sm font-medium text-gray-600 hover:text-gray-900">
                Parrainage
              </Link>
              <Link href="/#contact" onClick={() => setMobileMenuOpen(false)} className="block text-sm font-medium text-gray-600 hover:text-gray-900">
                Contact
              </Link>
              <div className="pt-3 border-t border-gray-100 space-y-2">
                <Link href="/login" className="block">
                  <Button variant="outline" className="w-full">Connexion</Button>
                </Link>
                <Link href="/setup" className="block">
                  <Button className="w-full">Essai gratuit</Button>
                </Link>
              </div>
            </div>
          </div>
        )}
      </nav>

      {/* Main Content */}
      <main>{children}</main>
    </div>
  );
}
