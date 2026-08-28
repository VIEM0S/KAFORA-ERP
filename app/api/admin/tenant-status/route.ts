import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getSessionClaims } from '@/lib/api/session';

/**
 * Suspend ou réactive une entreprise cliente. Toute l'atomicité (mise à jour
 * du tenant + double journalisation éditeur/client) vit dans
 * set_tenant_status() en RPC — voir supabase/migrations.
 *
 * Révocation des sessions à la suspension : au lieu d'une révocation
 * explicite (pas d'équivalent Supabase propre "révoquer par tenant_id" sans
 * itérer sur chaque utilisateur), on s'appuie sur le contrôle déjà en place
 * à la connexion (/api/auth/login vérifie tenants.is_active) et sur le
 * resynchronisation périodique côté client (hooks/useAuth.ts, ~5 min) qui
 * déconnecte l'utilisateur dès que son tenant devient inactif — même
 * caractéristique de délai que le comportement d'origine (toggle-status
 * n'a jamais non plus révoqué les jetons de façon instantanée pour un
 * utilisateur individuel).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSessionClaims();
    if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (session.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Introuvable' }, { status: 404 });
    }

    const { tenantId, isActive, reason } = (await request.json()) as {
      tenantId?: string; isActive?: boolean; reason?: string;
    };
    if (!tenantId || typeof isActive !== 'boolean') {
      return NextResponse.json({ error: 'Champs manquants' }, { status: 400 });
    }
    if (!isActive && !reason?.trim()) {
      return NextResponse.json({ error: 'Un motif est requis pour suspendre' }, { status: 400 });
    }

    const supabase = createServiceRoleClient();
    const { data: result, error: rpcError } = await supabase.rpc('set_tenant_status', {
      p_tenant_id: tenantId,
      p_is_active: isActive,
      p_reason: (reason?.trim() || null) as string,
      p_performed_by: session.uid,
    });
    if (rpcError) throw rpcError;

    return NextResponse.json({ success: true, ...(result as object) });
  } catch (error) {
    console.error('Admin tenant-status error:', error);
    const msg = error instanceof Error ? error.message : 'Erreur interne';
    const isNotFound = msg.includes('NOT_FOUND');
    return NextResponse.json(
      { error: isNotFound ? msg.replace(/^.*NOT_FOUND:\s*/, '') : 'Erreur interne' },
      { status: isNotFound ? 404 : 500 }
    );
  }
}
