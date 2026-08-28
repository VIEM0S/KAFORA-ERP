import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getSessionClaims } from '@/lib/api/session';

/**
 * Utilisateurs d'une entreprise cliente — pour le support.
 *
 * PÉRIMÈTRE VOLONTAIREMENT LIMITÉ : nom, email, rôle, activité. Aucune donnée
 * commerciale (ventes, marges, clients finaux, stock) n'est exposée ici.
 *
 * C'est un choix, pas une limite technique : les routes d'administration
 * utilisent le rôle service, qui contourne RLS et pourrait donc tout lire.
 * S'interdire l'accès au contenu commercial des clients est ce qui rend
 * l'engagement d'isolation crédible — un commerçant qui confie son chiffre
 * d'affaires à Kafora doit savoir que l'éditeur ne le consulte pas.
 *
 * Chaque consultation est journalisée CHEZ LE CLIENT : il peut constater
 * qu'on a regardé son compte, et quand.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSessionClaims();
    if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (session.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Introuvable' }, { status: 404 });
    }

    const tenantId = new URL(request.url).searchParams.get('tenantId');
    if (!tenantId) {
      return NextResponse.json({ error: 'Entreprise manquante' }, { status: 400 });
    }

    const supabase = createServiceRoleClient();
    const { data: rows, error: usersError } = await supabase
      .from('users')
      .select('id, email, first_name, last_name, role, is_active, last_login_at, store_ids')
      .eq('tenant_id', tenantId);
    if (usersError) throw usersError;

    const users = (rows ?? []).map(u => ({
      id: u.id,
      email: u.email || null,
      firstName: u.first_name || '',
      lastName: u.last_name || '',
      role: u.role || null,
      isActive: u.is_active !== false,
      lastLoginAt: u.last_login_at || null,
      storeIds: Array.isArray(u.store_ids) ? u.store_ids.length : null,
    }));

    // Traçable côté client, sans bloquer la réponse si l'écriture échoue.
    supabase
      .from('audit_logs')
      .insert({
        tenant_id: tenantId,
        user_id: session.uid,
        action: 'SUPPORT_ACCESS',
        entity: 'users',
        entity_id: tenantId,
        details: 'Consultation de la liste des utilisateurs par le support Kafora',
      })
      .then(({ error }) => {
        if (error) console.error('Audit log SUPPORT_ACCESS error:', error);
      });

    return NextResponse.json({ users });
  } catch (error) {
    console.error('Admin tenant users error:', error);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}

/**
 * Réinitialisation d'accès : génère un lien de réinitialisation de mot de
 * passe pour un utilisateur d'une entreprise cliente.
 *
 * On ne DÉFINIT jamais un mot de passe à la place du client — on lui envoie
 * un lien qu'il utilise lui-même. Fixer un mot de passe reviendrait à
 * pouvoir se connecter à son compte, ce qui n'est pas le rôle du support.
 * generateLink() (contrairement à resetPasswordForEmail utilisé par
 * /api/auth/forgot-password) NE PART PAS d'email tout seul : il rend le lien
 * pour que le support le transmette lui-même, comme le faisait
 * generatePasswordResetLink côté Firebase.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSessionClaims();
    if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (session.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Introuvable' }, { status: 404 });
    }

    const { tenantId, email } = (await request.json()) as { tenantId?: string; email?: string };
    if (!tenantId || !email) {
      return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });
    }

    const supabase = createServiceRoleClient();

    // L'utilisateur doit bien appartenir à l'entreprise indiquée : sans cette
    // vérification, la route permettrait de générer un lien pour n'importe
    // quelle adresse connue de Supabase Auth.
    const { data: match, error: matchError } = await supabase
      .from('users')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('email', email)
      .limit(1)
      .maybeSingle();
    if (matchError) throw matchError;
    if (!match) {
      return NextResponse.json({ error: 'Utilisateur introuvable dans cette entreprise' }, { status: 404 });
    }

    const origin = request.headers.get('origin') || new URL(request.url).origin;
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: { redirectTo: `${origin}/reset-password` },
    });
    if (linkError) throw linkError;

    await supabase.from('super_admin_logs').insert({
      action: 'PASSWORD_RESET_LINK',
      tenant_id: tenantId,
      target_email: email,
      performed_by: session.uid,
    });

    await supabase.from('audit_logs').insert({
      tenant_id: tenantId,
      user_id: session.uid,
      action: 'SUPPORT_PASSWORD_RESET',
      entity: 'users',
      entity_id: email,
      details: 'Lien de réinitialisation généré par le support Kafora',
    });

    return NextResponse.json({ success: true, link: linkData.properties.action_link });
  } catch (error) {
    console.error('Admin reset link error:', error);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
