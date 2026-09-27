import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getSessionClaims } from '@/lib/api/session';
import { SUBSCRIPTION_PLANS, PlanId } from '@/lib/constants';

/**
 * Console éditeur : gestion des codes promo sur les abonnements. Outil
 * interne uniquement (SUPER_ADMIN) — un code n'est jamais saisi par un
 * client, il est appliqué par l'admin en enregistrant un paiement (voir
 * app/api/admin/subscription/route.ts). Le montant réellement encaissé
 * reste toujours celui saisi manuellement ; le code ne fait que le
 * documenter/tracer.
 */
export async function GET() {
  try {
    const session = await getSessionClaims();
    if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (session.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Introuvable' }, { status: 404 });
    }

    const admin = createServiceRoleClient();
    const { data, error } = await admin
      .from('promo_codes')
      .select('id, code, description, discount_type, discount_value, applicable_plans, valid_from, valid_until, max_redemptions, times_redeemed, is_active, created_at')
      .order('created_at', { ascending: false });
    if (error) throw error;

    return NextResponse.json({
      promoCodes: (data ?? []).map(p => ({
        id: p.id,
        code: p.code,
        description: p.description,
        discountType: p.discount_type,
        discountValue: p.discount_value,
        applicablePlans: p.applicable_plans,
        validFrom: p.valid_from,
        validUntil: p.valid_until,
        maxRedemptions: p.max_redemptions,
        timesRedeemed: p.times_redeemed,
        isActive: p.is_active,
        createdAt: p.created_at,
      })),
    });
  } catch (error) {
    console.error('Admin promo-codes GET error:', error);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionClaims();
    if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (session.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Introuvable' }, { status: 404 });
    }

    const { code, description, discountType, discountValue, applicablePlans, validUntil, maxRedemptions } =
      (await request.json()) as {
        code?: string; description?: string; discountType?: 'PERCENT' | 'FIXED';
        discountValue?: number; applicablePlans?: PlanId[] | null;
        validUntil?: string; maxRedemptions?: number;
      };

    if (!code?.trim()) {
      return NextResponse.json({ error: 'Le code est obligatoire' }, { status: 400 });
    }
    if (discountType !== 'PERCENT' && discountType !== 'FIXED') {
      return NextResponse.json({ error: 'Type de remise invalide' }, { status: 400 });
    }
    if (typeof discountValue !== 'number' || !Number.isFinite(discountValue) || discountValue <= 0) {
      return NextResponse.json({ error: 'Valeur de remise invalide' }, { status: 400 });
    }
    if (discountType === 'PERCENT' && discountValue > 100) {
      return NextResponse.json({ error: 'Une remise en pourcentage ne peut pas dépasser 100' }, { status: 400 });
    }
    if (applicablePlans && applicablePlans.some(p => !SUBSCRIPTION_PLANS[p])) {
      return NextResponse.json({ error: 'Forfait inconnu dans la liste des forfaits applicables' }, { status: 400 });
    }

    const admin = createServiceRoleClient();
    const { data, error } = await admin
      .from('promo_codes')
      .insert({
        code: code.trim().toUpperCase(),
        description: description?.trim() || null,
        discount_type: discountType,
        discount_value: discountValue,
        applicable_plans: applicablePlans?.length ? applicablePlans : null,
        valid_until: validUntil || null,
        max_redemptions: typeof maxRedemptions === 'number' && maxRedemptions > 0 ? maxRedemptions : null,
        created_by: session.uid,
      })
      .select('id')
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'Ce code existe déjà' }, { status: 409 });
      }
      throw error;
    }

    return NextResponse.json({ success: true, id: data.id });
  } catch (error) {
    console.error('Admin promo-codes POST error:', error);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
