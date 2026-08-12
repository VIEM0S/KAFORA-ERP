'use client';

import { useState } from 'react';
import { Plus, CheckCircle2 } from 'lucide-react';
import { DashboardLayout } from '@/components/layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/hooks/store';
import { useUsersData } from '@/hooks/use-users-data';
import { ROLE_CONFIG } from '@/components/users/role-badge';
import { CreateUserDialog } from '@/components/users/create-user-dialog';
import { EditUserDialog } from '@/components/users/edit-user-dialog';
import { DeletionRequestsSection } from '@/components/users/deletion-requests-section';
import { UsersTable } from '@/components/users/users-table';
import type { UserProfile } from '@/components/users/types';
import { isOwnerOrAdmin as isOwnerOrAdminRole, isManagerPlus as isManagerPlusRole, canManageUsers as canManageUsersRole } from '@/lib/auth/roles';

export default function UsersPage() {
  const { tenant, user: currentUser } = useAuthStore();
  const tenantId = tenant?.id;

  const { users, deletionRequests, isLoading } = useUsersData(tenantId);

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const isOwnerOrAdmin = isOwnerOrAdminRole(currentUser?.role);
  const isManagerPlus = isManagerPlusRole(currentUser?.role);
  const canManageUsers = canManageUsersRole(currentUser?.role);

  const byRole = (role: string) => users.filter(u => u.role === role);

  const handleCreated = (message: string) => {
    setSuccessMsg(message);
    setTimeout(() => setSuccessMsg(null), 4000);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Utilisateurs</h1>
            <p className="text-sm text-gray-500 mt-1">{users.filter(u => u.isActive).length} actif{users.filter(u => u.isActive).length !== 1 ? 's' : ''} sur {users.length}</p>
          </div>
          {canManageUsers && (
            <Button onClick={() => setShowCreateDialog(true)} className="bg-primary-600 hover:bg-primary-700">
              <Plus className="h-4 w-4 mr-2" />Nouveau compte
            </Button>
          )}
        </div>

        {successMsg && (
          <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-700">
            <CheckCircle2 className="h-4 w-4" />{successMsg}
          </div>
        )}

        <DeletionRequestsSection tenantId={tenantId} deletionRequests={deletionRequests} currentUser={currentUser} />

        {/* Rôles */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Object.entries(ROLE_CONFIG).map(([role, cfg]) => {
            const count = byRole(role).length;
            const Icon = cfg.icon;
            return (
              <Card key={role}><CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className={`h-10 w-10 rounded-lg ${cfg.color.replace('text-', 'text-').replace('bg-', 'bg-')} flex items-center justify-center`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-lg font-bold">{count}</p>
                    <p className="text-xs text-gray-500">{cfg.label}{count !== 1 ? 's' : ''}</p>
                  </div>
                </div>
              </CardContent></Card>
            );
          })}
        </div>

        <UsersTable
          tenantId={tenantId}
          users={users}
          currentUser={currentUser}
          isLoading={isLoading}
          isOwnerOrAdmin={isOwnerOrAdmin}
          isManagerPlus={isManagerPlus}
          onEdit={setEditingUser}
        />

        {/* Permissions */}
        <Card>
          <CardHeader><CardTitle className="text-base">Permissions par rôle</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {Object.entries(ROLE_CONFIG).map(([role, cfg]) => {
                const Icon = cfg.icon;
                return (
                  <div key={role} className={`rounded-lg p-3 border ${cfg.color.includes('purple') ? 'border-purple-200 bg-purple-50' : cfg.color.includes('red') ? 'border-red-200 bg-red-50' : cfg.color.includes('blue') ? 'border-blue-200 bg-blue-50' : 'border-green-200 bg-green-50'}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <Icon className={`h-4 w-4 ${cfg.color.replace('bg-', '').split(' ')[0].replace('100', '600')}`} />
                      <span className="font-medium text-sm">{cfg.label}</span>
                    </div>
                    <p className="text-xs text-gray-600">{cfg.desc}</p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      <CreateUserDialog tenantId={tenantId} open={showCreateDialog} onOpenChange={setShowCreateDialog} onCreated={handleCreated} />
      <EditUserDialog tenantId={tenantId} user={editingUser} onOpenChange={(open) => { if (!open) setEditingUser(null); }} />
    </DashboardLayout>
  );
}
