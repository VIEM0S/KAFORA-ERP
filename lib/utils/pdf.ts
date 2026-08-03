/**
 * Générateur de factures PDF — Kafora
 * Utilise jsPDF + jspdf-autotable
 */

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface InvoiceItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

interface InvoiceData {
  // Entreprise
  companyName: string;
  companyEmail?: string;
  companyPhone?: string;
  companyAddress?: string;
  companyCity?: string;
  companyRccm?: string;
  companyNif?: string;
  currency?: string;

  // Facture
  invoiceNumber: string;
  date: string;
  dueDate?: string;
  type?: 'FACTURE' | 'DEVIS' | 'REÇU';

  // Client
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;
  customerAddress?: string;

  // Articles
  items: InvoiceItem[];

  // Totaux
  subtotal: number;
  discountPercent?: number;
  discountAmount?: number;
  tax?: number;
  total: number;

  // Paiement
  paymentMethod?: string;
  amountReceived?: number;
  change?: number;
  soldeCredit?: number;

  // Notes
  notes?: string;
}

const PM_LABELS: Record<string, string> = {
  CASH: 'Espèces',
  MOBILE_MONEY: 'Mobile Money',
  CARD: 'Carte bancaire',
  CREDIT: 'Crédit client',
};

/**
 * Montant formaté pour un document PDF.
 *
 * DEUX PIÈGES corrigés ici :
 *
 * 1. `Intl.NumberFormat('fr-FR')` sépare les milliers par une ESPACE FINE
 *    INSÉCABLE (U+202F). Les polices standard du PDF (Helvetica, encodage
 *    WinAnsi) ne connaissent pas ce caractère : il s'affichait comme « / ».
 *    « 12 500 FCFA » devenait « 12/500 XOF » sur les reçus imprimés — un
 *    document remis au client, donc inacceptable. On normalise donc tous les
 *    espaces exotiques en espace ordinaire.
 *
 * 2. Le code ISO « XOF » était affiché tel quel. Personne au Mali ne lit un
 *    prix en « XOF » : on affiche « FCFA », qui est le nom d'usage.
 */
function formatCFA(amount: number, currency = 'FCFA'): string {
  const label = currency === 'XOF' ? 'FCFA' : currency;
  const number = new Intl.NumberFormat('fr-FR')
    .format(Math.round(amount))
    // Espace fine insécable, espace insécable, espace fine : toutes ramenées
    // à l'espace ASCII, seule sûre dans une police PDF standard.
    .replace(/[\u202F\u00A0\u2009\u2007]/g, ' ');
  return `${number} ${label}`;
}

export function generateInvoicePDF(data: InvoiceData): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const currency = data.currency || 'FCFA';
  const type = data.type || 'FACTURE';
  const pageW = 210;
  const margin = 15;
  const contentW = pageW - margin * 2;

  // ─── Couleurs ─────────────────────────────────────────────────────────────
  const PRIMARY = [37, 99, 235] as [number, number, number];     // blue-600
  const DARK    = [17, 24, 39] as [number, number, number];      // gray-900
  const GRAY    = [107, 114, 128] as [number, number, number];   // gray-500
  const LIGHT   = [249, 250, 251] as [number, number, number];   // gray-50
  const WHITE   = [255, 255, 255] as [number, number, number];

  // ─── Header ───────────────────────────────────────────────────────────────
  // Bandeau bleu en haut
  doc.setFillColor(...PRIMARY);
  doc.rect(0, 0, pageW, 35, 'F');

  // Nom entreprise
  doc.setTextColor(...WHITE);
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text(data.companyName.toUpperCase(), margin, 16);

  // Type de document (FACTURE / DEVIS / REÇU)
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text(type, pageW - margin, 16, { align: 'right' });

  // Numéro document
  doc.setFontSize(9);
  doc.text(`N° ${data.invoiceNumber}`, pageW - margin, 23, { align: 'right' });

  // Contact entreprise sous le bandeau
  doc.setTextColor(...GRAY);
  doc.setFontSize(8);
  let y = 42;
  const companyInfo = [
    data.companyPhone,
    data.companyEmail,
    [data.companyAddress, data.companyCity].filter(Boolean).join(', '),
    data.companyRccm ? `RCCM: ${data.companyRccm}` : null,
    data.companyNif ? `NIF: ${data.companyNif}` : null,
  ].filter(Boolean) as string[];

  companyInfo.forEach(line => {
    doc.text(line, margin, y);
    y += 4.5;
  });

  // ─── Infos facture (droite) ──────────────────────────────────────────────
  const infoY = 42;
  doc.setTextColor(...DARK);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('Date :', pageW - margin - 50, infoY);
  doc.text('Échéance :', pageW - margin - 50, infoY + 6);

  doc.setFont('helvetica', 'normal');
  doc.text(data.date, pageW - margin, infoY, { align: 'right' });
  doc.text(data.dueDate || data.date, pageW - margin, infoY + 6, { align: 'right' });

  // ─── Bloc client ─────────────────────────────────────────────────────────
  y = Math.max(y + 4, 75);
  doc.setFillColor(...LIGHT);
  doc.roundedRect(margin, y, contentW / 2 - 5, 28, 2, 2, 'F');

  doc.setTextColor(...PRIMARY);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text('FACTURÉ À', margin + 4, y + 7);

  doc.setTextColor(...DARK);
  doc.setFontSize(10);
  doc.text(data.customerName, margin + 4, y + 14);

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...GRAY);
  let clientY = y + 20;
  if (data.customerPhone) { doc.text(data.customerPhone, margin + 4, clientY); clientY += 5; }
  if (data.customerEmail) { doc.text(data.customerEmail, margin + 4, clientY); }

  // ─── Tableau des articles ────────────────────────────────────────────────
  const tableY = y + 36;

  autoTable(doc, {
    startY: tableY,
    margin: { left: margin, right: margin },
    head: [['Description', 'Qté', 'Prix unitaire', 'Total']],
    body: data.items.map(item => [
      item.description,
      item.quantity.toString(),
      formatCFA(item.unitPrice, currency),
      formatCFA(item.total, currency),
    ]),
    headStyles: {
      fillColor: PRIMARY,
      textColor: WHITE,
      fontSize: 9,
      fontStyle: 'bold',
      halign: 'left',
    },
    columnStyles: {
      0: { cellWidth: 85 },
      1: { cellWidth: 15, halign: 'center' },
      2: { cellWidth: 40, halign: 'right' },
      3: { cellWidth: 40, halign: 'right', fontStyle: 'bold' },
    },
    bodyStyles: { fontSize: 9, textColor: DARK },
    alternateRowStyles: { fillColor: LIGHT },
    styles: { cellPadding: 4 },
  });

  // ─── Totaux ───────────────────────────────────────────────────────────────
  const finalY = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  const totalsX = pageW - margin - 75;
  let totY = finalY;

  const addTotalLine = (label: string, value: string, bold = false, color?: [number, number, number]) => {
    doc.setFontSize(9);
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setTextColor(...(color || GRAY));
    doc.text(label, totalsX, totY);
    doc.setTextColor(...(bold ? PRIMARY : GRAY));
    doc.text(value, pageW - margin, totY, { align: 'right' });
    totY += 6;
  };

  addTotalLine('Sous-total', formatCFA(data.subtotal, currency));

  if (data.discountAmount && data.discountAmount > 0) {
    addTotalLine(
      `Remise (${data.discountPercent || 0}%)`,
      `-${formatCFA(data.discountAmount, currency)}`,
      false, [34, 197, 94] as [number, number, number]
    );
  }
  if (data.tax && data.tax > 0) {
    addTotalLine('TVA', formatCFA(data.tax, currency));
  }

  // Ligne séparatrice
  doc.setDrawColor(...GRAY);
  doc.setLineWidth(0.3);
  doc.line(totalsX, totY - 2, pageW - margin, totY - 2);

  // Total final en grand
  doc.setFillColor(...PRIMARY);
  doc.roundedRect(totalsX - 4, totY - 1, pageW - margin - totalsX + 4, 10, 2, 2, 'F');
  doc.setTextColor(...WHITE);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('TOTAL', totalsX, totY + 6);
  doc.text(formatCFA(data.total, currency), pageW - margin, totY + 6, { align: 'right' });
  totY += 16;

  // Détail paiement
  if (data.paymentMethod) {
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...GRAY);
    doc.text(`Mode de paiement : ${PM_LABELS[data.paymentMethod] || data.paymentMethod}`, margin, totY);
    totY += 5;
    if (data.paymentMethod === 'CASH' && data.amountReceived) {
      doc.text(`Montant reçu : ${formatCFA(data.amountReceived, currency)}`, margin, totY); totY += 5;
      if (data.change) doc.text(`Monnaie rendue : ${formatCFA(data.change, currency)}`, margin, totY);
    }
    if (data.paymentMethod === 'CREDIT' && data.soldeCredit) {
      const verseA4 = Math.max(0, (data.total || 0) - data.soldeCredit);
      if (verseA4 > 0) {
        doc.text(`Versé ce jour : ${formatCFA(verseA4, currency)}`, margin, totY);
        totY += 5;
      }
      doc.setTextColor(234, 179, 8); // amber
      doc.setFont('helvetica', 'bold');
      doc.text(`Solde en crédit : ${formatCFA(data.soldeCredit, currency)}`, margin, totY);
    }
  }

  // ─── Notes ────────────────────────────────────────────────────────────────
  if (data.notes) {
    const noteY = totY + 12;
    doc.setFillColor(...LIGHT);
    doc.roundedRect(margin, noteY, contentW, 14, 2, 2, 'F');
    doc.setTextColor(...GRAY);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('Notes :', margin + 4, noteY + 6);
    doc.setFont('helvetica', 'normal');
    doc.text(data.notes, margin + 20, noteY + 6);
  }

  // ─── Footer ───────────────────────────────────────────────────────────────
  const footerY = 285;
  doc.setFillColor(...PRIMARY);
  doc.rect(0, footerY, pageW, 12, 'F');
  doc.setTextColor(...WHITE);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.text(
    `${data.companyName} · ${[data.companyPhone, data.companyEmail].filter(Boolean).join(' · ')}`,
    pageW / 2, footerY + 7, { align: 'center' }
  );

  // ─── Téléchargement ───────────────────────────────────────────────────────
  const filename = `${type.toLowerCase()}-${data.invoiceNumber.replace(/[^a-z0-9]/gi, '-')}.pdf`;
  doc.save(filename);
}

/**
 * Génère un ticket de caisse au format imprimante thermique de comptoir
 * (58mm ou 80mm), au lieu du format A4 de generateInvoicePDF ci-dessus.
 * Une bobine thermique n'a pas de hauteur de page fixe — on calcule donc la
 * hauteur du document à partir du nombre de lignes réelles à imprimer.
 */
export function generateThermalReceipt(data: InvoiceData, widthMm: 58 | 80 = 80): void {
  const currency = data.currency || 'FCFA';
  const type = data.type || 'REÇU';
  const margin = widthMm === 58 ? 3 : 4;
  const pageW = widthMm;
  const contentW = pageW - margin * 2;

  // Estimation généreuse du nombre de lignes pour dimensionner la page.
  // Chaque article prend potentiellement 2 lignes (nom, puis qté/prix/total)
  // si le nom est long — on compte large plutôt que de risquer de couper.
  const estimatedLines =
    10 +                              // en-tête (nom, adresse, tel, RCCM/NIF, séparateur, n°/date)
    data.items.length * 2 +           // chaque article sur 2 lignes
    8 +                                // totaux + paiement
    (data.notes ? 3 : 0) +
    4;                                 // pied de page
  const lineHeight = widthMm === 58 ? 4.2 : 4.6;
  const pageH = Math.max(80, estimatedLines * lineHeight + 20);

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [pageW, pageH] });
  const fontSize = widthMm === 58 ? 7 : 8;
  const fontSizeSmall = widthMm === 58 ? 6 : 7;
  let y = 6;

  const center = (text: string, size = fontSize, bold = false) => {
    doc.setFontSize(size);
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.text(text, pageW / 2, y, { align: 'center' });
    y += size * 0.5;
  };
  const line = () => {
    doc.setLineDashPattern([0.5, 0.5], 0);
    doc.setLineWidth(0.2);
    doc.line(margin, y, pageW - margin, y);
    y += 3;
  };
  const row = (left: string, right: string, size = fontSize, bold = false) => {
    doc.setFontSize(size);
    doc.setFont('helvetica', bold ? 'bold' : 'normal');

    // Un ticket de 58 mm est étroit : « Solde en crédit » suivi de
    // « 58 500 FCFA » ne tient pas sur une ligne. Sans contrôle, les deux
    // textes se chevauchaient et le montant partait tronqué — « 58 500 XO ».
    // Un montant coupé sur un reçu remis au client est inacceptable.
    const leftW = doc.getTextWidth(left);
    const rightW = doc.getTextWidth(right);

    if (leftW + rightW + 2 <= contentW) {
      doc.text(left, margin, y);
      doc.text(right, pageW - margin, y, { align: 'right' });
      y += size * 0.5 + 1;
      return;
    }

    // Trop long : le libellé sur une ligne, le montant sur la suivante,
    // aligné à droite. Plus haut, mais lisible et complet.
    doc.text(left, margin, y);
    y += size * 0.5 + 1;
    doc.text(right, pageW - margin, y, { align: 'right' });
    y += size * 0.5 + 1;
  };

  // ─── En-tête ──────────────────────────────────────────────────────────────
  center(data.companyName.toUpperCase(), fontSize + 1, true);
  y += 1;
  if (data.companyAddress || data.companyCity) {
    center([data.companyAddress, data.companyCity].filter(Boolean).join(', '), fontSizeSmall);
  }
  if (data.companyPhone) center(data.companyPhone, fontSizeSmall);
  if (data.companyRccm) center(`RCCM: ${data.companyRccm}`, fontSizeSmall);
  if (data.companyNif) center(`NIF: ${data.companyNif}`, fontSizeSmall);
  y += 1;
  line();

  center(type, fontSize, true);
  center(`N° ${data.invoiceNumber}`, fontSizeSmall);
  center(data.date, fontSizeSmall);
  if (data.customerName && data.customerName !== 'Client comptoir') {
    center(`Client : ${data.customerName}`, fontSizeSmall);
  }
  y += 1;
  line();

  // ─── Articles ─────────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'normal');
  data.items.forEach(item => {
    doc.setFontSize(fontSize);
    const nameLines = doc.splitTextToSize(item.description, contentW);
    nameLines.forEach((l: string) => { doc.text(l, margin, y); y += fontSize * 0.5; });
    row(`  ${item.quantity} x ${formatCFA(item.unitPrice, currency)}`, formatCFA(item.total, currency), fontSizeSmall);
  });
  y += 1;
  line();

  // ─── Totaux ───────────────────────────────────────────────────────────────
  row('Sous-total', formatCFA(data.subtotal, currency), fontSize);
  if (data.discountAmount && data.discountAmount > 0) {
    row(`Remise (${data.discountPercent || 0}%)`, `-${formatCFA(data.discountAmount, currency)}`, fontSizeSmall);
  }
  if (data.tax && data.tax > 0) row('TVA', formatCFA(data.tax, currency), fontSize);
  line();
  row('TOTAL', formatCFA(data.total, currency), fontSize + 2, true);
  y += 2;

  if (data.paymentMethod) {
    row('Paiement', PM_LABELS[data.paymentMethod] || data.paymentMethod, fontSizeSmall);
    if (data.paymentMethod === 'CASH' && data.amountReceived) {
      row('Reçu', formatCFA(data.amountReceived, currency), fontSizeSmall);
      if (data.change) row('Monnaie rendue', formatCFA(data.change, currency), fontSizeSmall, true);
    }
    if (data.paymentMethod === 'CREDIT' && data.soldeCredit) {
      // Le montant VERSÉ manquait : le client repartait avec un reçu
      // indiquant le total et son reste à payer, sans trace de ce qu'il
      // venait de donner. C'est la ligne la plus contestée d'un reçu à
      // crédit — elle doit y figurer.
      const verse = Math.max(0, (data.total || 0) - data.soldeCredit);
      if (verse > 0) row('Versé ce jour', formatCFA(verse, currency), fontSizeSmall);
      row('Solde en crédit', formatCFA(data.soldeCredit, currency), fontSizeSmall, true);
    }
  }

  if (data.notes) {
    y += 2; line();
    doc.setFontSize(fontSizeSmall);
    const noteLines = doc.splitTextToSize(data.notes, contentW);
    noteLines.forEach((l: string) => { doc.text(l, margin, y); y += fontSizeSmall * 0.5; });
  }

  // ─── Pied de page ─────────────────────────────────────────────────────────
  y += 3; line();
  center('Merci de votre visite !', fontSizeSmall, true);
  if (data.companyPhone) center(data.companyPhone, fontSizeSmall);

  const filename = `ticket-${data.invoiceNumber.replace(/[^a-z0-9]/gi, '-')}.pdf`;
  doc.save(filename);
}

export type { InvoiceData };
