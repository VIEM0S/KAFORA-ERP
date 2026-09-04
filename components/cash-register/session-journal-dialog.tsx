'use client';

import { useState, useEffect } from 'react';
import { Printer, Download, RefreshCw, Receipt } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/lib/supabase/client';
import { mapSale, mapCreditPayment, mapSaleReturn } from '@/lib/supabase/mappers';
import { formatCurrency, formatDateTime } from '@/lib/utils/helpers';
import { exportToCsv } from '@/lib/utils/export';
import type { CashRegisterSession } from '@/lib/types';

const METHOD_LABELS: Record<string, string> = {
  CASH: 'Espèces', MOBILE_MONEY: 'Mobile Money', BANK_TRANSFER: 'Virement',
  CARD: 'Carte bancaire', CREDIT: 'Crédit', SPLIT: 'Mixte',
};

const TYPE_LABELS: Record<JournalEntry['type'], string> = {
  SALE: 'Vente', PAYMENT: 'Versement', RETURN: 'Remboursement',
};

interface JournalEntry {
  id: string;
  time: Date;
  type: 'SALE' | 'PAYMENT' | 'RETURN';
  reference: string;
  detail: string;
  method: string;
  amount: number; // remboursement = négatif
  note?: string;
}

interface SessionJournalDialogProps {
  tenantId: string;
  storeId: string;
  session: CashRegisterSession;
  onOpenChange: (open: boolean) => void;
}

/**
 * Journal détaillé d'une session de caisse — chaque transaction individuelle
 * (vente, versement de dette, remboursement) qu'un caissier/manager a
 * traitée, imprimable et exportable. Demandé explicitement (2026-09-03),
 * sur le modèle du journal qu'une agence bancaire imprime à la clôture pour
 * rapprocher pièce par pièce contre les chèques/bordereaux physiques — la
 * page Caisse elle-même n'affiche qu'un TOTAL agrégé (voir close_cash_
 * register migration 047), jamais le détail ligne par ligne : un écart de
 * caisse restait un chiffre qu'on ne pouvait pas expliquer.
 *
 * N'existait pas de façon fiable avant la migration 047 : avec une seule
 * caisse partagée par magasin, impossible de savoir avec certitude quelles
 * transactions appartenaient à quel titulaire précis.
 */
export function SessionJournalDialog({ tenantId, storeId, session, onOpenChange }: SessionJournalDialogProps) {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // openedBy ne devrait jamais être null en pratique (toute session vient
    // d'un open_cash_register() qui l'exige), mais le type le permet — sans
    // titulaire, aucune transaction ne peut lui être attribuée avec
    // certitude, donc journal vide plutôt qu'une requête non filtrée.
    if (!session.openedBy) { setEntries([]); setIsLoading(false); return; }
    const openedBy = session.openedBy;
    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      const sinceIso = session.openedAt.toISOString();
      const untilIso = session.closedAt ? session.closedAt.toISOString() : null;

      let salesQuery = supabase.from('sales').select('*').eq('tenant_id', tenantId).eq('store_id', storeId)
        .eq('cashier_id', openedBy).eq('status', 'COMPLETED').gte('created_at', sinceIso);
      if (untilIso) salesQuery = salesQuery.lte('created_at', untilIso);

      let paymentsQuery = supabase.from('credit_payments').select('*').eq('tenant_id', tenantId).eq('store_id', storeId)
        .eq('user_id', openedBy).gte('created_at', sinceIso);
      if (untilIso) paymentsQuery = paymentsQuery.lte('created_at', untilIso);

      let returnsQuery = supabase.from('sale_returns').select('*').eq('tenant_id', tenantId).eq('store_id', storeId)
        .eq('processed_by', openedBy).gte('created_at', sinceIso);
      if (untilIso) returnsQuery = returnsQuery.lte('created_at', untilIso);

      const [salesRes, paymentsRes, returnsRes] = await Promise.all([salesQuery, paymentsQuery, returnsQuery]);
      if (cancelled) return;

      const sales = (salesRes.data ?? []).map(r => mapSale(r));
      const payments = (paymentsRes.data ?? []).map(r => mapCreditPayment(r));
      const returns = (returnsRes.data ?? []).map(r => mapSaleReturn(r));

      // credit_payments ne porte pas le nom du client directement (juste
      // creditId) — un petit lookup groupé plutôt qu'une requête par ligne.
      const creditIds = Array.from(new Set(payments.map(p => p.creditId)));
      let creditNames: Record<string, string> = {};
      if (creditIds.length > 0) {
        const { data: credits } = await supabase.from('credits').select('id, customer_name').in('id', creditIds);
        creditNames = Object.fromEntries((credits ?? []).map(c => [c.id, c.customer_name || 'Client']));
      }
      if (cancelled) return;

      const list: JournalEntry[] = [
        ...sales.map((s): JournalEntry => ({
          id: `sale-${s.id}`, time: s.createdAt, type: 'SALE', reference: s.reference,
          detail: s.customerName || 'Client comptoir', method: s.paymentMethod,
          // Vente à crédit : seul l'acompte réellement reçu compte pour le
          // rapprochement — le solde n'est pas passé entre les mains du
          // caissier (voir close_cash_register, même logique).
          amount: s.paymentMethod === 'CREDIT' ? s.paidAmount : s.total,
          note: s.paymentMethod === 'CREDIT' && s.paidAmount < s.total
            ? `Acompte sur vente de ${formatCurrency(s.total)}` : undefined,
        })),
        ...payments.map((p): JournalEntry => ({
          id: `pay-${p.id}`, time: p.createdAt, type: 'PAYMENT', reference: p.reference || '—',
          detail: creditNames[p.creditId] || 'Client', method: p.paymentMethod, amount: p.amount,
        })),
        ...returns.map((r): JournalEntry => ({
          id: `ret-${r.id}`, time: r.createdAt, type: 'RETURN', reference: r.saleReference,
          detail: r.processedByName || '—', method: r.refundMethod, amount: -r.refundAmount,
        })),
      ].sort((a, b) => a.time.getTime() - b.time.getTime());

      setEntries(list);
      setIsLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, [tenantId, storeId, session.openedBy, session.openedAt, session.closedAt]);

  const totalsByMethod = entries.reduce<Record<string, number>>((acc, e) => {
    acc[e.method] = (acc[e.method] || 0) + e.amount;
    return acc;
  }, {});

  const handleExport = () => exportToCsv(
    `journal-caisse-${session.openedByName || 'session'}-${new Date(session.openedAt).toISOString().slice(0, 10)}`,
    entries,
    [
      { key: 'time', label: 'Heure', format: (v) => formatDateTime(v as Date) },
      { key: 'type', label: 'Type', format: (v) => TYPE_LABELS[v as JournalEntry['type']] },
      { key: 'reference', label: 'Référence' },
      { key: 'detail', label: 'Client' },
      { key: 'method', label: 'Mode', format: (v) => METHOD_LABELS[v as string] || String(v) },
      { key: 'amount', label: 'Montant' },
      { key: 'note', label: 'Note' },
    ]
  );

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader className="print:hidden">
          <DialogTitle className="flex items-center gap-2"><Receipt className="h-5 w-5" />Journal de caisse — {session.openedByName || 'Utilisateur'}</DialogTitle>
        </DialogHeader>

        {/* En-tête visible seulement à l'impression : le dialog lui-même n'a
            pas de sens sur papier, mais le journal doit s'identifier seul. */}
        <div className="hidden print:block mb-4">
          <p className="font-bold text-lg">Journal de caisse — {session.openedByName || 'Utilisateur'}</p>
          <p className="text-sm text-gray-600">
            Ouverte le {formatDateTime(session.openedAt)}
            {session.closedAt ? ` · Fermée le ${formatDateTime(session.closedAt)}` : ' · Session en cours'}
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between print:hidden">
          <p className="text-sm text-gray-500">
            {formatDateTime(session.openedAt)}
            {session.closedAt ? ` → ${formatDateTime(session.closedAt)}` : ' → en cours'}
          </p>
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
            <Receipt className="h-10 w-10 mb-3 opacity-30" />
            <p className="text-sm">Aucune transaction sur cette session pour le moment</p>
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Heure</TableHead>
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

            {/* Totaux par mode : ce qu'on rapproche réellement — les espèces
                contre le comptage physique, chaque autre mode contre sa
                propre pièce justificative (reçu Mobile Money, relevé de
                carte, bordereau de crédit signé...), exactement le principe
                décrit par l'utilisateur pour le rapprochement en agence. */}
            <div className="mt-4 pt-4 border-t space-y-1.5">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Totaux par mode de paiement</p>
              {Object.entries(totalsByMethod).map(([method, total]) => (
                <div key={method} className="flex justify-between text-sm">
                  <span className="text-gray-600">{METHOD_LABELS[method] || method}</span>
                  <span className="font-medium text-gray-900">{formatCurrency(total)}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
