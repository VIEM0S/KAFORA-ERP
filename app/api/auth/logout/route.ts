import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export async function POST(_request: NextRequest) {
  try {
    const supabaseServer = await createServerSupabaseClient();

    // scope: 'global' révoque TOUTES les sessions actives de l'utilisateur
    // (équivalent adminAuth.revokeRefreshTokens), pas seulement celle-ci —
    // et supprime au passage les cookies de session côté navigateur.
    await supabaseServer.auth.signOut({ scope: 'global' });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Logout error:', error);
    return NextResponse.json({ success: true });
  }
}
