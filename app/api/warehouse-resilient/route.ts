import { existsSync } from "node:fs";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { GET as liveGet, POST as livePost } from "@/app/api/warehouse/route";
import { applyHardwareOfflineOperation } from "@/lib/hardware-offline";
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

const snapshotScope = "hardware:snapshot";
const queueScope = "hardware:operations";
const syncCooldown = new Map<string, number>();
const dataDir = process.env.LOCAL_WAREHOUSE_DATA_DIR || "/opt/russian-forest-sklad/data";
const forceOfflineFile = join(dataDir, "FORCE_OFFLINE_TEST");

function forcedOffline() {
  return process.env.WAREHOUSE_FORCE_OFFLINE === "1" || existsSync(forceOfflineFile);
}

function replayRequest(request: NextRequest, payload: Record<string, unknown>) {
  return new NextRequest(request.url.replace("/api/warehouse-resilient", "/api/warehouse"), {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(payload),
  });
}

async function syncPending(request: NextRequest) {
  if (forcedOffline()) return;
  const now = Date.now();
  const last = syncCooldown.get(queueScope) || 0;
  if (now - last < 15_000) return;
  syncCooldown.set(queueScope, now);

  const pending = claimPendingOperations(queueScope, 30);
  for (const item of pending) {
    try {
      const response = await livePost(replayRequest(request, item.payload));
      if (!response.ok) {
        const body = await response.clone().json().catch(() => ({})) as { error?: string };
        markOperationError(item.id, body.error || `HTTP ${response.status}`);
        setCentralDatabaseState(response.status < 500, body.error || `HTTP ${response.status}`);
        continue;
      }
      markOperationDone(item.id, queueScope);
      setCentralDatabaseState(true);
    } catch (error) {
      markOperationError(item.id, error);
      setCentralDatabaseState(false, error instanceof Error ? error.message : String(error));
      break;
    }
  }
}

export async function GET(request: NextRequest) {
  if (forcedOffline()) {
    const cached = loadLocalSnapshot<Record<string, unknown>>(snapshotScope);
    if (cached) {
      return NextResponse.json({ ...cached.payload, resilience: { mode: "offline", cached: true, forced: true, snapshotAt: cached.updatedAt } });
    }
    return NextResponse.json({ error: "Офлайн-режим включён, но локальный снимок склада фурнитуры ещё не создан", resilience: { mode: "offline", cached: false, forced: true } }, { status: 503 });
  }

  try {
    await syncPending(request);
    const response = await liveGet();
    const body = await response.clone().json().catch(() => null) as Record<string, unknown> | null;
    if (response.ok && body) {
      saveLocalSnapshot(snapshotScope, body);
      setCentralDatabaseState(true);
      return NextResponse.json({ ...body, resilience: { mode: "online", cached: false } }, { status: response.status });
    }
    if (response.status >= 500) setCentralDatabaseState(false, `HTTP ${response.status}`);
    const cached = loadLocalSnapshot<Record<string, unknown>>(snapshotScope);
    if (cached) return NextResponse.json({ ...cached.payload, resilience: { mode: "offline", cached: true, snapshotAt: cached.updatedAt } });
    return response;
  } catch (error) {
    setCentralDatabaseState(false, error instanceof Error ? error.message : String(error));
    const cached = loadLocalSnapshot<Record<string, unknown>>(snapshotScope);
    if (cached) return NextResponse.json({ ...cached.payload, resilience: { mode: "offline", cached: true, snapshotAt: cached.updatedAt } });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Склад фурнитуры временно недоступен", resilience: { mode: "offline", cached: false } }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const operator = decodeURIComponent(request.headers.get("x-warehouse-user") || "Кладовщик");
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;

  if (!forcedOffline()) {
    try {
      await syncPending(request);
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
    const payload = { ...body, _operationId: operationId, _operator: operator, _warehouse: "hardware" };
    const result = applyHardwareOfflineOperation(snapshotScope, operator, payload);
    enqueueOperation(queueScope, String(body.action || "operation"), payload, operationId);
    return NextResponse.json({ ...result, operationId, resilience: { mode: "offline", queued: true, forced: forcedOffline() }, message: "Операция сохранена локально. Система синхронизирует её автоматически после восстановления базы." }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Операция недоступна в офлайн-режиме" }, { status: 503 });
  }
}
