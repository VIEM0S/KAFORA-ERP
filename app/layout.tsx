import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Toaster } from '@/components/ui/sonner';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: "Kafora - Système de gestion d'entreprise",
  description: 'Système de gestion ERP moderne pour entreprises africaines. Gérez vos ventes, stocks, crédits et analytics en toute simplicité.',
  keywords: ['ERP', 'Bamako', 'Mali', 'gestion', 'quincaillerie', 'Afrique de l\'Ouest', 'SaaS'],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr" className={inter.variable}>
      <body className="font-sans">
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
