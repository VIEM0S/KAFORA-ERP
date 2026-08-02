// `exceljs` pèse à lui seul l'essentiel du poids de la page d'import
// (~270 ko). Importé statiquement, il était téléchargé par tout visiteur de
// la page — y compris ceux qui déposent un simple .csv, ou qui repartent
// sans rien importer. Il est donc chargé À LA DEMANDE, au moment où un
// classeur Excel doit réellement être lu ou écrit.
//
// Le type reste importé statiquement : `import type` disparaît à la
// compilation et n'ajoute rien au bundle.
import type ExcelJS from 'exceljs';

/** Charge exceljs à la demande. Le module est mis en cache par le navigateur
 *  après le premier appel : un second import ne le retélécharge pas. */
async function loadExcelJS() {
  const mod = await import('exceljs');
  return mod.default ?? mod;
}

export interface ParsedProductRow {
  rowIndex: number; // 1-based, pour affichage humain (ligne du fichier)
  sku: string;
  name: string;
  categoryName: string | null;
  purchasePrice: number;
  sellingPrice: number;
  initialStock: number;
  barcode: string | null;
  unit: string;
  taxRate: number;
  alertThreshold: number;
  errors: string[];
  warnings: string[];
}

// Correspondances flexibles : plusieurs libellés de colonnes possibles par champ,
// normalisés (minuscules, sans accents) pour matcher un en-tête Excel réel.
const HEADER_ALIASES: Record<string, string[]> = {
  sku: ['sku', 'reference', 'ref', 'code'],
  name: ['nom', 'nom du produit', 'designation', 'produit', 'name'],
  categoryName: ['categorie', 'category'],
  purchasePrice: ['prix achat', "prix d'achat", 'purchase price', 'cout', 'cout achat'],
  sellingPrice: ['prix vente', 'prix de vente', 'selling price', 'prix'],
  initialStock: ['stock initial', 'stock', 'quantite', 'qty', 'quantite initiale'],
  barcode: ['code barre', 'code-barre', 'code barres', 'barcode', 'ean'],
  unit: ['unite', 'unit'],
  taxRate: ['tva', 'taxe', 'tax', 'tax rate'],
  alertThreshold: ['seuil alerte', 'seuil', 'alert threshold', "seuil d'alerte"],
};

function normalizeHeader(h: string): string {
  return h
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function buildColumnMap(headerRow: string[]): Record<string, number> {
  const normalized = headerRow.map(normalizeHeader);
  const map: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const idx = normalized.findIndex(h => aliases.includes(h));
    if (idx !== -1) map[field] = idx;
  }
  return map;
}

function parseNumber(raw: unknown): number {
  if (raw === null || raw === undefined || raw === '') return 0;
  const cleaned = String(raw).replace(/[^\d.,-]/g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

function textToRows(text: string): string[][] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const lines = trimmed.split(/\r?\n/);
  // Excel copie toujours en tabulations ; on ne bascule sur la virgule que si
  // aucune tabulation n'est présente sur la ligne d'en-tête (cas CSV).
  const delimiter = lines[0].includes('\t') ? '\t' : ',';
  return lines.map(line => line.split(delimiter).map(cell => cell.trim()));
}

// Convertit une valeur de cellule ExcelJS (qui peut être un texte enrichi,
// une formule, une date, etc.) en primitive simple exploitable par
// rowsToProducts, qui attend des string/number/null.
function cellToPrimitive(v: ExcelJS.CellValue): string | number | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('result' in v) return cellToPrimitive((v as { result: ExcelJS.CellValue }).result); // formule
    if ('text' in v) return String((v as { text: unknown }).text); // hyperlien
    if ('richText' in v) {
      return (v as { richText: Array<{ text: string }> }).richText.map(r => r.text).join('');
    }
    return String(v);
  }
  return v as string | number;
}

function rowsToProducts(rows: unknown[][]): ParsedProductRow[] {
  if (rows.length === 0) return [];
  const headerRow = rows[0].map(c => String(c ?? ''));
  const colMap = buildColumnMap(headerRow);

  const missing: string[] = [];
  if (colMap.name === undefined) missing.push('Nom');
  if (colMap.sellingPrice === undefined) missing.push('Prix Vente');
  if (missing.length > 0) {
    throw new Error(
      `Colonnes obligatoires introuvables dans l'en-tête : ${missing.join(', ')}. ` +
      `Vérifie que la première ligne contient bien les titres de colonnes.`
    );
  }

  const dataRows = rows.slice(1).filter(r => r.some(c => c !== null && c !== undefined && String(c).trim() !== ''));

  return dataRows.map((r, i): ParsedProductRow => {
    const get = (field: string): string => {
      const idx = colMap[field];
      return idx === undefined ? '' : String(r[idx] ?? '').trim();
    };
    const errors: string[] = [];
    const warnings: string[] = [];

    const name = get('name');
    if (!name) errors.push('Nom manquant');

    const sellingPriceRaw = get('sellingPrice');
    const sellingPrice = parseNumber(sellingPriceRaw);
    if (!sellingPriceRaw) errors.push('Prix de vente manquant');
    else if (Number.isNaN(sellingPrice) || sellingPrice <= 0) errors.push('Prix de vente invalide');

    const purchasePrice = parseNumber(get('purchasePrice'));
    const initialStock = colMap.initialStock !== undefined ? parseNumber(get('initialStock')) : 0;
    if (Number.isNaN(initialStock)) warnings.push('Stock initial illisible, mis à 0');

    const taxRate = colMap.taxRate !== undefined ? parseNumber(get('taxRate')) : 0;
    const alertThreshold = colMap.alertThreshold !== undefined ? parseNumber(get('alertThreshold')) : 10;

    let sku = get('sku');
    if (!sku) {
      // SKU non fourni : on en génère un à partir du nom (comportement de secours,
      // signalé en warning pour que l'utilisateur sache qu'il a été auto-généré).
      sku = name
        .toUpperCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 20) || `PROD${i + 1}`;
      warnings.push(`SKU auto-généré : ${sku}`);
    }

    return {
      rowIndex: i + 2, // +2 : ligne 1 = en-tête, index humain commence à 1
      sku: sku.toUpperCase(),
      name,
      categoryName: colMap.categoryName !== undefined ? (get('categoryName') || null) : null,
      purchasePrice: Number.isNaN(purchasePrice) ? 0 : purchasePrice,
      sellingPrice: Number.isNaN(sellingPrice) ? 0 : sellingPrice,
      initialStock: Number.isNaN(initialStock) ? 0 : Math.max(0, Math.floor(initialStock)),
      barcode: colMap.barcode !== undefined ? (get('barcode') || null) : null,
      unit: (colMap.unit !== undefined ? get('unit') : '') || 'piece',
      taxRate: Number.isNaN(taxRate) ? 0 : taxRate,
      alertThreshold: Number.isNaN(alertThreshold) || alertThreshold <= 0 ? 10 : Math.floor(alertThreshold),
      errors,
      warnings,
    };
  });
}

/** Parse un fichier .xlsx ou .csv (le legacy .xls binaire n'est pas pris en charge, voir message d'erreur) */
export async function parseProductFile(file: File): Promise<ParsedProductRow[]> {
  const fileName = file.name.toLowerCase();

  if (fileName.endsWith('.csv')) {
    const text = await file.text();
    return rowsToProducts(textToRows(text));
  }

  if (fileName.endsWith('.xls') && !fileName.endsWith('.xlsx')) {
    // Format Excel 97-2003 (binaire, pas le format .xlsx moderne basé sur
    // zip/XML) : la bibliothèque qui le lisait (xlsx/SheetJS) portait deux
    // vulnérabilités connues non corrigées côté npm — on ne le prend plus en
    // charge plutôt que de réintroduire ce risque pour un format devenu rare.
    throw new Error(
      `Le format .xls (Excel 97-2003) n'est plus pris en charge. Dans Excel, utilise ` +
      `"Fichier → Enregistrer sous" → "Classeur Excel (.xlsx)", ou exporte en .csv, puis réimporte le fichier.`
    );
  }

  const buffer = await file.arrayBuffer();
  const ExcelJSRuntime = await loadExcelJS();
  const workbook = new ExcelJSRuntime.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw new Error(`Fichier illisible. Vérifie qu'il s'agit bien d'un fichier .xlsx ou .csv valide.`);
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error('Le fichier ne contient aucune feuille de calcul.');

  const rows: unknown[][] = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    // row.values est un tableau sparse indexé à partir de 1 en ExcelJS
    // (l'index 0 est toujours vide) — on le réaligne sur une base 0.
    const raw = row.values as ExcelJS.CellValue[];
    rows.push(raw.slice(1).map(cellToPrimitive));
  });

  return rowsToProducts(rows);
}

/** Parse du texte collé depuis Excel (délimité par tabulations) ou un CSV collé (virgules) */
export function parsePastedText(text: string): ParsedProductRow[] {
  return rowsToProducts(textToRows(text));
}

/** Modèle d'exemple à télécharger, pour que l'utilisateur sache quel format préparer */
export async function buildTemplateWorkbook(): Promise<Blob> {
  const headers = ['SKU', 'Nom', 'Catégorie', 'Prix Achat', 'Prix Vente', 'Stock Initial', 'Code Barre', 'Unité', 'TVA', 'Seuil Alerte'];
  const example = ['CLOU-4CM', 'Clous 4cm (boîte)', 'Quincaillerie', 800, 1200, 50, '', 'piece', 0, 10];

  const ExcelJSRuntime = await loadExcelJS();
  const workbook = new ExcelJSRuntime.Workbook();
  const sheet = workbook.addWorksheet('Produits');
  sheet.addRow(headers);
  sheet.addRow(example);

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
