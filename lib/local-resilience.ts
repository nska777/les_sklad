import { mkdirSync, copyFileSync, existsSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type SyncStatus = "pending" | "syncing" | "done" | "error";

export type QueuedOperation = {
  id: string;
  scope: string;
  action: string;
  payload: Record<string, unknown>;
  status: SyncStatus;
  attempts: number;
  createdAt: string;
  lastError: string;
  syncedAt: string;
};

const dataDir = process.env.LOCAL_WAREHOUSE_DATA_DIR || join(process.cwd(), "data");
const dbPath = process.env.LOCAL_WAREHOUSE_DB || join(dataDir, "warehouse-local.sqlite");
const backupDir = join(dataDir, "backups");
let localDb: DatabaseSync | null = null;

function ensureDirs() {
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(backupDir, { recursive: true });
}

function getLocalDb() {
  if (localDb) return localDb;
  ensureDirs();
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA synchronous=NORMAL");
  db.exec("PRAGMA busy_timeout=5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS local_snapshots (
      scope TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sync_queue (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      action TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      last_error TEXT NOT NULL DEFAULT '',
      synced_at TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_sync_queue_status_created ON sync_queue(status, created_at);
    CREATE TABLE IF NOT EXISTS applied_operations (
      operation_id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
  localDb = db;
  return db;
}

export function saveLocalSnapshot(scope: string, payload: unknown) {
  const db = getLocalDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO local_snapshots(scope, payload, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(scope) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at
  `).run(scope, JSON.stringify(payload), now);
  return now;
}

export function loadLocalSnapshot<T>(scope: string): { payload: T; updatedAt: string } | null {
  const db = getLocalDb();
  const row = db.prepare("SELECT payload, updated_at FROM local_snapshots WHERE scope = ?").get(scope) as { payload?: string; updated_at?: string } | undefined;
  if (!row?.payload || !row.updated_at) return null;
  try {
    return { payload: JSON.parse(row.payload) as T, updatedAt: row.updated_at };
  } catch {
    return null;
  }
}

export function enqueueOperation(scope: string, action: string, payload: Record<string, unknown>, operationId = crypto.randomUUID()) {
  const db = getLocalDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR IGNORE INTO sync_queue(id, scope, action, payload, status, attempts, created_at, last_error, synced_at)
    VALUES (?, ?, ?, ?, 'pending', 0, ?, '', '')
  `).run(operationId, scope, action, JSON.stringify(payload), now);
  return operationId;
}

export function listPendingOperations(limit = 100): QueuedOperation[] {
  const db = getLocalDb();
  const rows = db.prepare(`
    SELECT id, scope, action, payload, status, attempts, created_at, last_error, synced_at
    FROM sync_queue
    WHERE status IN ('pending','error')
    ORDER BY created_at ASC
    LIMIT ?
  `).all(limit) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id),
    scope: String(row.scope),
    action: String(row.action),
    payload: JSON.parse(String(row.payload || "{}")) as Record<string, unknown>,
    status: String(row.status) as SyncStatus,
    attempts: Number(row.attempts || 0),
    createdAt: String(row.created_at || ""),
    lastError: String(row.last_error || ""),
    syncedAt: String(row.synced_at || ""),
  }));
}

export function markOperationSyncing(id: string) {
  getLocalDb().prepare("UPDATE sync_queue SET status='syncing', attempts=attempts+1 WHERE id=?").run(id);
}

export function markOperationDone(id: string, scope: string) {
  const db = getLocalDb();
  const now = new Date().toISOString();
  db.prepare("UPDATE sync_queue SET status='done', last_error='', synced_at=? WHERE id=?").run(now, id);
  db.prepare("INSERT OR IGNORE INTO applied_operations(operation_id, scope, applied_at) VALUES (?, ?, ?)").run(id, scope, now);
}

export function markOperationError(id: string, error: unknown) {
  getLocalDb().prepare("UPDATE sync_queue SET status='error', last_error=? WHERE id=?").run(error instanceof Error ? error.message : String(error), id);
}

export function operationWasApplied(id: string) {
  return Boolean(getLocalDb().prepare("SELECT operation_id FROM applied_operations WHERE operation_id=?").get(id));
}

export function localResilienceStatus() {
  const db = getLocalDb();
  const pending = Number((db.prepare("SELECT COUNT(*) AS count FROM sync_queue WHERE status IN ('pending','error','syncing')").get() as { count?: number } | undefined)?.count || 0);
  const snapshots = db.prepare("SELECT scope, updated_at FROM local_snapshots ORDER BY updated_at DESC").all() as Array<{ scope: string; updated_at: string }>;
  return { enabled: true, pending, snapshots: snapshots.map((x) => ({ scope: x.scope, updatedAt: x.updated_at })) };
}

export function createLocalBackup() {
  ensureDirs();
  if (!existsSync(dbPath)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = join(backupDir, `warehouse-local-${stamp}.sqlite`);
  copyFileSync(dbPath, target);
  const files = readdirSync(backupDir)
    .filter((name) => name.startsWith("warehouse-local-") && name.endsWith(".sqlite"))
    .map((name) => ({ name, path: join(backupDir, name), mtime: statSync(join(backupDir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const old of files.slice(48)) unlinkSync(old.path);
  return target;
}
