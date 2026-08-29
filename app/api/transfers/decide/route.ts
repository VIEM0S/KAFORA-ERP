import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getSessionClaims } from '@/lib/api/session';
import { checkSubscriptionAllows } from '@/lib/api/subscription-guard';
import { checkPlanFeatureAllows } from '@/lib/api/plan-guard';
import { resolveTransferSettings, canApprove, canShip } from '@/lib/transfers/rules';
import type { UserRole } from '@/lib/types';

/**
 * Approuve, refuse ou annule un transfert. Le cas sensible (annulation d'un
 * transfert déjà expédié, restitution du stock à la source) vit dans
 * decide_transfer() en RPC.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSessionClaims();
    if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    const tenantId = session.tenantId as string;
    const callerRole = session.role as UserRole;
    const callerStoreIds = session.storeIds;

    const featureBlocked = await checkPlanFeatureAllows(tenantId, 'multiStoreEnabled');
    if (featureBlocked) {
      return NextResponse.json({ error: featureBlocked.error }, { status: featureBlocked.status });
    }

    const blocked = await checkSubscriptionAllows(tenantId, 'write');
    if (blocked) {
      return NextResponse.json({ error: blocked.error }, { status: blocked.status });
    }

    const { transferId, action, reason } = (await request.json()) as {
      transferId?: string; action?: 'APPROVE' | 'REJECT' | 'CANCEL'; reason?: string;
    };
    if (!transferId || !action || !['APPROVE', 'REJECT', 'CANCEL'].includes(action)) {
      return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });
    }

    const supabase = createServiceRoleClient();
    const { data: tenant } = await supabase.from('tenants').select('transfer_settings').eq('id', tenantId).maybeSingle();
    const settings = resolveTransferSettings(tenant?.transfer_settings as Parameters<typeof resolveTransferSettings>[0]);

    // Approuver/refuser relève des rôles d'approbation ; annuler relève des
    // rôles d'expédition (celui qui peut envoyer peut renoncer à envoyer).
    const allowed = action === 'CANCEL' ? canShip(callerRole, settings) : canApprove(callerRole, settings);
    if (!allowed) {
      return NextResponse.json({ error: 'Votre rôle ne permet pas cette action' }, { status: 403 });
    }

    const { data: transfer } = await supabase
      .from('transfers').select('from_store_id, to_store_id').eq('id', transferId).eq('tenant_id', tenantId).maybeSingle();
    if (!transfer) return NextResponse.json({ error: 'Transfert introuvable' }, { status: 404 });

    if (Array.isArray(callerStoreIds)) {
      const involved =
        (transfer.from_store_id && callerStoreIds.includes(transfer.from_store_id)) ||
        (transfer.to_store_id && callerStoreIds.includes(transfer.to_store_id));
      if (!involved) {
        return NextResponse.json({ error: "Vous n'avez pas accès à ces magasins" }, { status: 403 });
      }
    }

    const { data: result, error: rpcError } = await supabase.rpc('decide_transfer', {
      p_tenant_id: tenantId, p_transfer_id: transferId, p_caller_id: session.uid,
      p_action: action, p_reason: (reason?.trim() || null) as string,
    });
    if (rpcError) throw rpcError;

    return NextResponse.json(result);
  } catch (error) {
    console.error('Transfer decide error:', error);
    const msg = error instanceof Error ? error.message : 'Erreur interne';
    const isKnownBusinessError = msg.includes('INVALID_STATUS') || msg.includes('INVALID_ACTION');
    const isNotFound = msg.includes('NOT_FOUND');
    const cleanMsg = msg.replace(/^.*(INVALID_STATUS|INVALID_ACTION|NOT_FOUND):\s*/, '');
    return NextResponse.json(
      { error: (isKnownBusinessError || isNotFound) ? cleanMsg : 'Erreur interne' },
      { status: isNotFound ? 404 : isKnownBusinessError ? 409 : 500 }
    );
  }
}
