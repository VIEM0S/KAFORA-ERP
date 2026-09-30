// Chemin d'import conventionnel de shadcn/ui (components/ui/*.tsx importent
// tous @/lib/utils) — réexporte l'implémentation unique de lib/utils/helpers.ts
// au lieu d'en garder une seconde copie identique. Trouvé lors de l'audit de
// dette technique du 2026-09-29/30.
export { cn } from './utils/helpers';
