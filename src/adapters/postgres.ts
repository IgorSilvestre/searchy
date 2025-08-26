import { Pool, PoolClient } from "pg";
import { CACHE_POOL_SIZE, POOL_MAX, STATEMENT_TIMEOUT_MS } from "../config";
import { logger } from "../utils/logger";
import { ExecutionResult, IntrospectionAdapter, RelationCard, RelationKind } from "./db";

const SYSTEM_SCHEMAS = ["pg_catalog", "information_schema"];

// Simple LRU cache for pools/adapters per dbUrl
class LRU<K, V> {
  private map = new Map<K, V>();
  constructor(private capacity: number) {}
  get(k: K): V | undefined {
    const v = this.map.get(k);
    if (v !== undefined) {
      this.map.delete(k);
      this.map.set(k, v);
    }
    return v;
  }
  set(k: K, v: V) {
    if (this.map.has(k)) this.map.delete(k);
    this.map.set(k, v);
    if (this.map.size > this.capacity) {
      const first = this.map.keys().next().value;
      if (first !== undefined) this.map.delete(first);
    }
  }
}

const poolCache = new LRU<string, Pool>(CACHE_POOL_SIZE);

export function getPool(dbUrl: string): Pool {
  const cached = poolCache.get(dbUrl);
  if (cached) return cached;
  const pool = new Pool({ connectionString: dbUrl, max: POOL_MAX });
  poolCache.set(dbUrl, pool);
  return pool;
}

export class PostgresAdapter implements IntrospectionAdapter {
  private timeoutMs: number = STATEMENT_TIMEOUT_MS;
  constructor(private pool: Pool) {}

  static fromUrl(dbUrl: string) {
    return new PostgresAdapter(getPool(dbUrl));
  }

  async testConnection(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await this.query(client, "SELECT 1");
    } finally {
      client.release();
    }
  }

  async listRelations(): Promise<{ name: string; kind: RelationKind }[]> {
    const sql = `
      SELECT n.nspname AS schema, c.relname AS name,
             CASE c.relkind WHEN 'v' THEN 'view' WHEN 'm' THEN 'view' ELSE 'table' END AS kind
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname NOT IN ('pg_catalog','information_schema')
        AND c.relkind IN ('r','v','m') -- table, view, matview
      ORDER BY 1,2
    `;
    const { rows } = await this.query(this.pool, sql);
    return rows.map((r: any) => ({ name: `${r.schema}.${r.name}`, kind: r.kind as RelationKind }));
  }

  async describeRelation(name: string): Promise<RelationCard> {
    const [schema, rel] = name.split(".");
    const columnsSql = `
      SELECT a.attname AS name,
             pg_catalog.format_type(a.atttypid, a.atttypmod) AS type,
             NOT a.attnotnull AS nullable,
             EXISTS (
               SELECT 1 FROM pg_index i
               WHERE i.indrelid = c.oid AND a.attnum = ANY(i.indkey) AND i.indisprimary
             ) AS pk,
             EXISTS (
               SELECT 1 FROM pg_index i WHERE i.indrelid = c.oid AND a.attnum = ANY(i.indkey) AND i.indisvalid
             ) AS indexed
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY a.attnum
    `;
    const rowEstimateSql = `
      SELECT c.reltuples::bigint AS row_estimate,
             CASE c.relkind WHEN 'v' THEN 'view' WHEN 'm' THEN 'view' ELSE 'table' END AS kind
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relname = $2
    `;

    const [colsRes, estRes] = await Promise.all([
      this.query(this.pool, columnsSql, [schema, rel]),
      this.query(this.pool, rowEstimateSql, [schema, rel]),
    ]);
    const columns = colsRes.rows.map((r: any) => ({
      name: r.name as string,
      type: String(r.type),
      pk: !!r.pk,
      indexed: !!r.indexed,
      nullable: !!r.nullable,
    }));
    const kind = (estRes.rows[0]?.kind as RelationKind) || "table";
    const row_estimate = Number(estRes.rows[0]?.row_estimate) || undefined;
    return { name, kind, columns, join_hints: [], row_estimate };
  }

  async listRelationships(): Promise<Array<{ from: string; column: string; to: string; toColumn: string }>> {
    const sql = `
      SELECT
        nf.nspname AS from_schema,
        cf.relname AS from_table,
        af.attname AS from_column,
        nt.nspname AS to_schema,
        ct.relname AS to_table,
        at2.attname AS to_column
      FROM pg_constraint con
      JOIN pg_class cf ON cf.oid = con.conrelid
      JOIN pg_namespace nf ON nf.oid = cf.relnamespace
      JOIN pg_class ct ON ct.oid = con.confrelid
      JOIN pg_namespace nt ON nt.oid = ct.relnamespace
      JOIN pg_attribute af ON af.attrelid = con.conrelid AND af.attnum = ANY (con.conkey)
      JOIN pg_attribute at2 ON at2.attrelid = con.confrelid AND at2.attnum = ANY (con.confkey)
      WHERE con.contype = 'f'
        AND nf.nspname NOT IN ('pg_catalog','information_schema')
        AND nt.nspname NOT IN ('pg_catalog','information_schema')
    `;
    const { rows } = await this.query(this.pool, sql);
    return rows.map((r: any) => ({
      from: `${r.from_schema}.${r.from_table}`,
      column: String(r.from_column),
      to: `${r.to_schema}.${r.to_table}`,
      toColumn: String(r.to_column),
    }));
  }

  async setTimeoutMs(ms: number): Promise<void> {
    this.timeoutMs = ms;
  }

  private async withClient<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      // PostgreSQL does not accept parameter placeholders in SET commands.
      // Use a literal numeric value (milliseconds) instead.
      const timeout = Number(this.timeoutMs) || 0;
      await this.query(client, `SET statement_timeout TO ${timeout}`);
      const res = await fn(client);
      return res;
    } finally {
      try { await this.query(client, "SET statement_timeout TO DEFAULT"); } catch {}
      client.release();
    }
  }

  async runSelect(sql: string, params?: any[]): Promise<ExecutionResult> {
    return this.withClient(async (client) => {
      const result = await this.query(client, sql, params ?? []);
      return { rows: result.rows, rowCount: result.rowCount };
    });
  }

  private async query<T extends { query: (text: string, values?: any[]) => Promise<any> }>(
    clientOrPool: T,
    sql: string,
    params?: any[]
  ) {
    // Always log attempted SQL and params before execution
    try {
      logger.info("sql_try", { sql, params: params ?? [] });
    } catch {}
    return clientOrPool.query(sql, params ?? []);
  }
}
