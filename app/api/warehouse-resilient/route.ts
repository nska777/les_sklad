import { existsSync } from "node:fs";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { GET as liveGet, POST as livePost } from "@/app/api/warehouse/route";
import { applyHardwareOfflineOperation } from "@/lib/hardware-offline";
import {
  enqueueOperation,
  listPendingOperations,
  loadLocalSnapshot,
  markOperationDone,
  markOperationError,
  markOperationSyncing,
  saveLocalSnapshot,
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

  const pending = listPendingOperations(30).filter((item) => item.scope === queueScope);
  for (const item of pending) {
    markOperationSyncing(item.id);
    try {
      const response = await livePost(replayRequest(request, item.payload));
      if (!response.ok) {
        const body = await response.clone().json().catch(() => ({})) as { error?: string };
        markOperationError(item.id, body.error || `HTTP ${response.status}`);
        break;
      }
      markOperationDone(item.id, queueScope);
    } catch (error) {
      markOperationError(item.id, error);
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
      return NextResponse.json({ ...body, resilience: { mode: "online", cached: false } }, { status: response.status });
    }
    const cached = loadLocalSnapshot<Record<string, unknown>>(snapshotScope);
    if (cached) return NextResponse.json({ ...cached.payload, resilience: { mode: "offline", cached: true, snapshotAt: cached.updatedAt } });
    return response;
  } catch (error) {
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
      if (response.status < 500) return response;
    } catch {
      // Центральная база недоступна — выполняем поддерживаемую складскую операцию локально.
    }
  }

  try {
    const operationId = crypto.randomUUID();
    const payload = { ...body, _operationId: operationId };
    const result = applyHardwareOfflineOperation(snapshotScope, operator, payload);
    enqueueOperation(queueScope, String(body.action || "operation"), payload, operationId);
    return NextResponse.json({ ...result, operationId, resilience: { mode: "offline", queued: true, forced: forcedOffline() }, message: "Операция сохранена локально и будет синхронизирована автоматически" }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Операция недоступна в офлайн-режиме" }, { status: 503 });
  }
}
