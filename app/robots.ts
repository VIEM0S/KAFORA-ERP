import type { MetadataRoute } from 'next';

const BASE_URL = 'https://kafora-erp.netlify.app';

// Liste blanche explicite plutôt que blocage au cas par cas : le reste de
// l'app (dashboard, POS, API...) est déjà protégé par proxy.ts, mais rien
// n'empêchait un moteur de recherche d'indexer ces URLs (redirigées vers
// /login, donc sans intérêt et gaspillant du budget de crawl). Plus sûr
// d'énumérer ce qui DOIT être visible que ce qui ne doit pas l'être — une
// future page privée reste exclue par défaut sans y penser.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: ['/$', '/mentions-legales', '/cgv', '/confidentialite'],
      disallow: '/',
    },
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
