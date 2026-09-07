import { test, expect } from '@playwright/test';
import { supabaseAdmin, TENANT_ID, uniqueSuffix } from './helpers/supabase-admin';

/**
 * Régression directe de deux bugs trouvés le 2026-09-07, sur un crédit
 * SOUS le seuil d'approbation (annulation directe, pas de workflow de
 * validation) :
 * 1. write_off_credit() ne remettait pas remaining_amount à 0.
 * 2. isEnRetard() ne traitait pas WRITTEN_OFF comme un état terminal — un
 *    crédit annulé en retard réapparaissait "En retard" dans la liste.
 * Le crédit est délibérément créé avec une échéance déjà passée pour
 * exercer précisément ce deuxième cas.
 */
test.describe('Crédit — annulation (write-off)', () => {
  let customerId: string;
  let creditId: string;
  let customerName: string;

  test.beforeAll(async () => {
    const admin = supabaseAdmin();
    const suffix = uniqueSuffix();
    customerName = `WriteOff-${suffix}`;
    const { data: customer, error } = await admin
      .from('customers')
      .insert({
        tenant_id: TENANT_ID,
        first_name: 'E2E',
        last_name: `WriteOff-${suffix}`,
        customer_type: 'INDIVIDUAL',
        phone: `+223 61 00 ${suffix.slice(-4)}`,
        credit_limit: 50_000,
        credit_used: 15_000,
      })
      .select('id')
      .single();
    if (error) throw error;
    customerId = customer.id;

    const { data: credit, error: creditError } = await admin
      .from('credits')
      .insert({
        tenant_id: TENANT_ID,
        customer_id: customerId,
        reference: `CR-E2E-WO-${suffix}`,
        total_amount: 15_000,
        paid_amount: 0,
        remaining_amount: 15_000,
        due_date: new Date(Date.now() - 3 * 86_400_000).toISOString(), // déjà en retard
        status: 'OVERDUE',
        customer_name: `E2E WriteOff-${suffix}`,
        customer_phone: `+223 61 00 ${suffix.slice(-4)}`,
      })
      .select('id')
      .single();
    if (creditError) throw creditError;
    creditId = credit.id;
  });

  test.afterAll(async () => {
    const admin = supabaseAdmin();
    await admin.from('credits').delete().eq('id', creditId);
    await admin.from('customers').delete().eq('id', customerId);
  });

  test('un crédit annulé passe à 0 FCFA de solde et ne réapparaît plus "En retard"', async ({ page }) => {
    await page.goto('/credits');
    await page.getByRole('button', { name: 'Tous' }).click();
    // Le montant seul n'est pas fiable (une ligne orpheline d'un run
    // interrompu peut partager le même montant) — cibler par le nom du
    // client, unique par exécution grâce au suffixe.
    await page.locator('tr', { hasText: customerName }).first().click();

    await page.getByRole('button', { name: 'Annuler ce crédit' }).click();
    // Placeholder réel : "ex: Client introuvable, créance jugée irrécouvrable..."
    await page.getByPlaceholder(/introuvable/i).fill('Test E2E — write-off');
    await page.getByRole('button', { name: "Confirmer l'annulation" }).click();

    // "0 FCFA" est déjà présent AVANT l'action ("Total versé" démarre à 0) —
    // attendre un signal qui ne peut être vrai qu'après la mutation : la
    // boîte de dialogue se ferme, et le badge de statut passe à "Annulé".
    await expect(page.getByRole('heading', { name: /Annuler ce crédit/ })).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByText('Annulé').first()).toBeVisible({ timeout: 10_000 });

    const admin = supabaseAdmin();
    const { data: credit } = await admin
      .from('credits')
      .select('status, remaining_amount')
      .eq('id', creditId)
      .single();
    expect(credit?.status).toBe('WRITTEN_OFF');
    expect(Number(credit?.remaining_amount)).toBe(0); // régression bug remaining_amount

    // Filtre "En retard" : le crédit annulé ne doit plus y apparaître dans le
    // TABLEAU — scope explicite, le panneau de détail encore ouvert à droite
    // affiche légitimement le nom du client (journal d'audit) et ferait
    // échouer une recherche non scopée par un faux positif.
    await page.getByRole('button', { name: 'En retard' }).click();
    await expect(page.locator('table').getByText(customerName, { exact: false })).toHaveCount(0);
  });
});
