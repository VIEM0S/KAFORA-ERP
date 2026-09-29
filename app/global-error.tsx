'use client';

// app/error.tsx ne couvre pas une exception levée DANS app/layout.tsx
// lui-même (la limite d'erreur d'une route vit à l'intérieur du layout
// racine, pas autour) — sans ce fichier, ce cas précis retombait sur l'écran
// d'erreur brut par défaut de Next.js au lieu de l'interface de récupération
// de la marque. Doit fournir ses propres <html>/<body> : il remplace tout le
// layout racine quand il se déclenche. Trouvé lors de l'audit de résilience
// du 2026-09-29.
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="fr">
      <body className="font-sans">
        <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
          <div className="text-center max-w-sm">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Une erreur est survenue</h1>
            <p className="text-sm text-gray-500 mb-6">
              Quelque chose s&apos;est mal passé de notre côté. Réessaie — si le problème persiste, préviens ton administrateur.
            </p>
            <button
              onClick={() => reset()}
              className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Réessayer
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
