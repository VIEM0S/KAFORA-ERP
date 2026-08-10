import { useState } from 'react';
import { ShieldAlert, Check, X, Clock, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import type { DeletionRequest, CurrentUser } from './types';

type RespondAction = 'approve' | 'reject' | 'delete_now' | 'revoke_approval';

interface DeletionRequestsSectionProps {
  tenantId: string | undefined;
  deletionRequests: DeletionRequest[];
  currentUser: CurrentUser | null | undefined;
}

export function DeletionRequestsSection({ tenantId, deletionRequests, currentUser }: DeletionRequestsSectionProps) {
  const { toast } = useToast();
  const [respondingTo, setRespondingTo] = useState<{ req: DeletionRequest; action: RespondAction } | null>(null);
  const [responseNote, setResponseNote] = useState('');
  const [isResponding, setIsResponding] = useState(false);
  const [isCancellingRequest, setIsCancellingRequest] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);

  const pendingForOwner = currentUser?.role === 'OWNER'
    ? deletionRequests.filter(r => r.status === 'PENDING') : [];
  const approvedPendingFinalization = currentUser?.role === 'OWNER'
    ? deletionRequests.filter(r => r.status === 'APPROVED') : [];
  const approvedForAdmin = currentUser?.role === 'ADMIN'
    ? deletionRequests.filter(r => r.status === 'APPROVED' && r.requestedBy === currentUser?.id) : [];
  const myPending = currentUser?.role === 'ADMIN'
    ? deletionRequests.filter(r => r.status === 'PENDING' && r.requestedBy === currentUser?.id) : [];

  const handleCancelOwnRequest = async (req: DeletionRequest) => {
    setIsCancellingRequest(true);
    try {
      const res = await fetch('/api/users/deletion-requests/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: req.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur');
      toast({ title: 'Demande retirée', description: `Ta demande concernant ${req.targetUserName} a été annulée.` });
    } catch (e) {
      toast({ title: 'Erreur', description: e instanceof Error ? e.message : 'Erreur interne', variant: 'destructive' });
    } finally { setIsCancellingRequest(false); }
  };

  const handleFinalizeApproved = async (req: DeletionRequest) => {
    if (!tenantId) return;
    setIsFinalizing(true);
    try {
      const res = await fetch('/api/users/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, uid: req.targetUserId, requestId: req.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur lors de la suppression');
      toast({ title: 'Compte désactivé', description: `${req.targetUserName} a été désactivé (restaurable depuis la liste).` });
    } catch (e) {
      toast({ title: 'Erreur', description: e instanceof Error ? e.message : 'Erreur interne', variant: 'destructive' });
    } finally { setIsFinalizing(false); }
  };

  const handleRespondToRequest = async () => {
    if (!respondingTo) return;
    setIsResponding(true);
    try {
      const res = await fetch('/api/users/deletion-requests/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: respondingTo.req.id, action: respondingTo.action, note: responseNote.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur');
      const labels = { approve: 'approuvée', reject: 'refusée', delete_now: 'traitée directement', revoke_approval: 'ramenée en attente' };
      toast({ title: 'Demande ' + labels[respondingTo.action], description: `${respondingTo.req.targetUserName}` });
      setRespondingTo(null);
      setResponseNote('');
    } catch (e) {
      toast({ title: 'Erreur', description: e instanceof Error ? e.message : 'Erreur interne', variant: 'destructive' });
    } finally { setIsResponding(false); }
  };

  const hasAnything = pendingForOwner.length > 0 || approvedPendingFinalization.length > 0
    || approvedForAdmin.length > 0 || myPending.length > 0;

  return (
    <>
      {hasAnything && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-amber-900">
              <ShieldAlert className="h-4 w-4" /> Demandes de suppression
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {pendingForOwner.map(req => (
              <div key={req.id} className="flex items-center justify-between gap-3 bg-white rounded-lg border border-amber-200 px-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 truncate">
                    {req.targetUserName} <span className="text-gray-400 font-normal">({req.targetUserRole})</span>
                  </p>
                  <p className="text-xs text-gray-500 truncate">Demandé par {req.requestedByName} — &quot;{req.reason}&quot;</p>
                </div>
                <div className="flex gap-1.5 flex-shrink-0">
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setRespondingTo({ req, action: 'reject' })}>
                    <X className="h-3 w-3 mr-1" />Refuser
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setRespondingTo({ req, action: 'approve' })}>
                    <Check className="h-3 w-3 mr-1" />Approuver
                  </Button>
                  <Button size="sm" className="h-7 text-xs bg-red-600 hover:bg-red-700" onClick={() => setRespondingTo({ req, action: 'delete_now' })}>
                    Supprimer moi-même
                  </Button>
                </div>
              </div>
            ))}
            {approvedPendingFinalization.map(req => (
              <div key={req.id} className="flex items-center justify-between gap-3 bg-white rounded-lg border border-green-200 px-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 truncate">
                    {req.targetUserName} <span className="text-gray-400 font-normal">({req.targetUserRole})</span>
                  </p>
                  <p className="text-xs text-gray-500 truncate">Approuvé — en attente que {req.requestedByName} finalise</p>
                </div>
                <Button size="sm" variant="outline" className="h-7 text-xs flex-shrink-0" onClick={() => setRespondingTo({ req, action: 'revoke_approval' })}>
                  Retirer l&apos;approbation
                </Button>
              </div>
            ))}
            {approvedForAdmin.map(req => (
              <div key={req.id} className="flex items-center justify-between gap-3 bg-white rounded-lg border border-green-200 px-3 py-2.5 text-sm">
                <p className="text-gray-900">
                  <strong>{req.targetUserName}</strong> — approuvé par le Propriétaire, tu peux finaliser
                </p>
                <div className="flex gap-1.5">
                  <Button size="sm" variant="ghost" className="h-7 text-xs text-gray-500" disabled={isCancellingRequest} onClick={() => handleCancelOwnRequest(req)}>
                    Annuler
                  </Button>
                  <Button size="sm" className="h-7 text-xs bg-red-600 hover:bg-red-700" disabled={isFinalizing} onClick={() => handleFinalizeApproved(req)}>
                    Finaliser la suppression
                  </Button>
                </div>
              </div>
            ))}
            {myPending.map(req => (
              <div key={req.id} className="flex items-center justify-between gap-2 text-sm text-gray-600 px-3 py-2">
                <div className="flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5 flex-shrink-0" />
                  Demande pour <strong className="mx-1">{req.targetUserName}</strong> en attente de validation du Propriétaire.
                </div>
                <Button size="sm" variant="ghost" className="h-7 text-xs text-gray-500" disabled={isCancellingRequest} onClick={() => handleCancelOwnRequest(req)}>
                  Retirer ma demande
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <AlertDialog open={!!respondingTo} onOpenChange={(open) => { if (!open) { setRespondingTo(null); setResponseNote(''); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {respondingTo?.action === 'approve' && 'Approuver la demande ?'}
              {respondingTo?.action === 'reject' && 'Refuser la demande ?'}
              {respondingTo?.action === 'delete_now' && 'Traiter directement ?'}
              {respondingTo?.action === 'revoke_approval' && "Retirer l'approbation ?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {respondingTo?.action === 'approve' && <>L&apos;Admin pourra finaliser la suppression de <strong>{respondingTo.req.targetUserName}</strong> depuis sa fiche.</>}
              {respondingTo?.action === 'reject' && <>La demande concernant <strong>{respondingTo.req.targetUserName}</strong> sera classée sans suite.</>}
              {respondingTo?.action === 'delete_now' && <>Le compte de <strong>{respondingTo.req.targetUserName}</strong> sera désactivé immédiatement (connexion bloquée), et restaurable à tout moment depuis la liste des utilisateurs. L&apos;Admin qui a fait la demande sera informé que c&apos;est réglé.</>}
              {respondingTo?.action === 'revoke_approval' && <>L&apos;approbation pour <strong>{respondingTo.req.targetUserName}</strong> est annulée — {respondingTo.req.requestedByName} ne pourra plus finaliser cette suppression. Utile si une réconciliation a eu lieu entre-temps.</>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="respond-note">Note (optionnelle)</Label>
            <Textarea id="respond-note" value={responseNote} onChange={e => setResponseNote(e.target.value)} rows={2} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isResponding}>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleRespondToRequest} disabled={isResponding} className={['reject', 'revoke_approval'].includes(respondingTo?.action || '') ? '' : 'bg-red-600 hover:bg-red-700'}>
              {isResponding ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : 'Confirmer'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
