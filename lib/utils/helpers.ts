import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number, currency: string = 'FCFA'): string {
  if (currency === 'XOF' || currency === 'FCFA') {
    return new Intl.NumberFormat('fr-FR', {
      style: 'decimal',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount) + ' FCFA';
  }
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

/** Convertit n'importe quel format de date Firestore/JS en objet Date */
function toDate(date: unknown): Date | null {
  if (!date) return null;
  // Firestore Timestamp (client SDK)
  if (typeof date === 'object' && date !== null && 'toDate' in date && typeof (date as { toDate: () => Date }).toDate === 'function') {
    return (date as { toDate: () => Date }).toDate();
  }
  // Firestore Timestamp sérialisé {seconds, nanoseconds}
  if (typeof date === 'object' && date !== null && 'seconds' in date && typeof (date as { seconds: number }).seconds === 'number') {
    return new Date((date as { seconds: number }).seconds * 1000);
  }
  if (typeof date === 'string') {
    const d = new Date(date);
    return isNaN(d.getTime()) ? null : d;
  }
  if (date instanceof Date) return isNaN(date.getTime()) ? null : date;
  return null;
}

export function formatDate(date: unknown): string {
  const d = toDate(date);
  if (!d) return '—';
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(d);
}

export function formatDateTime(date: unknown): string {
  const d = toDate(date);
  if (!d) return '—';
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(d);
}

export function formatRelativeTime(date: unknown): string {
  const d = toDate(date);
  if (!d) return '—';
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  if (diffSec < 60) return 'À l\'instant';
  if (diffMin < 60) return `Il y a ${diffMin} min`;
  if (diffHour < 24) return `Il y a ${diffHour}h`;
  if (diffDay < 7) return `Il y a ${diffDay}j`;
  return formatDate(d);
}

export function slugify(str: string): string {
  return str.toLowerCase().trim().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/--+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function generateReferralCode(companyName: string): string {
  const base = slugify(companyName).replace(/-/g, '').slice(0, 10).toUpperCase() || 'KAFORA';
  // 6 caractères aléatoires : ~2 milliards de combinaisons par préfixe, largement
  // suffisant pour éviter une collision sans avoir besoin de vérifier l'unicité
  // en base à la création.
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `${base}-${random}`;
}
