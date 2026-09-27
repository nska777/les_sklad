import { existsSync } from "node:fs";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { GET as liveGet, POST as livePost } from "@/app/api/department-warehouse/route";
import { applyDepartmentOfflineOperation } from "@/lib/department-offline";
import {
  claimPendingOperations,
  enqueueOperation,
  loadLocalSnapshot,
  markOperationDone,
  markOperationError,
  saveLocalSnapshot,
  setCentralDatabaseState,
} from "@/lib/local-resilience";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const syncCooldown = new Map<string, number>();
const dataDir = process.env.LOCAL_WAREHOUSE_DATA_DIR || "/opt/russian-forest-sklad/data";
const forceOfflineFile = join(dataDir, "FORCE_OFFLINE_TEST");

function forcedOffline() {
  return process.env.WAREHOUSE_FORCE_OFFLINE === "1" || existsSync(forceOfflineFile);
}

function scopes(warehouse: string) {
  return {
    snapshot: `department:${warehouse}:snapshot`,
    queue: `department:${warehouse}:operations`,
  };
}

function replayRequest(request: NextRequest, payload: Record<string, unknown>) {
  return new NextRequest(request.url.replace("/api/department-warehouse-resilient", "/api/department-warehouse"), {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(payload),
  });
}

async function syncPending(request: NextRequest, warehouse: string) {
  if (forcedOffline()) return;
  const { queue } = scopes(warehouse);
  const now = Date.now();
  const last = syncCooldown.get(queue) || 0;
  if (now - last < 15_000) return;
  syncCooldown.set(queue, now);

  const pending = claimPendingOperations(queue, 20);
  for (const item of pending) {
    try {
      const response = await livePost(replayRequest(request, item.payload));
      if (!response.ok) {
        const body = await response.clone().json().catch(() => ({})) as { error?: string };
        markOperationError(item.id, body.error || `HTTP ${response.status}`);
        setCentralDatabaseState(response.status < 500, body.error || `HTTP ${response.status}`);
        continue;
      }
      markOperationDone(item.id, queue);
      setCentralDatabaseState(true);
    } catch (error) {
      markOperationError(item.id, error);
      setCentralDatabaseState(false, error instanceof Error ? error.message : String(error));
      break;
    }
  }
}

export async function GET(request: NextRequest) {
  const warehouse = request.headers.get("x-warehouse-code") || "department";
  const { snapshot } = scopes(warehouse);

  if (forcedOffline()) {
    const cached = loadLocalSnapshot<Record<string, unknown>>(snapshot);
    if (cached) {
      return NextResponse.json({
        ...cached.payload,
        resilience: { mode: "offline", cached: true, forced: true, snapshotAt: cached.updatedAt },
      });
    }
    return NextResponse.json({
      error: "Тестовый офлайн-режим включён, но локальный снимок склада ещё не создан",
      resilience: { mode: "offline", cached: false, forced: true },
    }, { status: 503 });
  }

  try {
    await syncPending(request, warehouse);
    const response = await liveGet(request);
    const body = await response.clone().json().catch(() => null) as Record<string, unknown> | null;
    if (response.ok && body) {
      saveLocalSnapshot(snapshot, body);
      setCentralDatabaseState(true);
      return NextResponse.json({ ...body, resilience: { mode: "online", cached: false } }, { status: response.status });
    }
    if (response.status >= 500) setCentralDatabaseState(false, `HTTP ${response.status}`);
    const cached = loadLocalSnapshot<Record<string, unknown>>(snapshot);
    if (cached) {
      return NextResponse.json({ ...cached.payload, resilience: { mode: "offline", cached: true, snapshotAt: cached.updatedAt } });
    }
    return response;
  } catch (error) {
    setCentralDatabaseState(false, error instanceof Error ? error.message : String(error));
    const cached = loadLocalSnapshot<Record<string, unknown>>(snapshot);
    if (cached) {
      return NextResponse.json({ ...cached.payload, resilience: { mode: "offline", cached: true, snapshotAt: cached.updatedAt } });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Склад временно недоступен", resilience: { mode: "offline", cached: false } }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const warehouse = request.headers.get("x-warehouse-code") || "department";
  const operator = decodeURIComponent(request.headers.get("x-warehouse-user") || "Кладовщик");
  const { snapshot, queue } = scopes(warehouse);
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;

  if (!forcedOffline()) {
    try {
      await syncPending(request, warehouse);
      const response = await livePost(replayRequest(request, body));
      if (response.status < 500) {
        setCentralDatabaseState(true);
        return response;
      }
      setCentralDatabaseState(false, `HTTP ${response.status}`);
    } catch (error) {
      setCentralDatabaseState(false, error instanceof Error ? error.message : String(error));
    }
  }

  try {
    const operationId = crypto.randomUUID();
    const payload = { ...body, _operationId: operationId, _operator: operator, _warehouse: warehouse };
    const result = applyDepartmentOfflineOperation(snapshot, warehouse, operator, payload);
    enqueueOperation(queue, String(body.action || "operation"), payload, operationId);
    return NextResponse.json({
      ...result,
      operationId,
      resilience: { mode: "offline", queued: true, forced: forcedOffline() },
      message: "Операция сохранена локально. Система синхронизирует её автоматически после восстановления базы.",
    }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Операция недоступна в офлайн-режиме" }, { status: 503 });
  }
}
