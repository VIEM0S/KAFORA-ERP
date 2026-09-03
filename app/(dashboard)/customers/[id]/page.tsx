'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, Phone, Mail, MapPin, CreditCard,
  ShoppingBag, FileText, RefreshCw, User, Building2
} from 'lucide-react';
import { DashboardLayout } from '@/components/layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils/helpers';
import { useAuthStore } from '@/hooks/store';
import { useDataErrors } from '@/hooks/use-data-errors';
import { supabase } from '@/lib/supabase/client';
import { mapCustomer, mapSale, mapCredit, mapQuote, mapAuditLog } from '@/lib/supabase/mappers';
import type { Customer, Sale, Credit, Quote, AuditLogEntry } from '@/lib/types';

// Piste d'audit (migration 045) — ce qui alimente cet onglet pour un
// client : uniquement les changements de limite de crédit aujourd'hui.
const AUDIT_ACTION_LABELS: Record<string, string> = {
  CREDIT_LIMIT_CHANGED: 'Limite de crédit modifiée',
};

const CREDIT_STATUS: Record<string, { label: string; color: string }> = {
  PENDING:        { label: 'En cours',  color: 'bg-amber-100 text-amber-700' },
  PARTIALLY_PAID: { label: 'Partiel',   color: 'bg-blue-100 text-blue-700' },
  PAID:           { label: 'Soldé',     color: 'bg-green-100 text-green-700' },
  OVERDUE:        { label: 'En retard', color: 'bg-red-100 text-red-700' },
};

// Mêmes libellés que app/(dashboard)/quotes/page.tsx (STATUS_CONFIG) — sans
// quoi cet onglet affichait le statut brut ("CONVERTED", "ACCEPTED"...) au
// lieu du libellé français utilisé partout ailleurs dans l'app.
const QUOTE_STATUS: Record<string, { label: string; color: string }> = {
  PENDING:   { label: 'En attente', color: 'bg-amber-100 text-amber-700' },
  ACCEPTED:  { label: 'Accepté',    color: 'bg-blue-100 text-blue-700' },
  CONVERTED: { label: 'Converti',   color: 'bg-green-100 text-green-700' },
  REFUSED:   { label: 'Refusé',     color: 'bg-red-100 text-red-700' },
  EXPIRED:   { label: 'Expiré',     color: 'bg-gray-100 text-gray-500' },
};

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { tenant } = useAuthStore();
  const tenantId = tenant?.id;

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [credits, setCredits] = useState<Credit[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [auditTrail, setAuditTrail] = useState<AuditLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [tab, setTab] = useState<'sales' | 'credits' | 'quotes' | 'audit'>('sales');

  useEffect(() => {
    if (!tenantId || !id) return;
    // Rediriger si id invalide (ex: /customers/new)
    if (id === 'new' || id === 'create') { router.replace('/customers'); return; }

    const { reportError, clearError } = useDataErrors.getState();

    // Charger le client
    supabase.from('customers').select('*').eq('id', id).maybeSingle().then(({ data, error }) => {
      if (error) { reportError('Client', error); setIsLoading(false); return; }
      clearError('Client');
      if (data) setCustomer(mapCustomer(data));
      setIsLoading(false);
    });

    // Charger les ventes du client — bornées aux 100 plus récentes.
    // Sans limite, la fiche d'un client fidèle depuis plusieurs années
    // chargeait tout son historique à chaque ouverture : lent pour lui,
    // coûteux en lectures, et sans utilité — on consulte les dernières
    // transactions, pas celles d'il y a trois ans.
    //
    // Fix : ces trois lectures se faisaient auparavant sans AUCUNE gestion
    // d'erreur (ni .catch, ni écoute onSnapshot) — un refus RLS ou une
    // coupure laissait la fiche silencieusement vide, indiscernable d'un
    // client sans historique. Voir hooks/use-data-errors.ts.
    supabase.from('sales').select('*').eq('customer_id', id).order('created_at', { ascending: false }).limit(100)
      .then(({ data, error }) => {
        if (error) { reportError('Ventes', error); return; }
        clearError('Ventes');
        setSales((data ?? []).map(r => mapSale(r)));
      });

    // Charger les crédits du client
    supabase.from('credits').select('*').eq('customer_id', id).order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) { reportError('Crédits', error); return; }
        clearError('Crédits');
        setCredits((data ?? []).map(r => mapCredit(r)));
      });

    // Charger les devis du client
    supabase.from('quotes').select('*').eq('customer_id', id).order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) { reportError('Devis', error); return; }
        clearError('Devis');
        setQuotes((data ?? []).map(r => mapQuote(r)));
      });

    // Piste d'audit du client (migration 045) — lecture seule (policy
    // audit_log_select réservée aux managers+), échec silencieux pour un
    // Caissier plutôt qu'une erreur qui n'a pas lieu d'être visible.
    supabase.from('audit_log').select('*').eq('entity_type', 'customer').eq('entity_id', id).order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) return;
        setAuditTrail((data ?? []).map(mapAuditLog));
      });
  }, [tenantId, id, router]);

  if (isLoading) return (
    <DashboardLayout>
      <div className="flex items-center justify-center h-64 text-gray-400">
        <RefreshCw className="h-6 w-6 animate-spin mr-2" />Chargement...
      </div>
    </DashboardLayout>
  );

  if (!customer) return (
    <DashboardLayout>
      <div className="text-center py-16 text-gray-500">Client introuvable</div>
    </DashboardLayout>
  );

  const displayName = customer.customerType === 'BUSINESS'
    ? customer.companyName || ''
    : `${customer.firstName || ''} ${customer.lastName || ''}`.trim();

  const totalAchats = sales.filter(s => s.status === 'COMPLETED').reduce((s, v) => s + (v.total || 0), 0);
  const soldeCredit = credits.filter(c => ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'].includes(c.status)).reduce((s, c) => s + c.remainingAmount, 0);

  const TABS = [
    { key: 'sales',   label: `Ventes (${sales.length})` },
    { key: 'credits', label: `Crédits (${credits.length})` },
    { key: 'quotes',  label: `Devis (${quotes.length})` },
    { key: 'audit',   label: `Historique (${auditTrail.length})` },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" onClick={() => router.push('/customers')}>
            <ArrowLeft className="h-4 w-4 mr-2" />Retour
          </Button>
          <div className="flex items-center gap-3">
            <div className={`h-12 w-12 rounded-full flex items-center justify-center text-lg font-bold text-white ${customer.customerType === 'BUSINESS' ? 'bg-purple-500' : 'bg-blue-500'}`}>
              {displayName[0] || '?'}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold text-gray-900">{displayName}</h1>
                <Badge variant={customer.customerType === 'BUSINESS' ? 'secondary' : 'outline'}>
                  {customer.customerType === 'BUSINESS' ? 'Entreprise' : 'Particulier'}
                </Badge>
                {!customer.isActive && <Badge variant="destructive">Inactif</Badge>}
              </div>
              <p className="text-sm text-gray-500">{customer.code}</p>
            </div>
          </div>
        </div>

        {/* Infos + stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card><CardContent className="p-5">
            <h3 className="font-medium text-gray-900 mb-4">Coordonnées</h3>
            <div className="space-y-3 text-sm">
              {customer.phone && <div className="flex items-center gap-2 text-gray-600"><Phone className="h-4 w-4 text-gray-400" />{customer.phone}</div>}
              {customer.email && <div className="flex items-center gap-2 text-gray-600"><Mail className="h-4 w-4 text-gray-400" />{customer.email}</div>}
              {(customer.address || customer.city) && (
                <div className="flex items-center gap-2 text-gray-600">
                  <MapPin className="h-4 w-4 text-gray-400" />
                  {[customer.address, customer.city].filter(Boolean).join(', ')}
                </div>
              )}
              {customer.notes && <p className="text-gray-500 italic border-t pt-3 mt-3">{customer.notes}</p>}
            </div>
          </CardContent></Card>

          <div className="grid grid-cols-2 gap-4">
            {[
              { label: 'Total achats', value: formatCurrency(totalAchats), icon: ShoppingBag, color: 'text-primary-600', bg: 'bg-primary-100' },
              { label: 'Ventes', value: sales.filter(s => s.status === 'COMPLETED').length, icon: ShoppingBag, color: 'text-green-600', bg: 'bg-green-100' },
              { label: 'Solde crédit', value: formatCurrency(soldeCredit), icon: CreditCard, color: soldeCredit > 0 ? 'text-amber-600' : 'text-green-600', bg: 'bg-amber-100' },
              { label: 'Limite crédit', value: formatCurrency(customer.creditLimit || 0), icon: CreditCard, color: 'text-gray-600', bg: 'bg-gray-100' },
            ].map((s, i) => (
              <Card key={i}><CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className={`h-8 w-8 rounded-lg ${s.bg} flex items-center justify-center`}>
                    <s.icon className={`h-4 w-4 ${s.color}`} />
                  </div>
                </div>
                <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-gray-500">{s.label}</p>
              </CardContent></Card>
            ))}
          </div>
        </div>

        {/* Onglets */}
        <div>
          <div className="flex border-b border-gray-200 mb-4">
            {TABS.map(t => (
              <button key={t.key} onClick={() => setTab(t.key as 'sales' | 'credits' | 'quotes' | 'audit')}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  tab === t.key ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                {t.label}
              </button>
            ))}
          </div>

          {/* Ventes */}
          {tab === 'sales' && (
            <Card><CardContent className="p-0">
              {sales.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                  <ShoppingBag className="h-10 w-10 mb-3 opacity-30" />
                  <p className="text-sm">Aucune vente pour ce client</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>N° Vente</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Paiement</TableHead>
                      <TableHead>Statut</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sales.map(s => (
                      <TableRow key={s.id}>
                        <TableCell><code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{s.id.slice(0,8).toUpperCase()}</code></TableCell>
                        <TableCell className="text-sm text-gray-500">{formatDateTime(s.createdAt)}</TableCell>
                        <TableCell className="text-right font-bold">{formatCurrency(s.total)}</TableCell>
                        <TableCell className="text-sm text-gray-500">{s.paymentMethod || '—'}</TableCell>
                        <TableCell>
                          <span className={`text-xs px-2 py-1 rounded-full font-medium ${s.status === 'COMPLETED' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                            {s.status === 'COMPLETED' ? 'Complétée' : 'Annulée'}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent></Card>
          )}

          {/* Crédits */}
          {tab === 'credits' && (
            <Card><CardContent className="p-0">
              {credits.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                  <CreditCard className="h-10 w-10 mb-3 opacity-30" />
                  <p className="text-sm">Aucun crédit pour ce client</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Montant</TableHead>
                      <TableHead className="text-right">Solde restant</TableHead>
                      <TableHead>Échéance</TableHead>
                      <TableHead>Statut</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {credits.map(c => {
                      const cfg = CREDIT_STATUS[c.status] ?? CREDIT_STATUS.PENDING;
                      return (
                        <TableRow key={c.id}>
                          <TableCell className="text-sm text-gray-500">{formatDate(c.createdAt)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(c.totalAmount)}</TableCell>
                          <TableCell className="text-right font-bold text-amber-600">{formatCurrency(c.remainingAmount)}</TableCell>
                          <TableCell className="text-sm">{formatDate(c.dueDate)}</TableCell>
                          <TableCell><span className={`text-xs px-2 py-1 rounded-full font-medium ${cfg.color}`}>{cfg.label}</span></TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent></Card>
          )}

          {/* Devis */}
          {tab === 'quotes' && (
            <Card><CardContent className="p-0">
              {quotes.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                  <FileText className="h-10 w-10 mb-3 opacity-30" />
                  <p className="text-sm">Aucun devis pour ce client</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Validité</TableHead>
                      <TableHead>Statut</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {quotes.map(q => {
                      const cfg = QUOTE_STATUS[q.status] ?? QUOTE_STATUS.PENDING;
                      return (
                        <TableRow key={q.id}>
                          <TableCell className="text-sm text-gray-500">{formatDate(q.createdAt)}</TableCell>
                          <TableCell className="text-right font-bold">{formatCurrency(q.total)}</TableCell>
                          <TableCell className="text-sm">{formatDate(q.validUntil)}</TableCell>
                          <TableCell><span className={`text-xs px-2 py-1 rounded-full font-medium ${cfg.color}`}>{cfg.label}</span></TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent></Card>
          )}

          {/* Historique — piste d'audit (migration 045), aujourd'hui limitée
              aux changements de limite de crédit. */}
          {tab === 'audit' && (
            <Card><CardContent className="p-0">
              {auditTrail.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                  <CreditCard className="h-10 w-10 mb-3 opacity-30" />
                  <p className="text-sm">Aucun changement enregistré pour ce client</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Par</TableHead>
                      <TableHead>Détail</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {auditTrail.map(entry => (
                      <TableRow key={entry.id}>
                        <TableCell className="text-sm text-gray-500">{formatDateTime(entry.createdAt)}</TableCell>
                        <TableCell className="text-sm font-medium">{AUDIT_ACTION_LABELS[entry.action] || entry.action}</TableCell>
                        <TableCell className="text-sm text-gray-500">{entry.actorName || '—'}</TableCell>
                        <TableCell className="text-sm text-gray-500">
                          {typeof entry.details?.previous_limit === 'number' && typeof entry.details?.new_limit === 'number'
                            ? `${formatCurrency(entry.details.previous_limit as number)} → ${formatCurrency(entry.details.new_limit as number)}`
                            : '—'}
                          {typeof entry.details?.reason === 'string' && entry.details.reason && (
                            <span className="text-gray-400 italic"> · « {entry.details.reason as string} »</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent></Card>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
