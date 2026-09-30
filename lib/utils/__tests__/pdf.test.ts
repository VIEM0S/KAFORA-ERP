import { describe, it, expect, beforeEach, vi } from 'vitest';
import { generateThermalReceipt, type InvoiceData } from '../pdf';

/**
 * jsPDF fonctionne réellement en Node (pas besoin de jsdom), mais ses
 * méthodes (text, save...) sont assignées par INSTANCE dans le constructeur,
 * pas sur jsPDF.prototype — impossible de les espionner avec vi.spyOn sur le
 * prototype. On sous-classe donc jsPDF pour intercepter chaque instance dès
 * sa construction : on capture le contenu réellement écrit (.text) et on
 * neutralise .save() (qui écrirait sinon un vrai fichier .pdf sur disque).
 */

const { textCallsHolder } = vi.hoisted(() => ({ textCallsHolder: { current: [] as string[] } }));

vi.mock('jspdf', async () => {
  const actual = await vi.importActual<{ default: new (...args: unknown[]) => Record<string, unknown> }>('jspdf');
  class SpyPDF extends actual.default {
    constructor(...args: unknown[]) {
      super(...args);
      const origText = (this.text as (...a: unknown[]) => unknown).bind(this);
      this.text = (text: string | string[], ...rest: unknown[]) => {
        if (Array.isArray(text)) textCallsHolder.current.push(...text);
        else textCallsHolder.current.push(text);
        return origText(text, ...rest);
      };
      this.save = () => this;
    }
  }
  return { default: SpyPDF };
});

let textCalls: string[];

beforeEach(() => {
  textCallsHolder.current = [];
  textCalls = textCallsHolder.current;
});

function baseData(overrides?: Partial<InvoiceData>): InvoiceData {
  return {
    companyName: 'Boutique Test',
    companyPhone: '+223 70 00 00 00',
    invoiceNumber: 'FAC-2026-000042',
    date: '12/08/2026',
    customerName: 'Client comptoir',
    items: [{ description: 'Sac de riz 25kg', quantity: 1, unitPrice: 15000, total: 15000 }],
    subtotal: 15000,
    total: 15000,
    paymentMethod: 'CASH',
    amountReceived: 15000,
    change: 0,
    ...overrides,
  };
}

describe('generateThermalReceipt', () => {
  // generateThermalReceipt est désormais async (jsPDF chargé dynamiquement à
  // l'appel — voir lib/utils/pdf.ts, lazy-load trouvé lors de l'audit de
  // performance du 2026-09-29) : chaque appel doit être awaité, sinon les
  // assertions s'exécutent avant que l'import dynamique ait résolu et que le
  // document ait réellement été écrit.
  it("n'affiche jamais un montant tronqué (espace insécable / séparateur exotique)", async () => {
    await generateThermalReceipt(baseData({
      items: [{ description: 'Article', quantity: 1, unitPrice: 1234567, total: 1234567 }],
      subtotal: 1234567, total: 1234567, amountReceived: 1234567,
    }), 80);

    const joined = textCalls.join(' | ');
    // Le piège corrigé (voir formatCFA) : Intl.NumberFormat('fr-FR') produit
    // une espace fine insécable non gérée par la police PDF standard.
    expect(joined).not.toMatch(/1\/234\/567|1 234\/567/);
    expect(joined).toContain('1 234 567 FCFA');
  });

  it('affiche "FCFA" et jamais le code ISO "XOF" brut', async () => {
    await generateThermalReceipt(baseData({ currency: 'XOF' }), 80);
    const joined = textCalls.join(' | ');
    expect(joined).toContain('FCFA');
    expect(joined).not.toContain('XOF');
  });

  it('scinde libellé et montant sur deux lignes quand ils ne tiennent pas sur un ticket 58mm (régression)', async () => {
    // Cas exact documenté dans le code source : "Solde en crédit" +
    // "58 500 FCFA" ne tenait pas sur une ligne de 58mm et le montant
    // partait tronqué avant le correctif.
    await generateThermalReceipt(baseData({
      paymentMethod: 'CREDIT',
      total: 60000,
      soldeCredit: 58500,
      amountReceived: undefined,
    }), 58);

    // Le montant complet doit apparaître intact, quelque part dans le
    // document (scindé ou non), jamais tronqué à mi-chemin.
    expect(textCalls).toContain('58 500 FCFA');
    expect(textCalls.some(t => t.includes('Solde en crédit'))).toBe(true);
  });

  it('affiche le montant versé le jour même sur une vente à crédit avec acompte', async () => {
    await generateThermalReceipt(baseData({
      paymentMethod: 'CREDIT',
      total: 20000,
      soldeCredit: 12000, // acompte de 8000 versé
      amountReceived: undefined,
    }), 80);

    expect(textCalls).toContain('8 000 FCFA');
    expect(textCalls.some(t => t.includes('Versé ce jour'))).toBe(true);
  });

  it("n'affiche pas de ligne 'Versé ce jour' pour une vente à crédit sans acompte", async () => {
    await generateThermalReceipt(baseData({
      paymentMethod: 'CREDIT',
      total: 20000,
      soldeCredit: 20000,
      amountReceived: undefined,
    }), 80);

    expect(textCalls.some(t => t.includes('Versé ce jour'))).toBe(false);
  });

  it('affiche la monnaie rendue pour un paiement CASH', async () => {
    await generateThermalReceipt(baseData({
      paymentMethod: 'CASH', total: 15000, amountReceived: 20000, change: 5000,
    }), 80);

    expect(textCalls).toContain('5 000 FCFA');
    expect(textCalls.some(t => t.includes('Monnaie rendue'))).toBe(true);
  });

  it('affiche la remise avec son pourcentage', async () => {
    await generateThermalReceipt(baseData({
      subtotal: 20000, discountPercent: 15, discountAmount: 3000, total: 17000, amountReceived: 17000,
    }), 80);

    expect(textCalls.some(t => t.includes('Remise (15%)'))).toBe(true);
    expect(textCalls).toContain('-3 000 FCFA');
  });

  it('renvoie à la ligne un nom de produit trop long plutôt que de le couper', async () => {
    const longName = 'Sac de ciment CIMAF 50kg qualité supérieure import';
    await generateThermalReceipt(baseData({
      items: [{ description: longName, quantity: 2, unitPrice: 5000, total: 10000 }],
      subtotal: 10000, total: 10000, amountReceived: 10000,
    }), 58);

    // splitTextToSize doit couper le nom en plusieurs morceaux qui, mis bout
    // à bout (sans espace ajouté par le test), reconstituent le nom complet.
    const reconstructed = textCalls.join('').replace(/\s+/g, ' ');
    expect(reconstructed).toContain(longName.split(' ')[0]);
    expect(reconstructed).toContain(longName.split(' ').at(-1)!);
  });

  it("n'affiche pas le nom du client pour une vente comptoir sans client identifié", async () => {
    await generateThermalReceipt(baseData({ customerName: 'Client comptoir' }), 80);
    expect(textCalls.some(t => t.includes('Client comptoir'))).toBe(false);
  });

  it('affiche le nom du client quand il est identifié', async () => {
    await generateThermalReceipt(baseData({ customerName: 'Amadou Traoré' }), 80);
    expect(textCalls.some(t => t === 'Client : Amadou Traoré')).toBe(true);
  });

  it('fonctionne identiquement en 58mm et 80mm sans lever d\'exception', async () => {
    await expect(generateThermalReceipt(baseData(), 58)).resolves.not.toThrow();
    await expect(generateThermalReceipt(baseData(), 80)).resolves.not.toThrow();
  });
});
