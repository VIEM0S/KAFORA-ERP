'use client';

import Link from 'next/link';
import { Store, Menu, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useState } from 'react';

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
              <a href="#features" className="text-sm font-medium text-gray-600 hover:text-gray-900">
                Fonctionnalités
              </a>
              <a href="#pricing" className="text-sm font-medium text-gray-600 hover:text-gray-900">
                Tarifs
              </a>
              <a href="#parrainage" className="text-sm font-medium text-gray-600 hover:text-gray-900">
                Parrainage
              </a>
              <a href="#contact" className="text-sm font-medium text-gray-600 hover:text-gray-900">
                Contact
              </a>
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
              <a href="#features" onClick={() => setMobileMenuOpen(false)} className="block text-sm font-medium text-gray-600 hover:text-gray-900">
                Fonctionnalités
              </a>
              <a href="#pricing" onClick={() => setMobileMenuOpen(false)} className="block text-sm font-medium text-gray-600 hover:text-gray-900">
                Tarifs
              </a>
              <a href="#parrainage" onClick={() => setMobileMenuOpen(false)} className="block text-sm font-medium text-gray-600 hover:text-gray-900">
                Parrainage
              </a>
              <a href="#contact" onClick={() => setMobileMenuOpen(false)} className="block text-sm font-medium text-gray-600 hover:text-gray-900">
                Contact
              </a>
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
