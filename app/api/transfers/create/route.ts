import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getSessionClaims } from '@/lib/api/session';
import { checkSubscriptionAllows } from '@/lib/api/subscription-guard';
import { resolveTransferSettings } from '@/lib/transfers/rules';
import type { TransferLine, UserRole } from '@/lib/types';

/**
 * Crée une demande de transfert entre deux magasins.
 *
 * Aucun stock ne bouge ici : la sortie a lieu à l'expédition, l'entrée à la
 * réception. Créer une demande n'engage rien et peut donc être fait sans
 * risque par un responsable de magasin.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSessionClaims();
    if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    const tenantId = session.tenantId as string;
    const callerRole = session.role as UserRole;
    const callerStoreIds = session.storeIds;

    if (callerRole === 'CASHIER') {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const blocked = await checkSubscriptionAllows(tenantId, 'write');
    if (blocked) {
      return NextResponse.json({ error: blocked.error }, { status: blocked.status });
    }

    const { fromStoreId, toStoreId, lines, note } = (await request.json()) as {
      fromStoreId?: string; toStoreId?: string; lines?: TransferLine[]; note?: string;
    };

    if (!fromStoreId || !toStoreId || !Array.isArray(lines) || lines.length === 0) {
      return NextResponse.json({ error: 'Champs manquants' }, { status: 400 });
    }
    if (fromStoreId === toStoreId) {
      return NextResponse.json(
        { error: 'Les magasins source et destination doivent être différents' },
        { status: 400 }
      );
    }
    for (const l of lines) {
      if (!l.productId || !Number.isInteger(l.quantity) || l.quantity <= 0) {
        return NextResponse.json({ error: 'Quantité invalide' }, { status: 400 });
      }
    }

    // Cloisonnement : on doit avoir accès à AU MOINS UN des deux magasins.
    if (Array.isArray(callerStoreIds)) {
      const involved = callerStoreIds.includes(fromStoreId) || callerStoreIds.includes(toStoreId);
      if (!involved) {
        return NextResponse.json({ error: "Vous n'avez pas accès à ces magasins" }, { status: 403 });
      }
    }

    const supabase = createServiceRoleClient();
    const [{ data: fromStore }, { data: toStore }, { data: tenant }] = await Promise.all([
      supabase.from('stores').select('id').eq('id', fromStoreId).eq('tenant_id', tenantId).maybeSingle(),
      supabase.from('stores').select('id').eq('id', toStoreId).eq('tenant_id', tenantId).maybeSingle(),
      supabase.from('tenants').select('transfer_settings').eq('id', tenantId).maybeSingle(),
    ]);
    if (!fromStore || !toStore) {
      return NextResponse.json({ error: 'Magasin inconnu' }, { status: 400 });
    }

    const settings = resolveTransferSettings(tenant?.transfer_settings as Parameters<typeof resolveTransferSettings>[0]);
    const status = settings.requireApproval ? 'PENDING' : 'APPROVED';
    const now = new Date().toISOString();

    const { data: transfer, error: insertError } = await supabase
      .from('transfers')
      .insert({
        tenant_id: tenantId,
        reference: `TR-${Date.now().toString(36).toUpperCase()}`,
        from_store_id: fromStoreId,
        to_store_id: toStoreId,
        status,
        note: note?.trim() || null,
        requested_by: session.uid,
        approved_by: settings.requireApproval ? null : session.uid,
        approved_at: settings.requireApproval ? null : now,
      })
      .select('id')
      .single();
    if (insertError) throw insertError;

    const { error: linesError } = await supabase.from('transfer_lines').insert(
      lines.map((l) => ({
        transfer_id: transfer.id,
        product_id: l.productId,
        product_name: l.productName || '',
        product_sku: l.productSku || '',
        quantity: l.quantity,
      }))
    );
    if (linesError) throw linesError;

    return NextResponse.json({ success: true, id: transfer.id, status });
  } catch (error) {
    console.error('Transfer create error:', error);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
