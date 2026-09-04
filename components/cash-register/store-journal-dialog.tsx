'use client';

import { useState, useEffect } from 'react';
import { Printer, Download, RefreshCw, BookOpen } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/lib/supabase/client';
import { mapSale, mapCreditPayment, mapSaleReturn } from '@/lib/supabase/mappers';
import { formatCurrency, formatDateTime } from '@/lib/utils/helpers';
import { exportToCsv } from '@/lib/utils/export';

const METHOD_LABELS: Record<string, string> = {
  CASH: 'Espèces', MOBILE_MONEY: 'Mobile Money', BANK_TRANSFER: 'Virement',
  CARD: 'Carte bancaire', CREDIT: 'Crédit', SPLIT: 'Mixte',
};

const TYPE_LABELS: Record<StoreJournalEntry['type'], string> = {
  SALE: 'Vente', PAYMENT: 'Versement', RETURN: 'Remboursement',
};

interface StoreJournalEntry {
  id: string;
  time: Date;
  type: 'SALE' | 'PAYMENT' | 'RETURN';
  reference: string;
  detail: string;
  cashierName: string;
  method: string;
  amount: number; // remboursement = négatif
  note?: string;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface StoreJournalDialogProps {
  tenantId: string;
  storeId: string;
  storeName: string;
  onOpenChange: (open: boolean) => void;
}

/**
 * Journal consolidé du MAGASIN — toutes les transactions de la journée,
 * de tous les caissiers confondus, contrairement à SessionJournalDialog
 * (une seule caisse/un seul titulaire). Demandé explicitement (2026-09-03)
 * en complément du journal par caisse : le responsable d'agence a besoin
 * des deux, le détail par tiroir ET la vue d'ensemble de la journée du
 * magasin pour la clôture globale.
 */
export function StoreJournalDialog({ tenantId, storeId, storeName, onOpenChange }: StoreJournalDialogProps) {
  const [dateStr, setDateStr] = useState(todayStr());
  const [entries, setEntries] = useState<StoreJournalEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      const start = new Date(`${dateStr}T00:00:00`);
      const end = new Date(`${dateStr}T23:59:59.999`);

      const [salesRes, paymentsRes, returnsRes] = await Promise.all([
        supabase.from('sales').select('*').eq('tenant_id', tenantId).eq('store_id', storeId)
          .eq('status', 'COMPLETED').gte('created_at', start.toISOString()).lte('created_at', end.toISOString()),
        supabase.from('credit_payments').select('*').eq('tenant_id', tenantId).eq('store_id', storeId)
          .gte('created_at', start.toISOString()).lte('created_at', end.toISOString()),
        supabase.from('sale_returns').select('*').eq('tenant_id', tenantId).eq('store_id', storeId)
          .gte('created_at', start.toISOString()).lte('created_at', end.toISOString()),
      ]);
      if (cancelled) return;

      const sales = (salesRes.data ?? []).map(r => mapSale(r));
      const payments = (paymentsRes.data ?? []).map(r => mapCreditPayment(r));
      const returns = (returnsRes.data ?? []).map(r => mapSaleReturn(r));

      // sales ne porte pas le nom du caissier (juste cashierId) — lookup
      // groupé, comme le nom client pour les versements dans
      // session-journal-dialog.tsx.
      const cashierIds = Array.from(new Set(sales.map(s => s.cashierId).filter(Boolean)));
      let cashierNames: Record<string, string> = {};
      if (cashierIds.length > 0) {
        const { data: users } = await supabase.from('users').select('id, first_name, last_name').in('id', cashierIds);
        cashierNames = Object.fromEntries((users ?? []).map(u => [u.id, `${u.first_name || ''} ${u.last_name || ''}`.trim() || 'Utilisateur']));
      }

      const creditIds = Array.from(new Set(payments.map(p => p.creditId)));
      let creditNames: Record<string, string> = {};
      if (creditIds.length > 0) {
        const { data: credits } = await supabase.from('credits').select('id, customer_name').in('id', creditIds);
        creditNames = Object.fromEntries((credits ?? []).map(c => [c.id, c.customer_name || 'Client']));
      }
      if (cancelled) return;

      const list: StoreJournalEntry[] = [
        ...sales.map((s): StoreJournalEntry => ({
          id: `sale-${s.id}`, time: s.createdAt, type: 'SALE', reference: s.reference,
          detail: s.customerName || 'Client comptoir', cashierName: cashierNames[s.cashierId] || '—',
          method: s.paymentMethod, amount: s.paymentMethod === 'CREDIT' ? s.paidAmount : s.total,
          note: s.paymentMethod === 'CREDIT' && s.paidAmount < s.total
            ? `Acompte sur vente de ${formatCurrency(s.total)}` : undefined,
        })),
        ...payments.map((p): StoreJournalEntry => ({
          id: `pay-${p.id}`, time: p.createdAt, type: 'PAYMENT', reference: p.reference || '—',
          detail: creditNames[p.creditId] || 'Client', cashierName: p.userName || '—',
          method: p.paymentMethod, amount: p.amount,
        })),
        ...returns.map((r): StoreJournalEntry => ({
          id: `ret-${r.id}`, time: r.createdAt, type: 'RETURN', reference: r.saleReference,
          detail: r.processedByName || '—', cashierName: r.processedByName || '—',
          method: r.refundMethod, amount: -r.refundAmount,
        })),
      ].sort((a, b) => a.time.getTime() - b.time.getTime());

      setEntries(list);
      setIsLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, [tenantId, storeId, dateStr]);

  const totalsByMethod = entries.reduce<Record<string, number>>((acc, e) => {
    acc[e.method] = (acc[e.method] || 0) + e.amount;
    return acc;
  }, {});
  const totalsByCashier = entries.reduce<Record<string, number>>((acc, e) => {
    acc[e.cashierName] = (acc[e.cashierName] || 0) + e.amount;
    return acc;
  }, {});

  const handleExport = () => exportToCsv(
    `journal-magasin-${storeName}-${dateStr}`,
    entries,
    [
      { key: 'time', label: 'Heure', format: (v) => formatDateTime(v as Date) },
      { key: 'cashierName', label: 'Caissier' },
      { key: 'type', label: 'Type', format: (v) => TYPE_LABELS[v as StoreJournalEntry['type']] },
      { key: 'reference', label: 'Référence' },
      { key: 'detail', label: 'Client' },
      { key: 'method', label: 'Mode', format: (v) => METHOD_LABELS[v as string] || String(v) },
      { key: 'amount', label: 'Montant' },
      { key: 'note', label: 'Note' },
    ]
  );

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader className="print:hidden">
          <DialogTitle className="flex items-center gap-2"><BookOpen className="h-5 w-5" />Journal du magasin — {storeName}</DialogTitle>
        </DialogHeader>

        <div className="hidden print:block mb-4">
          <p className="font-bold text-lg">Journal du magasin — {storeName}</p>
          <p className="text-sm text-gray-600">Journée du {dateStr}</p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between print:hidden">
          <div className="flex items-center gap-2">
            <Label className="text-sm text-gray-500">Journée du</Label>
            <Input type="date" value={dateStr} onChange={e => setDateStr(e.target.value)} className="w-40" max={todayStr()} />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleExport} disabled={entries.length === 0}>
              <Download className="h-4 w-4 mr-1.5" />CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.print()} disabled={entries.length === 0}>
              <Printer className="h-4 w-4 mr-1.5" />Imprimer
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-gray-400">
            <RefreshCw className="h-5 w-5 animate-spin mr-2" />Chargement du journal...
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400">
            <BookOpen className="h-10 w-10 mb-3 opacity-30" />
            <p className="text-sm">Aucune transaction ce jour-là</p>
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Heure</TableHead>
                  <TableHead>Caissier</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Référence</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead className="text-right">Montant</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map(e => (
                  <TableRow key={e.id}>
                    <TableCell className="text-sm text-gray-500 whitespace-nowrap">{formatDateTime(e.time)}</TableCell>
                    <TableCell className="text-sm text-gray-700">{e.cashierName}</TableCell>
                    <TableCell className="text-sm">{TYPE_LABELS[e.type]}</TableCell>
                    <TableCell className="text-xs"><code className="bg-gray-100 px-1.5 py-0.5 rounded">{e.reference}</code></TableCell>
                    <TableCell className="text-sm text-gray-600">{e.detail}</TableCell>
                    <TableCell className="text-sm text-gray-600">{METHOD_LABELS[e.method] || e.method}</TableCell>
                    <TableCell className={`text-right text-sm font-medium ${e.amount < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                      {e.amount < 0 ? '−' : ''}{formatCurrency(Math.abs(e.amount))}
                      {e.note && <p className="text-xs font-normal text-gray-400">{e.note}</p>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="mt-4 pt-4 border-t grid grid-cols-2 gap-6">
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Totaux par mode de paiement</p>
                {Object.entries(totalsByMethod).map(([method, total]) => (
                  <div key={method} className="flex justify-between text-sm">
                    <span className="text-gray-600">{METHOD_LABELS[method] || method}</span>
                    <span className="font-medium text-gray-900">{formatCurrency(total)}</span>
                  </div>
                ))}
              </div>
              {/* Ce que le RA compare vraiment, caisse par caisse — même
                  principe que le rapprochement décrit par l'utilisateur,
                  mais vu depuis la journée entière du magasin. */}
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Totaux par caissier</p>
                {Object.entries(totalsByCashier).map(([name, total]) => (
                  <div key={name} className="flex justify-between text-sm">
                    <span className="text-gray-600">{name}</span>
                    <span className="font-medium text-gray-900">{formatCurrency(total)}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
