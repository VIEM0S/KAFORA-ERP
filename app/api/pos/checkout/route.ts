import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getSessionClaims } from '@/lib/api/session';
import { checkSubscriptionAllows } from '@/lib/api/subscription-guard';

interface CheckoutItem {
  productId: string;
  quantity: number;
  discount?: number; // % de remise ligne, optionnel (ex. négociation manager)
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionClaims();
    if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    const { uid: callerUid, tenantId: callerTenantId, storeIds: callerStoreIds } = session;

    // Identifiant fourni par la file d'attente hors-ligne (lib/offline-queue.ts).
    // Absent = vente en ligne normale. Présent = cette requête peut être un
    // rejeu (réponse HTTP perdue après succès serveur) — voir pos_checkout(),
    // qui gère l'idempotence en premier.
    const offlineSyncId = request.headers.get('X-Offline-Sync-Id');

    const {
      tenantId, storeId, items, customerId,
      paymentMethod, amountReceived, discountPercent,
      userName, quoteId,
    }: {
      tenantId: string; storeId: string; items: CheckoutItem[]; customerId?: string | null;
      paymentMethod: string; amountReceived?: number; discountPercent?: number; userName?: string;
      quoteId?: string;
    } = await request.json();

    if (!tenantId || !storeId || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Panier vide ou données manquantes' }, { status: 400 });
    }
    if (tenantId !== callerTenantId) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }
    // Cloisonnement magasin : storeIds absent ou null = accès à tous (direction).
    if (Array.isArray(callerStoreIds) && !callerStoreIds.includes(storeId)) {
      return NextResponse.json({ error: "Vous n'avez pas accès à ce magasin" }, { status: 403 });
    }

    const subscriptionBlock = await checkSubscriptionAllows(tenantId, 'pos');
    if (subscriptionBlock) {
      return NextResponse.json(
        { error: subscriptionBlock.error, subscriptionState: subscriptionBlock.state },
        { status: subscriptionBlock.status }
      );
    }

    if (!['CASH', 'MOBILE_MONEY', 'CARD', 'CREDIT'].includes(paymentMethod)) {
      return NextResponse.json({ error: 'Mode de paiement invalide' }, { status: 400 });
    }

    const supabase = createServiceRoleClient();

    // ── Client (si vente à crédit) ──────────────────────────────────────────
    let customer: { id: string; customer_type: string; company_name: string | null; first_name: string | null; last_name: string | null; phone: string | null } | null = null;
    if (customerId) {
      const { data } = await supabase.from('customers').select('*').eq('id', customerId).eq('tenant_id', tenantId).maybeSingle();
      if (!data) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 });
      customer = data;
    }
    if (paymentMethod === 'CREDIT' && !customer) {
      return NextResponse.json({ error: 'Client requis pour une vente à crédit' }, { status: 400 });
    }

    // ── Récupérer les produits réels (source de vérité pour prix & coût) ────
    const productIds = items.map((it) => it.productId);
    const { data: products } = await supabase
      .from('products')
      .select('*')
      .eq('tenant_id', tenantId)
      .in('id', productIds);
    for (const it of items) {
      if (!products?.some((p) => p.id === it.productId)) {
        return NextResponse.json({ error: `Produit introuvable (${it.productId})` }, { status: 404 });
      }
    }
    const productById = new Map((products ?? []).map((p) => [p.id, p]));

    // ── Calcul des totaux côté serveur (jamais depuis le client) ────────────
    const lines = items.map((it) => {
      const p = productById.get(it.productId)!;
      const discount = Math.min(Math.max(Number(it.discount) || 0, 0), 100); // clamp 0-100%
      const quantity = Math.max(1, Math.floor(Number(it.quantity) || 0));
      const unitPrice = p.selling_price;
      const tax = p.tax_rate || 0;
      // Arrondi À L'UNITÉ, pas au centime : le franc CFA n'a pas de
      // subdivision — voir le commentaire détaillé conservé dans l'historique
      // Firebase de ce fichier pour le raisonnement complet (accumulation
      // d'écarts sur crédits/caisse/agrégats mensuels sinon).
      const lineTotal = Math.round(quantity * unitPrice * (1 - discount / 100) * (1 + tax / 100));
      return { product: p, quantity, discount, unitPrice, tax, lineTotal };
    });

    const subtotal = Math.round(lines.reduce((s, l) => s + l.quantity * l.unitPrice * (1 - l.discount / 100), 0));
    const taxTotal = Math.round(lines.reduce((s, l) => s + l.quantity * l.unitPrice * (1 - l.discount / 100) * (l.tax / 100), 0));
    const cartDiscountPercent = Math.min(Math.max(Number(discountPercent) || 0, 0), 100);
    const discountAmount = Math.round(subtotal * (cartDiscountPercent / 100));
    const total = subtotal + taxTotal - discountAmount;
    const itemCount = lines.reduce((s, l) => s + l.quantity, 0);

    const acompte = paymentMethod === 'CREDIT' ? Math.max(0, Math.min(Number(amountReceived) || 0, total)) : total;
    const soldeCredit = paymentMethod === 'CREDIT' ? Math.max(0, total - acompte) : 0;
    const requiresCreditCheck = paymentMethod === 'CREDIT' && soldeCredit > 0 && !!customer;

    const receivedCash = paymentMethod === 'CASH' ? (Number(amountReceived) || total) : acompte;
    if (paymentMethod === 'CASH' && receivedCash < total) {
      return NextResponse.json({ error: 'Montant reçu insuffisant' }, { status: 400 });
    }
    const change = paymentMethod === 'CASH' ? Math.max(0, receivedCash - total) : 0;

    const customerName = customer
      ? (customer.customer_type === 'BUSINESS' ? customer.company_name : `${customer.first_name || ''} ${customer.last_name || ''}`.trim())
      : null;

    // Les types generes par Supabase pour ces parametres RPC sont non-
    // nullables (`string`) bien que les colonnes SQL correspondantes soient
    // nullables — Postgres accepte tres bien null ici au runtime.
    const { data: result, error: rpcError } = await supabase.rpc('pos_checkout', {
      p_tenant_id: tenantId,
      p_store_id: storeId,
      p_cashier_id: callerUid,
      p_customer_id: (customerId || null) as string,
      p_customer_name: customerName as string,
      p_customer_phone: (customer?.phone || null) as string,
      p_payment_method: paymentMethod as 'CASH' | 'MOBILE_MONEY' | 'CARD' | 'CREDIT',
      p_subtotal: subtotal,
      p_discount_percent: cartDiscountPercent,
      p_discount_amount: discountAmount,
      p_tax_total: taxTotal,
      p_total: total,
      p_item_count: itemCount,
      p_amount_received: receivedCash,
      p_change: change,
      p_acompte: acompte,
      p_solde_credit: soldeCredit,
      p_requires_credit_check: requiresCreditCheck,
      p_offline_sync_id: (offlineSyncId || null) as string,
      p_quote_id: (quoteId || null) as string,
      p_user_name: (userName || null) as string,
      p_lines: lines.map((l) => ({
        product_id: l.product.id,
        product_name: l.product.name,
        product_sku: l.product.sku,
        category_id: l.product.category_id,
        quantity: l.quantity,
        unit_price: l.unitPrice,
        purchase_price: l.product.purchase_price,
        discount_percent: l.discount,
        tax_rate: l.tax,
        total: l.lineTotal,
        track_inventory: l.product.track_inventory,
      })),
    });

    if (rpcError) throw rpcError;
    const r = result as unknown as { saleId: string; reference: string; total: number; change: number };

    return NextResponse.json({ success: true, saleId: r.saleId, reference: r.reference, total: r.total, change: r.change });
  } catch (error) {
    console.error('POS checkout error:', error);
    const msg = error instanceof Error ? error.message : 'Erreur interne';
    // pos_checkout() préfixe ses erreurs métier connues pour qu'on puisse les
    // distinguer d'une erreur technique — l'utilisateur doit savoir pourquoi.
    const isKnownBusinessError = msg.includes('STOCK_INSUFFICIENT') || msg.includes('CREDIT_LIMIT_EXCEEDED');
    const cleanMsg = msg.replace(/^.*(STOCK_INSUFFICIENT|CREDIT_LIMIT_EXCEEDED):\s*/, '');
    return NextResponse.json(
      { error: isKnownBusinessError ? cleanMsg : 'Erreur lors de la finalisation de la vente' },
      { status: isKnownBusinessError ? 409 : 500 }
    );
  }
}
