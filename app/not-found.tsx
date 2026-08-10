'use client';

import Link from 'next/link';
import { PackageSearch } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="text-center max-w-sm">
        <div className="h-20 w-20 rounded-full bg-primary-50 flex items-center justify-center mx-auto mb-6">
          <PackageSearch className="h-10 w-10 text-primary-600" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Page introuvable</h1>
        <p className="text-sm text-gray-500 mb-6">
          Cette page n&apos;existe pas ou a été déplacée. Vérifie l&apos;adresse, ou retourne à ton tableau de bord.
        </p>
        <Link href="/dashboard">
          <Button className="bg-primary-600 hover:bg-primary-700">Retour au tableau de bord</Button>
        </Link>
      </div>
    </div>
  );
}
