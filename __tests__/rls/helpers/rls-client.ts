/**
 * Harnais de test RLS — Phase 7 du plan de migration Supabase.
 *
 * Se connecte en direct au Postgres local (`supabase start`, voir
 * supabase/config.toml — port 54322, identifiants par défaut du CLI) et
 * simule un utilisateur authentifié en posant `request.jwt.claims` sur la
 * session, exactement comme les fonctions RLS de auth_tenant_id()/
 * auth_role()/auth_store_ids() (supabase/migrations) le lisent via
 * `auth.jwt()`. Même mécanisme que celui utilisé pendant toute cette
 * migration pour tester les RPC en direct (`set local role authenticated;
 * select set_config('request.jwt.claims', ...)`), ici en `pg` plutôt qu'en
 * SQL manuel via l'outil MCP.
 *
 * Isolation : chaque test ouvre sa propre transaction (BEGIN) et la fait
 * toujours rollback à la fin (afterEach), même en cas d'échec — aucun test
 * ne laisse de trace dans la base, aucun ordre de test ne peut en affecter
 * un autre.
 */
import { Client } from 'pg';

const LOCAL_DB_URL =
  process.env.SUPABASE_TEST_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

export interface JwtClaims {
  tenantId?: string | null;
  role?: string | null;
  storeIds?: string[] | null;
  sub?: string;
}

export class RlsTestClient {
  private client: Client;

  private constructor(client: Client) {
    this.client = client;
  }

  static async connect(): Promise<RlsTestClient> {
    const client = new Client({ connectionString: LOCAL_DB_URL });
    await client.connect();
    return new RlsTestClient(client);
  }

  /** Ouvre une transaction pour un test — à appeler dans beforeEach. */
  async begin() {
    await this.client.query('BEGIN');
  }

  /** Annule tout ce que le test a fait — à appeler dans afterEach, sans exception. */
  async rollback() {
    await this.client.query('ROLLBACK');
  }

  async close() {
    await this.client.end();
  }

  /**
   * Positionne la session courante comme si un utilisateur authentifié avec
   * ces claims JWT faisait la requête. `role: null` retombe sur le rôle
   * Postgres `anon` (utilisateur non connecté) plutôt que `authenticated`.
   */
  async actingAs(claims: JwtClaims) {
    const jwtClaims = {
      sub: claims.sub ?? '00000000-0000-0000-0000-000000000000',
      app_metadata: {
        tenant_id: claims.tenantId ?? null,
        role: claims.role ?? null,
        store_ids: claims.storeIds ?? null,
      },
    };
    await this.client.query(
      `select set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify(jwtClaims)]
    );
    await this.client.query(`set local role ${claims.role ? 'authenticated' : 'anon'}`);
  }

  /** Repasse en rôle service_role — contourne RLS, pour préparer les fixtures d'un test. */
  async actingAsService() {
    await this.client.query(`reset role`);
    await this.client.query(`set local role postgres`);
  }

  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ) {
    return this.client.query<T>(sql, params);
  }

  /**
   * Exécute une requête censée échouer (violation RLS, permission refusée),
   * à l'intérieur d'un SAVEPOINT propre à cet appel. Sans ça, l'échec
   * attendu laisse la transaction "abandonnée" côté Postgres ("current
   * transaction is aborted, commands ignored until end of transaction
   * block") et fait échouer toute requête suivante dans le même test —
   * y compris une lecture de vérification ou une deuxième assertion.
   * Renvoie l'erreur pour que le test inspecte son message.
   */
  async queryExpectingError(sql: string, params: unknown[] = []): Promise<Error> {
    await this.client.query('SAVEPOINT expected_error');
    try {
      await this.client.query(sql, params);
    } catch (err) {
      await this.client.query('ROLLBACK TO SAVEPOINT expected_error');
      return err as Error;
    }
    await this.client.query('ROLLBACK TO SAVEPOINT expected_error');
    throw new Error(`La requête a réussi alors qu'un échec était attendu : ${sql}`);
  }
}
