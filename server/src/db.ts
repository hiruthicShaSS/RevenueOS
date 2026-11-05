import fs from "node:fs";
import { config } from "./config.js";

/**
 * Structured business data (customers, deals, commitments...) lives in Postgres.
 * Conversational memory lives in Hindsight. The two are deliberately separate.
 *
 * DATABASE_URL set  -> regular Postgres via `pg`
 * DATABASE_URL empty -> PGlite (Postgres compiled to WASM) persisted on disk
 */
export interface Db {
  query<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
}

let db: Db | null = null;

export async function getDb(): Promise<Db> {
  if (db) return db;
  if (config.databaseUrl) {
    const pg = await import("pg");
    const pool = new pg.default.Pool({ connectionString: config.databaseUrl });
    db = {
      async query(sql, params) {
        const r = await pool.query(sql, params as any[]);
        return r.rows;
      },
      async exec(sql) {
        await pool.query(sql);
      },
    };
  } else {
    const { PGlite } = await import("@electric-sql/pglite");
    fs.mkdirSync(config.dataDir, { recursive: true });
    acquireLock(config.dataDir);
    const lite = new PGlite(config.dataDir);
    await lite.waitReady;
    closeHook = () => lite.close();
    db = {
      async query(sql, params) {
        const r = await lite.query(sql, params as any[]);
        return r.rows as any[];
      },
      async exec(sql) {
        await lite.exec(sql);
      },
    };
  }
  await migrate(db);
  return db;
}

let closeHook: (() => Promise<void>) | null = null;
let lockPath: string | null = null;

/**
 * PGlite has no cross-process locking: two servers opening the same data
 * directory corrupt it. Refuse to start if another live process holds it.
 */
function acquireLock(dir: string) {
  lockPath = `${dir}.lock`;
  try {
    const pid = Number(fs.readFileSync(lockPath, "utf8"));
    if (pid && pid !== process.pid && isAlive(pid)) {
      throw new Error(
        `Database ${dir} is already in use by process ${pid}. Stop that server first ` +
          `(two servers on one embedded database would corrupt it).`
      );
    }
  } catch (e: any) {
    if (e?.code !== "ENOENT") throw e;
  }
  fs.writeFileSync(lockPath, String(process.pid));
}

function isAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e?.code === "EPERM";
  }
}

/** Flush and close the embedded database so it is never left half-written. */
export async function closeDb() {
  try {
    await closeHook?.();
  } finally {
    closeHook = null;
    db = null;
    if (lockPath) fs.rmSync(lockPath, { force: true });
  }
}

async function migrate(d: Db) {
  await d.exec(`
    CREATE TABLE IF NOT EXISTS reps (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      title TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      industry TEXT NOT NULL,
      employees INT,
      hq TEXT,
      website TEXT,
      summary TEXT,
      health TEXT NOT NULL DEFAULT 'neutral',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS deals (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      amount NUMERIC NOT NULL,
      stage TEXT NOT NULL,
      probability INT NOT NULL,
      close_date DATE,
      owner_id TEXT REFERENCES reps(id),
      status TEXT NOT NULL DEFAULT 'open',
      outcome_reason TEXT,
      primary_blocker TEXT,
      risk TEXT NOT NULL DEFAULT 'low',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS stakeholders (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      role TEXT,
      stance TEXT,
      priorities TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (customer_id, name)
    );

    CREATE TABLE IF NOT EXISTS interactions (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      rep_id TEXT REFERENCES reps(id),
      kind TEXT NOT NULL,
      occurred_at TIMESTAMPTZ NOT NULL,
      raw_text TEXT NOT NULL,
      analysis JSONB,
      memory_status TEXT NOT NULL DEFAULT 'pending',
      memory_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS commitments (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      interaction_id TEXT REFERENCES interactions(id) ON DELETE SET NULL,
      owner TEXT NOT NULL,
      promised_to TEXT,
      description TEXT NOT NULL,
      due_date DATE,
      status TEXT NOT NULL DEFAULT 'open',
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS objections (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      interaction_id TEXT REFERENCES interactions(id) ON DELETE SET NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      raised_by TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS offers (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      interaction_id TEXT REFERENCES interactions(id) ON DELETE SET NULL,
      description TEXT NOT NULL,
      discount_pct NUMERIC,
      response TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Only used when MEMORY_MODE=mock (offline UI work). Never used with real Hindsight.
    CREATE TABLE IF NOT EXISTS mock_memories (
      id TEXT PRIMARY KEY,
      bank_id TEXT NOT NULL,
      text TEXT NOT NULL,
      context TEXT,
      fact_type TEXT,
      document_id TEXT,
      occurred_at TIMESTAMPTZ,
      tags TEXT[],
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}
