import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Toaster } from '@/components/ui/sonner';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: "Kafora - Système de gestion d'entreprise",
  description: 'Système de gestion ERP moderne pour entreprises africaines. Gérez vos ventes, stocks, crédits et analytics en toute simplicité.',
  keywords: ['ERP', 'Bamako', 'Mali', 'gestion', 'quincaillerie', 'Afrique de l\'Ouest', 'SaaS'],
};

// Sans ceci, aucune balise <meta name="viewport"> n'est émise : les
// navigateurs mobiles rendent alors la page avec une largeur virtuelle
// d'environ 980px (comportement "site desktop" historique) puis la
// réduisent pour qu'elle tienne à l'écran — d'où l'app minuscule qui
// oblige à zoomer, et qui ne s'adapte jamais vraiment à l'écran du
// téléphone. maximumScale/userScalable restent permissifs (accessibilité :
// on ne bloque jamais le zoom utilisateur), seule la largeur est fixée
// sur celle de l'appareil.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
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
