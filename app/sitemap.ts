import type { MetadataRoute } from 'next';

const BASE_URL = 'https://kafora-erp.netlify.app';

// Seules les pages réellement publiques et indexables (voir robots.ts) —
// pas /login ni /setup, qui n'ont aucun intérêt à recevoir du trafic
// organique direct plutôt que passer par la page d'accueil.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: BASE_URL, priority: 1 },
    { url: `${BASE_URL}/mentions-legales`, priority: 0.3 },
    { url: `${BASE_URL}/cgv`, priority: 0.3 },
    { url: `${BASE_URL}/confidentialite`, priority: 0.3 },
  ];
}
