import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
// watch vient d'ici : l'enveloppe remonte les échecs au bandeau global
// (voir lib/supabase/watch.ts). Fix (héritage Firestore) : ce hook posait
// directement `onSnapshot` de 'firebase/firestore', sans passer par
// l'enveloppe lib/firebase/watch.ts — un des 3 écouteurs de l'app qui
// échouaient silencieusement (refus RLS ou coupure = écran vide, sans
// explication), signalé dans le plan de migration.
import { watch } from '@/lib/supabase/watch';
import type { Database } from '@/lib/supabase/database.types';
import type { UserProfile, DeletionRequest } from '@/components/users/types';

type UserRow = Database['public']['Tables']['users']['Row'];
type DeletionRequestRow = Database['public']['Tables']['user_deletion_requests']['Row'];

function mapUserProfile(r: UserRow): UserProfile {
  return {
    id: r.id, uid: r.id, email: r.email, firstName: r.first_name, lastName: r.last_name,
    phone: r.phone ?? undefined, role: r.role as UserProfile['role'], isActive: r.is_active,
    lastLoginAt: r.last_login_at ?? undefined, createdAt: r.created_at,
    workingHours: r.working_hours as UserProfile['workingHours'],
    storeIds: r.store_ids, deletedAt: r.deleted_at ?? undefined, deletedBy: r.deleted_by ?? undefined,
  };
}

function mapDeletionRequest(r: DeletionRequestRow): DeletionRequest {
  return {
    id: r.id, targetUserId: r.target_user_id, targetUserName: r.target_user_name || '',
    targetUserRole: r.target_user_role || '', requestedBy: r.requested_by,
    requestedByName: r.requested_by_name || '', reason: r.justification || '',
    status: r.status as DeletionRequest['status'], createdAt: r.created_at,
  };
}

export function useUsersData(tenantId: string | undefined) {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [deletionRequests, setDeletionRequests] = useState<DeletionRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!tenantId) return;
    return watch(
      'users',
      () => supabase.from('users').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: true }),
      rows => {
        setUsers(rows.map(mapUserProfile));
        setIsLoading(false);
      },
      undefined,
      `tenant_id=eq.${tenantId}`
    );
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    return watch(
      'user_deletion_requests',
      () => supabase.from('user_deletion_requests').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }),
      rows => setDeletionRequests(rows.map(mapDeletionRequest)),
      undefined,
      `tenant_id=eq.${tenantId}`
    );
  }, [tenantId]);

  return { users, deletionRequests, isLoading };
}
