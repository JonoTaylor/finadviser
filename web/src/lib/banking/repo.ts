import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import type { ProviderSlug } from '@/lib/banking/aggregator';

const {
  providers,
  connections,
  providerAccounts,
  syncRuns,
} = schema;

export type ConnectionStatus = 'pending' | 'active' | 'expiring' | 'expired' | 'revoked' | 'error';
export type SyncRunStatus = 'running' | 'success' | 'partial' | 'error';

export interface ProviderRow {
  id: number;
  slug: ProviderSlug;
  displayName: string;
  aggregator: 'gocardless_bad' | 'truelayer';
}

export interface ConnectionRow {
  id: number;
  providerId: number;
  providerSlug: ProviderSlug;
  providerDisplayName: string;
  ownerId: number | null;
  aggregatorRef: string;
  status: ConnectionStatus;
  consentExpiresAt: Date | null;
  lastSyncedAt: Date | null;
  lastError: string | null;
  institutionId: string;
  institutionName: string;
  createdAt: Date;
}

export interface ProviderAccountRow {
  id: number;
  connectionId: number;
  accountId: number;
  accountName: string;
  aggregatorAccountRef: string;
  iban: string | null;
  currency: string;
  product: string | null;
  cutoverDate: string | null;
}

export const bankingRepo = {
  // ── Provider catalogue ─────────────────────────────────────────
  async listProviders(): Promise<ProviderRow[]> {
    const db = getDb();
    const rows = await db.select().from(providers).orderBy(providers.id);
    return rows.map(r => ({
      id: r.id,
      slug: r.slug as ProviderSlug,
      displayName: r.displayName,
      aggregator: r.aggregator,
    }));
  },

  async getProviderBySlug(slug: ProviderSlug): Promise<ProviderRow | null> {
    const db = getDb();
    const rows = await db.select().from(providers).where(eq(providers.slug, slug)).limit(1);
    if (rows.length === 0) return null;
    const r = rows[0];
    return { id: r.id, slug: r.slug as ProviderSlug, displayName: r.displayName, aggregator: r.aggregator };
  },

  // ── Connections ────────────────────────────────────────────────
  async listConnections(): Promise<ConnectionRow[]> {
    const db = getDb();
    const rows = await db.execute(sql`
      SELECT
        c.id, c.provider_id AS "providerId", c.owner_id AS "ownerId",
        c.aggregator_ref AS "aggregatorRef", c.status,
        c.consent_expires_at AS "consentExpiresAt",
        c.last_synced_at AS "lastSyncedAt", c.last_error AS "lastError",
        c.institution_id AS "institutionId", c.institution_name AS "institutionName",
        c.created_at AS "createdAt",
        p.slug AS "providerSlug", p.display_name AS "providerDisplayName"
      FROM connections c
      JOIN providers p ON p.id = c.provider_id
      ORDER BY c.created_at DESC
    `);
    return rows.rows.map(rowToConnection);
  },

  async getConnection(id: number): Promise<ConnectionRow | null> {
    const db = getDb();
    const rows = await db.execute(sql`
      SELECT
        c.id, c.provider_id AS "providerId", c.owner_id AS "ownerId",
        c.aggregator_ref AS "aggregatorRef", c.status,
        c.consent_expires_at AS "consentExpiresAt",
        c.last_synced_at AS "lastSyncedAt", c.last_error AS "lastError",
        c.institution_id AS "institutionId", c.institution_name AS "institutionName",
        c.created_at AS "createdAt",
        p.slug AS "providerSlug", p.display_name AS "providerDisplayName"
      FROM connections c
      JOIN providers p ON p.id = c.provider_id
      WHERE c.id = ${id}
      LIMIT 1
    `);
    if (rows.rows.length === 0) return null;
    return rowToConnection(rows.rows[0]);
  },

  async createPendingConnection(data: {
    providerId: number;
    ownerId: number | null;
    aggregatorRef: string;
    consentExpiresAt: Date;
    institutionId: string;
    institutionName: string;
  }): Promise<ConnectionRow> {
    const db = getDb();
    const [row] = await db
      .insert(connections)
      .values({
        providerId: data.providerId,
        ownerId: data.ownerId,
        aggregatorRef: data.aggregatorRef,
        status: 'pending',
        consentExpiresAt: data.consentExpiresAt,
        institutionId: data.institutionId,
        institutionName: data.institutionName,
      })
      .returning({ id: connections.id });
    const created = await this.getConnection(row.id);
    if (!created) throw new Error(`Failed to read back connection ${row.id} after create`);
    return created;
  },

  async setConnectionStatus(
    id: number,
    status: ConnectionStatus,
    extra?: { lastError?: string | null; consentExpiresAt?: Date | null },
  ) {
    const db = getDb();
    await db
      .update(connections)
      .set({
        status,
        lastError: extra?.lastError ?? null,
        ...(extra?.consentExpiresAt !== undefined ? { consentExpiresAt: extra.consentExpiresAt } : {}),
        updatedAt: new Date(),
      })
      .where(eq(connections.id, id));
  },

  async markSynced(id: number, when: Date = new Date()) {
    const db = getDb();
    await db
      .update(connections)
      .set({ lastSyncedAt: when, updatedAt: new Date() })
      .where(eq(connections.id, id));
  },

  async deleteConnection(id: number) {
    const db = getDb();
    // CASCADE on FKs handles provider_accounts + sync_runs.
    await db.delete(connections).where(eq(connections.id, id));
  },

  // ── Provider accounts ─────────────────────────────────────────
  async listProviderAccounts(connectionId: number): Promise<ProviderAccountRow[]> {
    const db = getDb();
    const rows = await db.execute(sql`
      SELECT
        pa.id, pa.connection_id AS "connectionId",
        pa.account_id AS "accountId", a.name AS "accountName",
        pa.aggregator_account_ref AS "aggregatorAccountRef",
        pa.iban, pa.currency, pa.product,
        pa.cutover_date AS "cutoverDate"
      FROM provider_accounts pa
      JOIN accounts a ON a.id = pa.account_id
      WHERE pa.connection_id = ${connectionId}
      ORDER BY pa.id
    `);
    return rows.rows.map(rowToProviderAccount);
  },

  async upsertProviderAccount(data: {
    connectionId: number;
    accountId: number;
    aggregatorAccountRef: string;
    iban: string | null;
    currency: string;
    product: string | null;
    cutoverDate: string | null;
  }): Promise<ProviderAccountRow> {
    const db = getDb();
    await db
      .insert(providerAccounts)
      .values({
        connectionId: data.connectionId,
        accountId: data.accountId,
        aggregatorAccountRef: data.aggregatorAccountRef,
        iban: data.iban,
        currency: data.currency,
        product: data.product,
        cutoverDate: data.cutoverDate,
      })
      .onConflictDoUpdate({
        target: providerAccounts.aggregatorAccountRef,
        set: {
          connectionId: data.connectionId,
          accountId: data.accountId,
          iban: data.iban,
          currency: data.currency,
          product: data.product,
          cutoverDate: data.cutoverDate,
        },
      });
    const rows = await db
      .select()
      .from(providerAccounts)
      .where(
        and(
          eq(providerAccounts.connectionId, data.connectionId),
          eq(providerAccounts.aggregatorAccountRef, data.aggregatorAccountRef),
        ),
      )
      .limit(1);
    const r = rows[0];
    return {
      id: r.id,
      connectionId: r.connectionId,
      accountId: r.accountId,
      accountName: '',  // filled by listProviderAccounts; unused on this code path
      aggregatorAccountRef: r.aggregatorAccountRef,
      iban: r.iban,
      currency: r.currency,
      product: r.product,
      cutoverDate: r.cutoverDate,
    };
  },

  // ── Sync runs ──────────────────────────────────────────────────
  async startSyncRun(connectionId: number): Promise<number> {
    const db = getDb();
    const [row] = await db
      .insert(syncRuns)
      .values({ connectionId, status: 'running' })
      .returning({ id: syncRuns.id });
    return row.id;
  },

  async finishSyncRun(
    runId: number,
    data: { status: SyncRunStatus; txnsAdded: number; txnsUpdated: number; errorMessage?: string | null },
  ) {
    const db = getDb();
    await db
      .update(syncRuns)
      .set({
        status: data.status,
        txnsAdded: data.txnsAdded,
        txnsUpdated: data.txnsUpdated,
        errorMessage: data.errorMessage ?? null,
        finishedAt: new Date(),
      })
      .where(eq(syncRuns.id, runId));
  },

  async listRecentSyncRuns(connectionId: number, limit = 10) {
    const db = getDb();
    const rows = await db
      .select()
      .from(syncRuns)
      .where(eq(syncRuns.connectionId, connectionId))
      .orderBy(desc(syncRuns.startedAt))
      .limit(limit);
    return rows;
  },
};

// ── Row mappers ─────────────────────────────────────────────────

function rowToConnection(r: Record<string, unknown>): ConnectionRow {
  return {
    id: r.id as number,
    providerId: r.providerId as number,
    providerSlug: r.providerSlug as ProviderSlug,
    providerDisplayName: r.providerDisplayName as string,
    ownerId: (r.ownerId as number | null) ?? null,
    aggregatorRef: r.aggregatorRef as string,
    status: r.status as ConnectionStatus,
    consentExpiresAt: parseDate(r.consentExpiresAt),
    lastSyncedAt: parseDate(r.lastSyncedAt),
    lastError: (r.lastError as string | null) ?? null,
    institutionId: r.institutionId as string,
    institutionName: r.institutionName as string,
    createdAt: parseDate(r.createdAt) ?? new Date(0),
  };
}

function rowToProviderAccount(r: Record<string, unknown>): ProviderAccountRow {
  return {
    id: r.id as number,
    connectionId: r.connectionId as number,
    accountId: r.accountId as number,
    accountName: r.accountName as string,
    aggregatorAccountRef: r.aggregatorAccountRef as string,
    iban: (r.iban as string | null) ?? null,
    currency: r.currency as string,
    product: (r.product as string | null) ?? null,
    cutoverDate: (r.cutoverDate as string | null) ?? null,
  };
}

function parseDate(v: unknown): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === 'string') return new Date(v);
  return null;
}
