'use client';

import { useState, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Upload, ClipboardPaste, Download, ArrowLeft,
  CheckCircle2, AlertTriangle, XCircle, RefreshCw, FileSpreadsheet,
} from 'lucide-react';
import { DashboardLayout } from '@/components/layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from '@/components/ui/tabs';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useAuthStore } from '@/hooks/store';
import {
  collection, doc, getDocs, writeBatch, serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { tenantCol } from '@/lib/firebase/collections';
import { checkPlanLimitClient } from '@/lib/firebase/plan-limits-client';
import {
  parseProductFile, parsePastedText, buildTemplateWorkbook, type ParsedProductRow,
} from '@/lib/utils/product-import';
import { formatCurrency } from '@/lib/utils/helpers';

function slugify(str: string) {
  return str.toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Firestore limite un writeBatch à 500 opérations. Chaque ligne produit peut
// écrire jusqu'à 3 documents (produit + inventaire + mouvement de stock) donc
// on reste large sous la limite par lot.
const ROWS_PER_BATCH = 150;

type ImportStep = 'input' | 'preview' | 'importing' | 'done';

export default function ProductImportPage() {
  const router = useRouter();
  const { tenant, stores, currentStore } = useAuthStore();
  const tenantId = tenant?.id;

  const [step, setStep] = useState<ImportStep>('input');
  const [pasteText, setPasteText] = useState('');
  const [selectedStoreId, setSelectedStoreId] = useState(currentStore?.id || stores?.[0]?.id || '');
  const [rows, setRows] = useState<ParsedProductRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [quotaError, setQuotaError] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<{ created: number; skipped: ParsedProductRow[]; categoriesCreated: string[] } | null>(null);

  const validRows = useMemo(() => rows.filter(r => r.errors.length === 0), [rows]);
  const invalidRows = useMemo(() => rows.filter(r => r.errors.length > 0), [rows]);
  const duplicateSkusInFile = useMemo(() => {
    const seen = new Map<string, number>();
    const dupes = new Set<string>();
    for (const r of validRows) {
      if (seen.has(r.sku)) dupes.add(r.sku);
      seen.set(r.sku, (seen.get(r.sku) || 0) + 1);
    }
    return dupes;
  }, [validRows]);

  const handleFile = async (file: File) => {
    setIsParsing(true);
    setParseError(null);
    try {
      const parsed = await parseProductFile(file);
      setRows(parsed);
      setStep('preview');
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'Fichier illisible. Vérifie le format.');
    } finally {
      setIsParsing(false);
    }
  };

  const handlePasteSubmit = () => {
    setParseError(null);
    try {
      const parsed = parsePastedText(pasteText);
      if (parsed.length === 0) {
        setParseError('Aucune ligne de données trouvée. Colle un tableau avec une ligne d\'en-tête (Nom, Prix Vente, ...) suivie des produits.');
        return;
      }
      setRows(parsed);
      setStep('preview');
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'Texte illisible. Vérifie le format.');
    }
  };

  const handleDownloadTemplate = async () => {
    const blob = await buildTemplateWorkbook();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'modele-import-produits.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async () => {
    if (!tenantId || !selectedStoreId) return;
    setQuotaError(null);

    // Ne garder qu'une seule occurrence par SKU dupliqué dans le fichier (la première)
    const seenSkus = new Set<string>();
    const dedupedRows = validRows.filter(r => {
      if (seenSkus.has(r.sku)) return false;
      seenSkus.add(r.sku);
      return true;
    });

    // Vérifier le quota du forfait AVANT d'écrire quoi que ce soit
    const limitCheck = await checkPlanLimitClient(tenantId, 'maxProducts', dedupedRows.length);
    if (!limitCheck.allowed) {
      setQuotaError(limitCheck.reason);
      return;
    }

    setStep('importing');
    setImportProgress({ done: 0, total: dedupedRows.length });

    // ── 1. Détecter les SKU déjà existants dans le catalogue (on ne les écrase pas) ──
    const existingSkuSnap = await getDocs(collection(db, tenantCol(tenantId, 'products')));
    const existingSkus = new Set(existingSkuSnap.docs.map(d => String(d.data().sku || '').toUpperCase()));
    const toImport = dedupedRows.filter(r => !existingSkus.has(r.sku));
    const skippedExisting = dedupedRows.filter(r => existingSkus.has(r.sku));

    // ── 2. Créer les catégories manquantes (par nom, insensible à la casse) ──
    const catSnap = await getDocs(collection(db, tenantCol(tenantId, 'categories')));
    const existingCatByName = new Map(catSnap.docs.map(d => [String(d.data().name || '').toLowerCase().trim(), d.id]));
    const neededCatNames = Array.from(new Set(
      toImport.map(r => r.categoryName?.trim()).filter((n): n is string => !!n)
    ));
    const newCatNames = neededCatNames.filter(n => !existingCatByName.has(n.toLowerCase()));

    for (const name of newCatNames) {
      const ref = doc(collection(db, tenantCol(tenantId, 'categories')));
      const batch = writeBatch(db);
      batch.set(ref, {
        tenantId, name, slug: slugify(name), description: null, parentId: null,
        isActive: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
      await batch.commit();
      existingCatByName.set(name.toLowerCase(), ref.id);
    }

    // ── 3. Écrire les produits (+ stock initial) par lots ────────────────────
    let doneCount = 0;
    for (let i = 0; i < toImport.length; i += ROWS_PER_BATCH) {
      const chunk = toImport.slice(i, i + ROWS_PER_BATCH);
      const batch = writeBatch(db);
      for (const r of chunk) {
        const productRef = doc(collection(db, tenantCol(tenantId, 'products')));
        const categoryId = r.categoryName ? (existingCatByName.get(r.categoryName.toLowerCase().trim()) || null) : null;
        batch.set(productRef, {
          tenantId, sku: r.sku, barcode: r.barcode, name: r.name,
          // Indispensable pour la recherche POS (voir product-form-dialog)
          nameLower: (r.name || '').toLowerCase(), description: null,
          categoryId, unit: r.unit,
          purchasePrice: r.purchasePrice, sellingPrice: r.sellingPrice, taxRate: r.taxRate,
          trackInventory: true, alertThreshold: r.alertThreshold, isActive: true,
          createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        });
        if (r.initialStock > 0) {
          const invRef = doc(collection(db, tenantCol(tenantId, 'inventory')));
          batch.set(invRef, {
            tenantId, productId: productRef.id, storeId: selectedStoreId,
            quantity: r.initialStock, minQuantity: r.alertThreshold,
            createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
          });
          const movRef = doc(collection(db, tenantCol(tenantId, 'inventory_movements')));
          batch.set(movRef, {
            tenantId, productId: productRef.id, storeId: selectedStoreId,
            type: 'IN', quantity: r.initialStock,
            previousQuantity: 0, newQuantity: r.initialStock,
            reason: 'Import en masse — stock initial', createdAt: serverTimestamp(),
          });
        }
      }
      await batch.commit();
      doneCount += chunk.length;
      setImportProgress({ done: doneCount, total: toImport.length });
    }

    setResult({
      created: toImport.length,
      skipped: skippedExisting,
      categoriesCreated: newCatNames,
    });
    setStep('done');
  };

  const storeName = stores?.find(s => s.id === selectedStoreId)?.name;

  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.push('/products')}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Retour
          </Button>
          <h1 className="text-xl font-bold text-gray-900">Importer des produits en masse</h1>
        </div>

        {/* ── Étape 1 : saisie ──────────────────────────────────────────── */}
        {step === 'input' && (
          <Card>
            <CardContent className="p-6 space-y-5">
              <div>
                <Label className="mb-2 block">Magasin pour le stock initial</Label>
                <Select value={selectedStoreId} onValueChange={setSelectedStoreId}>
                  <SelectTrigger className="max-w-sm"><SelectValue placeholder="Choisir un magasin" /></SelectTrigger>
                  <SelectContent>
                    {(stores || []).map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-500 mt-1">
                  Les quantités "Stock Initial" de ton fichier seront créées dans ce magasin.
                </p>
              </div>

              <Button variant="outline" size="sm" onClick={handleDownloadTemplate}>
                <Download className="h-4 w-4 mr-1.5" /> Télécharger le modèle Excel
              </Button>

              <Tabs defaultValue="paste">
                <TabsList>
                  <TabsTrigger value="paste"><ClipboardPaste className="h-4 w-4 mr-1.5" />Coller depuis Excel</TabsTrigger>
                  <TabsTrigger value="file"><Upload className="h-4 w-4 mr-1.5" />Importer un fichier</TabsTrigger>
                </TabsList>

                <TabsContent value="paste" className="space-y-3 pt-3">
                  <Textarea
                    rows={10}
                    placeholder={'Copie une plage de cellules dans Excel (avec la ligne d\'en-tête : SKU, Nom, Catégorie, Prix Achat, Prix Vente, Stock Initial...) puis colle ici (Ctrl+V)'}
                    value={pasteText}
                    onChange={e => setPasteText(e.target.value)}
                    className="font-mono text-xs"
                  />
                  <Button onClick={handlePasteSubmit} disabled={!pasteText.trim()}>
                    Analyser
                  </Button>
                </TabsContent>

                <TabsContent value="file" className="pt-3">
                  <div
                    className="border-2 border-dashed border-gray-300 rounded-lg p-10 text-center cursor-pointer hover:border-primary-400 transition-colors"
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => {
                      e.preventDefault();
                      const f = e.dataTransfer.files?.[0];
                      if (f) handleFile(f);
                    }}
                  >
                    <FileSpreadsheet className="h-10 w-10 mx-auto text-gray-400 mb-2" />
                    <p className="text-sm text-gray-600">
                      {isParsing ? 'Lecture du fichier…' : 'Clique ou dépose un fichier .xlsx ou .csv'}
                    </p>
                    <input
                      ref={fileInputRef} type="file" accept=".xlsx,.csv"
                      className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                    />
                  </div>
                </TabsContent>
              </Tabs>

              {parseError && (
                <Alert className="border-red-200 bg-red-50">
                  <XCircle className="h-4 w-4 text-red-600" />
                  <AlertDescription className="text-red-700">{parseError}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── Étape 2 : prévisualisation ────────────────────────────────── */}
        {step === 'preview' && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-3">
              <Badge className="bg-green-100 text-green-800 border-green-200">
                <CheckCircle2 className="h-3 w-3 mr-1" /> {validRows.length} ligne(s) valide(s)
              </Badge>
              {invalidRows.length > 0 && (
                <Badge className="bg-red-100 text-red-800 border-red-200">
                  <XCircle className="h-3 w-3 mr-1" /> {invalidRows.length} ligne(s) en erreur (ignorées)
                </Badge>
              )}
              {duplicateSkusInFile.size > 0 && (
                <Badge className="bg-amber-100 text-amber-800 border-amber-200">
                  <AlertTriangle className="h-3 w-3 mr-1" /> {duplicateSkusInFile.size} SKU dupliqué(s) dans le fichier (1 seul gardé)
                </Badge>
              )}
              <Badge variant="outline">Stock initial → {storeName || 'magasin non sélectionné'}</Badge>
            </div>

            {quotaError && (
              <Alert className="border-red-200 bg-red-50">
                <XCircle className="h-4 w-4 text-red-600" />
                <AlertDescription className="text-red-700">{quotaError}</AlertDescription>
              </Alert>
            )}

            <Card>
              <CardContent className="p-0 max-h-[500px] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-14">Ligne</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead>Nom</TableHead>
                      <TableHead>Catégorie</TableHead>
                      <TableHead className="text-right">Prix vente</TableHead>
                      <TableHead className="text-right">Stock initial</TableHead>
                      <TableHead>Statut</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map(r => (
                      <TableRow key={r.rowIndex} className={r.errors.length > 0 ? 'bg-red-50' : duplicateSkusInFile.has(r.sku) ? 'bg-amber-50' : ''}>
                        <TableCell className="text-xs text-gray-400">{r.rowIndex}</TableCell>
                        <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                        <TableCell>{r.name || <span className="text-gray-400 italic">—</span>}</TableCell>
                        <TableCell>{r.categoryName || <span className="text-gray-400">—</span>}</TableCell>
                        <TableCell className="text-right">{r.sellingPrice ? formatCurrency(r.sellingPrice) : '—'}</TableCell>
                        <TableCell className="text-right">{r.initialStock}</TableCell>
                        <TableCell>
                          {r.errors.length > 0 ? (
                            <span className="text-xs text-red-600">{r.errors.join(', ')}</span>
                          ) : r.warnings.length > 0 ? (
                            <span className="text-xs text-amber-600">{r.warnings.join(', ')}</span>
                          ) : (
                            <span className="text-xs text-green-600">OK</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => { setStep('input'); setRows([]); }}>Recommencer</Button>
              <Button onClick={handleImport} disabled={validRows.length === 0 || !selectedStoreId}>
                Importer {validRows.length} produit(s)
              </Button>
            </div>
          </div>
        )}

        {/* ── Étape 3 : import en cours ─────────────────────────────────── */}
        {step === 'importing' && (
          <Card>
            <CardContent className="p-10 text-center space-y-3">
              <RefreshCw className="h-8 w-8 mx-auto animate-spin text-primary-600" />
              <p className="text-sm text-gray-600">
                Import en cours… {importProgress.done} / {importProgress.total}
              </p>
            </CardContent>
          </Card>
        )}

        {/* ── Étape 4 : terminé ─────────────────────────────────────────── */}
        {step === 'done' && result && (
          <Card>
            <CardContent className="p-8 text-center space-y-4">
              <CheckCircle2 className="h-12 w-12 mx-auto text-green-600" />
              <div>
                <p className="text-lg font-bold text-gray-900">{result.created} produit(s) importé(s)</p>
                {result.categoriesCreated.length > 0 && (
                  <p className="text-sm text-gray-600 mt-1">
                    Nouvelles catégories créées : {result.categoriesCreated.join(', ')}
                  </p>
                )}
                {result.skipped.length > 0 && (
                  <p className="text-sm text-amber-600 mt-1">
                    {result.skipped.length} ligne(s) ignorée(s) — SKU déjà existant dans le catalogue.
                  </p>
                )}
              </div>
              <div className="flex gap-2 justify-center pt-2">
                <Button variant="outline" onClick={() => { setStep('input'); setRows([]); setPasteText(''); setResult(null); }}>
                  Importer d'autres produits
                </Button>
                <Button onClick={() => router.push('/products')}>Voir le catalogue</Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
