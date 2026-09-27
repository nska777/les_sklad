import { mkdirSync, copyFileSync, existsSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type SyncStatus = "pending" | "syncing" | "done" | "error";
export type BackupKind = "hourly" | "daily";

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

const dataDir = process.env.LOCAL_WAREHOUSE_DATA_DIR || (process.env.NODE_ENV === "production" ? "/opt/russian-forest-sklad/data" : join(process.cwd(), "data"));
const dbPath = process.env.LOCAL_WAREHOUSE_DB || join(dataDir, "warehouse-local.sqlite");
const backupDir = join(dataDir, "backups");
let localDb: DatabaseSync | null = null;

function ensureDirs() {
  mkdirSync(dirname(dbPath), { recursive: true });
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
    CREATE TABLE IF NOT EXISTS resilience_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  localDb = db;
  return db;
}

function rowToOperation(row: Record<string, unknown>): QueuedOperation {
  return {
    id: String(row.id),
    scope: String(row.scope),
    action: String(row.action),
    payload: JSON.parse(String(row.payload || "{}")) as Record<string, unknown>,
    status: String(row.status) as SyncStatus,
    attempts: Number(row.attempts || 0),
    createdAt: String(row.created_at || ""),
    lastError: String(row.last_error || ""),
    syncedAt: String(row.synced_at || ""),
  };
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
  return rows.map(rowToOperation);
}

export function claimPendingOperations(scope: string, limit = 20): QueuedOperation[] {
  const db = getLocalDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const rows = db.prepare(`
      SELECT id, scope, action, payload, status, attempts, created_at, last_error, synced_at
      FROM sync_queue
      WHERE scope = ? AND status IN ('pending','error')
      ORDER BY created_at ASC
      LIMIT ?
    `).all(scope, limit) as Array<Record<string, unknown>>;
    const claimed: QueuedOperation[] = [];
    const update = db.prepare("UPDATE sync_queue SET status='syncing', attempts=attempts+1 WHERE id=? AND status IN ('pending','error')");
    for (const row of rows) {
      const result = update.run(String(row.id));
      if (Number(result.changes || 0) > 0) claimed.push({ ...rowToOperation(row), status: "syncing", attempts: Number(row.attempts || 0) + 1 });
    }
    db.exec("COMMIT");
    return claimed;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function recoverStuckSyncOperations() {
  getLocalDb().prepare("UPDATE sync_queue SET status='pending', last_error='Восстановлено после перезапуска' WHERE status='syncing'").run();
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

export function setCentralDatabaseState(online: boolean, error = "") {
  const db = getLocalDb();
  const now = new Date().toISOString();
  const values = [
    ["database_online", online ? "1" : "0"],
    ["database_error", error],
  ] as const;
  const stmt = db.prepare(`
    INSERT INTO resilience_state(key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
  `);
  for (const [key, value] of values) stmt.run(key, value, now);
}

export function getCentralDatabaseState() {
  const db = getLocalDb();
  const rows = db.prepare("SELECT key, value, updated_at FROM resilience_state WHERE key IN ('database_online','database_error')").all() as Array<{ key: string; value: string; updated_at: string }>;
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const onlineRow = byKey.get("database_online");
  return {
    known: Boolean(onlineRow),
    online: onlineRow ? onlineRow.value === "1" : true,
    error: byKey.get("database_error")?.value || "",
    updatedAt: onlineRow?.updated_at || "",
  };
}

export function localResilienceStatus() {
  const db = getLocalDb();
  const pending = Number((db.prepare("SELECT COUNT(*) AS count FROM sync_queue WHERE status IN ('pending','error','syncing')").get() as { count?: number } | undefined)?.count || 0);
  const snapshots = db.prepare("SELECT scope, updated_at FROM local_snapshots ORDER BY updated_at DESC").all() as Array<{ scope: string; updated_at: string }>;
  const database = getCentralDatabaseState();
  return { enabled: true, pending, database, snapshots: snapshots.map((x) => ({ scope: x.scope, updatedAt: x.updated_at })) };
}

function pruneBackups(kind: BackupKind, keep: number) {
  const prefix = `warehouse-local-${kind}-`;
  const files = readdirSync(backupDir)
    .filter((name) => name.startsWith(prefix) && name.endsWith(".sqlite"))
    .map((name) => ({ name, path: join(backupDir, name), mtime: statSync(join(backupDir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const old of files.slice(keep)) unlinkSync(old.path);
}

export function createLocalBackup(kind: BackupKind = "hourly") {
  ensureDirs();
  if (!existsSync(dbPath)) return null;
  const db = getLocalDb();
  db.exec("PRAGMA wal_checkpoint(FULL)");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = join(backupDir, `warehouse-local-${kind}-${stamp}.sqlite`);
  copyFileSync(dbPath, target);
  pruneBackups(kind, kind === "hourly" ? 48 : 30);
  return target;
}
