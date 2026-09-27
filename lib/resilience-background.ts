import { existsSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  claimPendingOperations,
  markOperationDone,
  markOperationError,
  recoverStuckSyncOperations,
  saveLocalSnapshot,
  setCentralDatabaseState,
} from "@/lib/local-resilience";

const dataDir = process.env.LOCAL_WAREHOUSE_DATA_DIR || "/opt/russian-forest-sklad/data";
const forceOfflineFile = join(dataDir, "FORCE_OFFLINE_TEST");
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
  try {
    const db = await getDb();
    await db.execute(sql`SELECT 1`);
    setCentralDatabaseState(true);
    return true;
  } catch (error) {
    setCentralDatabaseState(false, error instanceof Error ? error.message : String(error));
    return false;
  }
}

async function replayHardware() {
  const scope = "hardware:operations";
  const items = claimPendingOperations(scope, 20);
  if (!items.length) return;
  const { POST: livePost, GET: liveGet } = await import("@/app/api/warehouse/route");

  for (const item of items) {
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
        markOperationError(item.id, body.error || `HTTP ${response.status}`);
        setCentralDatabaseState(response.status < 500, body.error || `HTTP ${response.status}`);
        continue;
      }
      markOperationDone(item.id, scope);
      setCentralDatabaseState(true);
    } catch (error) {
      markOperationError(item.id, error);
      setCentralDatabaseState(false, error instanceof Error ? error.message : String(error));
      break;
    }
  }

  try {
    const response = await liveGet();
    const body = await response.clone().json().catch(() => null) as Record<string, unknown> | null;
    if (response.ok && body) {
      saveLocalSnapshot("hardware:snapshot", body);
      setCentralDatabaseState(true);
    }
  } catch {
    // Очередь уже сохранена локально; повторим на следующем цикле.
  }
}

async function replayDepartment(warehouse: "paint" | "ldsp") {
  const scope = `department:${warehouse}:operations`;
  const items = claimPendingOperations(scope, 20);
  if (!items.length) return;
  const { POST: livePost, GET: liveGet } = await import("@/app/api/department-warehouse/route");

  for (const item of items) {
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
        markOperationError(item.id, body.error || `HTTP ${response.status}`);
        setCentralDatabaseState(response.status < 500, body.error || `HTTP ${response.status}`);
        continue;
      }
      markOperationDone(item.id, scope);
      setCentralDatabaseState(true);
    } catch (error) {
      markOperationError(item.id, error);
      setCentralDatabaseState(false, error instanceof Error ? error.message : String(error));
      break;
    }
  }

  try {
    const request = new NextRequest("http://127.0.0.1:3000/api/department-warehouse", {
      method: "GET",
      headers: headersFor("Система", warehouse),
    });
    const response = await liveGet(request);
    const body = await response.clone().json().catch(() => null) as Record<string, unknown> | null;
    if (response.ok && body) {
      saveLocalSnapshot(`department:${warehouse}:snapshot`, body);
      setCentralDatabaseState(true);
    }
  } catch {
    // Повторим на следующем цикле.
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
    if (!online) return;
    await replayHardware();
    await replayDepartment("paint");
    await replayDepartment("ldsp");
  } finally {
    loopRunning = false;
  }
}
