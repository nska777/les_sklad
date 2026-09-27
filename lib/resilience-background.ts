import { existsSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  beginCentralDatabaseProbe,
  canUseCentralDatabase,
  databaseCircuitState,
  recordCentralDatabaseFailure,
  recordCentralDatabaseSuccess,
} from "@/lib/db-circuit-breaker";
import {
  claimPendingOperations,
  markOperationDone,
  markOperationError,
  recoverStuckSyncOperations,
  setCentralDatabaseState,
} from "@/lib/local-resilience";

const dataDir = process.env.LOCAL_WAREHOUSE_DATA_DIR || "/opt/russian-forest-sklad/data";
const forceOfflineFile = join(dataDir, "FORCE_OFFLINE_TEST");
const replayBatchSize = Math.max(1, Number(process.env.DB_SYNC_BATCH_SIZE || 5));
let loopRunning = false;

function forcedOffline() {
  return process.env.WAREHOUSE_FORCE_OFFLINE === "1" || existsSync(forceOfflineFile);
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function headersFor(operator: string, warehouse: string) {
  return new Headers({
    "content-type": "application/json",
    "x-warehouse-user": encodeURIComponent(operator || "Кладовщик"),
    "x-warehouse-code": warehouse,
  });
}

async function probeCentralDatabase() {
  if (!beginCentralDatabaseProbe()) return false;
  try {
    const db = await getDb();
    await db.execute(sql`SELECT 1`);
    recordCentralDatabaseSuccess();
    setCentralDatabaseState(true);
    return true;
  } catch (error) {
    recordCentralDatabaseFailure(error);
    setCentralDatabaseState(false, error instanceof Error ? error.message : String(error));
    return false;
  }
}

async function replayHardware() {
  if (!canUseCentralDatabase()) return;
  const scope = "hardware:operations";
  const items = claimPendingOperations(scope, replayBatchSize);
  if (!items.length) return;
  const { POST: livePost } = await import("@/app/api/warehouse/route");

  for (const item of items) {
    if (!canUseCentralDatabase()) break;
    try {
      const operator = text(item.payload._operator) || "Кладовщик";
      const request = new NextRequest("http://127.0.0.1:3000/api/warehouse", {
        method: "POST",
        headers: headersFor(operator, "hardware"),
        body: JSON.stringify(item.payload),
      });
      const response = await livePost(request);
      if (!response.ok) {
        const body = await response.clone().json().catch(() => ({})) as { error?: string };
        const message = body.error || `HTTP ${response.status}`;
        markOperationError(item.id, message);
        if (response.status >= 500) {
          recordCentralDatabaseFailure(message);
          setCentralDatabaseState(false, message);
          break;
        }
        continue;
      }
      markOperationDone(item.id, scope);
      recordCentralDatabaseSuccess();
      setCentralDatabaseState(true);
    } catch (error) {
      markOperationError(item.id, error);
      recordCentralDatabaseFailure(error);
      setCentralDatabaseState(false, error instanceof Error ? error.message : String(error));
      break;
    }
  }
}

async function replayDepartment(warehouse: "paint" | "ldsp") {
  if (!canUseCentralDatabase()) return;
  const scope = `department:${warehouse}:operations`;
  const items = claimPendingOperations(scope, replayBatchSize);
  if (!items.length) return;
  const { POST: livePost } = await import("@/app/api/department-warehouse/route");

  for (const item of items) {
    if (!canUseCentralDatabase()) break;
    try {
      const operator = text(item.payload._operator) || "Кладовщик";
      const request = new NextRequest("http://127.0.0.1:3000/api/department-warehouse", {
        method: "POST",
        headers: headersFor(operator, warehouse),
        body: JSON.stringify(item.payload),
      });
      const response = await livePost(request);
      if (!response.ok) {
        const body = await response.clone().json().catch(() => ({})) as { error?: string };
        const message = body.error || `HTTP ${response.status}`;
        markOperationError(item.id, message);
        if (response.status >= 500) {
          recordCentralDatabaseFailure(message);
          setCentralDatabaseState(false, message);
          break;
        }
        continue;
      }
      markOperationDone(item.id, scope);
      recordCentralDatabaseSuccess();
      setCentralDatabaseState(true);
    } catch (error) {
      markOperationError(item.id, error);
      recordCentralDatabaseFailure(error);
      setCentralDatabaseState(false, error instanceof Error ? error.message : String(error));
      break;
    }
  }
}

export function recoverBackgroundSyncQueue() {
  recoverStuckSyncOperations();
}

export async function runBackgroundSyncOnce() {
  if (loopRunning || forcedOffline()) return;
  loopRunning = true;
  try {
    const online = await probeCentralDatabase();
    if (!online) {
      const state = databaseCircuitState();
      if (state.mode === "open") {
        console.warn(`[resilience] PostgreSQL circuit open; next probe in ${Math.ceil(state.remainingMs / 1000)}s`);
      }
      return;
    }
    await replayHardware();
    await replayDepartment("paint");
    await replayDepartment("ldsp");
  } finally {
    loopRunning = false;
  }
}
