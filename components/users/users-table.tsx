import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, Pencil, Trash2, Activity } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDate } from '@/lib/utils/helpers';
import { useToast } from '@/hooks/use-toast';
import { isSubsetOf } from '@/lib/api/regional-scope';
import { RoleBadge } from './role-badge';
import type { UserProfile, CurrentUser } from './types';

interface UsersTableProps {
  tenantId: string | undefined;
  users: UserProfile[];
  currentUser: CurrentUser | null | undefined;
  isLoading: boolean;
  isOwnerOrAdmin: boolean;
  isManagerPlus: boolean;
  onEdit: (u: UserProfile) => void;
}

export function UsersTable({ tenantId, users, currentUser, isLoading, isOwnerOrAdmin, isManagerPlus, onEdit }: UsersTableProps) {
  const router = useRouter();
  const { toast } = useToast();

  // Un REGIONAL_MANAGER peut modifier (jamais activer/désactiver ni
  // supprimer, réservés à isOwnerOrAdmin) un compte MANAGER/CASHIER déjà
  // cantonné à SES magasins — même règle que côté serveur
  // (lib/api/regional-scope.ts / /api/users/update), rejouée ici pour ne
  // pas afficher un bouton qui échouerait de toute façon en 403.
  const canEditUser = (u: UserProfile): boolean => {
    if (isOwnerOrAdmin) return u.role !== 'OWNER';
    if (currentUser?.role === 'REGIONAL_MANAGER') {
      return ['MANAGER', 'CASHIER'].includes(u.role) && isSubsetOf(u.storeIds, currentUser.storeIds);
    }
    return false;
  };

  const [deletingUser, setDeletingUser] = useState<UserProfile | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');

  const [purgingUser, setPurgingUser] = useState<UserProfile | null>(null);
  const [purgeConfirmText, setPurgeConfirmText] = useState('');
  const [isPurging, setIsPurging] = useState(false);

  const toggleActive = async (u: UserProfile) => {
    if (!tenantId || u.role === 'OWNER' || u.id === currentUser?.id) return;
    try {
      const res = await fetch('/api/users/toggle-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, uid: u.id, isActive: !u.isActive }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur');
      toast({
        title: !u.isActive ? 'Utilisateur activé' : 'Utilisateur désactivé',
        description: !u.isActive
          ? `${u.firstName} ${u.lastName} peut à nouveau se connecter.`
          : `${u.firstName} ${u.lastName} est désactivé et son accès a été révoqué immédiatement.`,
      });
    } catch (e) {
      toast({ title: 'Erreur', description: e instanceof Error ? e.message : 'Erreur interne', variant: 'destructive' });
    }
  };

  const handleRestore = async (u: UserProfile) => {
    if (!tenantId) return;
    setIsDeleting(true);
    try {
      const res = await fetch('/api/users/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, uid: u.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur lors de la restauration');
      toast({ title: 'Compte restauré', description: `${u.firstName} ${u.lastName} peut à nouveau se connecter.` });
    } catch (e) {
      toast({ title: 'Erreur', description: e instanceof Error ? e.message : 'Erreur interne', variant: 'destructive' });
    } finally { setIsDeleting(false); }
  };

  const handleDelete = async () => {
    if (!tenantId || !deletingUser) return;
    const requiresJustification = currentUser?.role === 'ADMIN' && ['MANAGER', 'CASHIER'].includes(deletingUser.role);
    if (requiresJustification && deleteReason.trim().length < 5) {
      toast({ title: 'Justification requise', description: 'Explique en quelques mots pourquoi cette suppression est nécessaire.', variant: 'destructive' });
      return;
    }
    setIsDeleting(true);
    try {
      const res = await fetch('/api/users/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, uid: deletingUser.id, reason: requiresJustification ? deleteReason.trim() : undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur lors de la suppression');
      if (data.pending) {
        toast({ title: 'Demande envoyée', description: `La suppression de ${deletingUser.firstName} ${deletingUser.lastName} attend la validation du Propriétaire.` });
      } else {
        toast({ title: 'Utilisateur supprimé', description: `${deletingUser.firstName} ${deletingUser.lastName} a été retiré du compte.` });
      }
      setDeletingUser(null);
      setDeleteReason('');
    } catch (e) {
      toast({ title: 'Erreur', description: e instanceof Error ? e.message : 'Erreur interne', variant: 'destructive' });
    } finally { setIsDeleting(false); }
  };

  const handlePurge = async () => {
    if (!tenantId || !purgingUser) return;
    setIsPurging(true);
    try {
      const res = await fetch('/api/users/purge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, uid: purgingUser.id, confirmName: purgeConfirmText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur lors de la purge');
      toast({ title: 'Compte purgé définitivement', description: `${purgingUser.firstName} ${purgingUser.lastName} a été effacé — cette action ne peut plus être annulée.` });
      setPurgingUser(null);
      setPurgeConfirmText('');
    } catch (e) {
      toast({ title: 'Erreur', description: e instanceof Error ? e.message : 'Erreur interne', variant: 'destructive' });
    } finally { setIsPurging(false); }
  };

  return (
    <>
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-gray-400"><RefreshCw className="h-5 w-5 animate-spin mr-2" />Chargement...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Utilisateur</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Rôle</TableHead>
                  <TableHead>Dernière connexion</TableHead>
                  <TableHead className="text-center">Statut</TableHead>
                  {isManagerPlus && <TableHead className="w-36 text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map(u => (
                  <TableRow key={u.id} className="hover:bg-gray-50">
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className={`h-9 w-9 rounded-full flex items-center justify-center text-sm font-bold text-white ${u.role === 'OWNER' ? 'bg-purple-500' : u.role === 'ADMIN' ? 'bg-red-500' : u.role === 'MANAGER' ? 'bg-blue-500' : 'bg-green-500'}`}>
                          {(u.firstName?.[0] || '') + (u.lastName?.[0] || '')}
                        </div>
                        <div>
                          <p className="font-medium text-sm text-gray-900">{u.firstName} {u.lastName}</p>
                          {u.phone && <p className="text-xs text-gray-400">{u.phone}</p>}
                          {u.id === currentUser?.id && <Badge variant="outline" className="text-xs mt-0.5">Vous</Badge>}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-gray-600">{u.email}</TableCell>
                    <TableCell><RoleBadge role={u.role} /></TableCell>
                    <TableCell className="text-sm text-gray-500">{u.lastLoginAt ? formatDate(u.lastLoginAt) : 'Jamais'}</TableCell>
                    <TableCell className="text-center">
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                        u.deletedAt ? 'bg-red-100 text-red-700' : u.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {u.deletedAt ? 'Supprimé' : u.isActive ? 'Actif' : 'Inactif'}
                      </span>
                    </TableCell>
                    {isManagerPlus && (
                      <TableCell>
                        {u.deletedAt ? (
                          <div className="flex items-center justify-end gap-2">
                            <span className="text-xs text-gray-400">{formatDate(u.deletedAt)}</span>
                            {currentUser?.role === 'OWNER' && (
                              <>
                                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={isDeleting} onClick={() => handleRestore(u)}>
                                  Restaurer
                                </Button>
                                <Button size="sm" variant="ghost" className="h-7 text-xs text-red-500 hover:text-red-700" onClick={() => setPurgingUser(u)}>
                                  Purger
                                </Button>
                              </>
                            )}
                          </div>
                        ) : (
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" title="Voir l'activité" onClick={() => router.push(`/users/${u.id}/activity`)}>
                            <Activity className="h-4 w-4 text-gray-400" />
                          </Button>
                          {isOwnerOrAdmin && u.role !== 'OWNER' && u.id !== currentUser?.id && (
                            <Switch checked={u.isActive} onCheckedChange={() => toggleActive(u)} />
                          )}
                          {canEditUser(u) && (
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(u)}>
                              <Pencil className="h-4 w-4 text-gray-500" />
                            </Button>
                          )}
                          {isOwnerOrAdmin && u.role !== 'OWNER' && u.id !== currentUser?.id && !(currentUser?.role === 'ADMIN' && u.role === 'ADMIN') && (
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setDeletingUser(u)}>
                              <Trash2 className="h-4 w-4 text-red-500" />
                            </Button>
                          )}
                        </div>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Confirmation Suppression */}
      <AlertDialog open={!!deletingUser} onOpenChange={(open) => { if (!open) { setDeletingUser(null); setDeleteReason(''); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cet utilisateur ?</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingUser && currentUser?.role === 'ADMIN' && ['MANAGER', 'CASHIER'].includes(deletingUser.role) ? (
                <>Le compte de <strong>{deletingUser.firstName} {deletingUser.lastName}</strong> ({deletingUser.email}) ne sera pas supprimé immédiatement : ta demande, avec justification, sera envoyée au Propriétaire pour validation.</>
              ) : deletingUser && (
                <>Le compte de <strong>{deletingUser.firstName} {deletingUser.lastName}</strong> ({deletingUser.email}) sera désactivé — accès et connexion révoqués immédiatement. Le compte reste restaurable ensuite depuis cette page.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deletingUser && currentUser?.role === 'ADMIN' && ['MANAGER', 'CASHIER'].includes(deletingUser.role) && (
            <div className="space-y-1.5">
              <Label htmlFor="delete-reason">Justification (obligatoire)</Label>
              <Textarea
                id="delete-reason"
                value={deleteReason} onChange={e => setDeleteReason(e.target.value)}
                placeholder="Pourquoi cette suppression est-elle nécessaire ?"
                rows={3}
              />
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={isDeleting} className="bg-red-600 hover:bg-red-700">
              {isDeleting ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Traitement...</> :
                (deletingUser && currentUser?.role === 'ADMIN' && ['MANAGER', 'CASHIER'].includes(deletingUser.role) ? 'Envoyer la demande' : 'Désactiver le compte')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Purge définitive — confirmation renforcée */}
      <AlertDialog open={!!purgingUser} onOpenChange={(open) => { if (!open) { setPurgingUser(null); setPurgeConfirmText(''); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-red-700">Purger définitivement ce compte ?</AlertDialogTitle>
            <AlertDialogDescription>
              {purgingUser && (
                <>
                  Contrairement à la désactivation, cette action <strong>ne peut pas être annulée</strong> — le profil de{' '}
                  <strong>{purgingUser.firstName} {purgingUser.lastName}</strong> sera effacé définitivement. Son historique de ventes et transactions passées reste conservé séparément (non affecté).
                  <br /><br />
                  Pour confirmer, tape son nom complet : <strong>{purgingUser.firstName} {purgingUser.lastName}</strong>
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={purgeConfirmText}
            onChange={e => setPurgeConfirmText(e.target.value)}
            placeholder="Nom complet exact"
            aria-label="Nom complet exact pour confirmer la purge"
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPurging}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={handlePurge}
              disabled={isPurging || !purgingUser || purgeConfirmText.trim().toLowerCase() !== `${purgingUser.firstName} ${purgingUser.lastName}`.trim().toLowerCase()}
              className="bg-red-600 hover:bg-red-700"
            >
              {isPurging ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : 'Purger définitivement'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
