import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getSessionClaims } from '@/lib/api/session';

/**
 * Activer/désactiver un code promo. Pas de suppression : l'historique de
 * rédemption (promo_code_redemptions) doit rester consultable même pour un
 * code retiré.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSessionClaims();
    if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (session.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Introuvable' }, { status: 404 });
    }

    const { id } = await params;
    const { isActive } = (await request.json()) as { isActive?: boolean };
    if (typeof isActive !== 'boolean') {
      return NextResponse.json({ error: 'isActive doit être un booléen' }, { status: 400 });
    }

    const admin = createServiceRoleClient();
    const { error } = await admin.from('promo_codes').update({ is_active: isActive }).eq('id', id);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Admin promo-codes PATCH error:', error);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
