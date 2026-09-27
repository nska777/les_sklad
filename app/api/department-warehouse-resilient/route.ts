import { NextRequest, NextResponse } from "next/server";
import { GET as liveGet, POST as livePost } from "@/app/api/department-warehouse/route";
import { applyDepartmentOfflineOperation } from "@/lib/department-offline";
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

const syncCooldown = new Map<string, number>();

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
  const { queue } = scopes(warehouse);
  const now = Date.now();
  const last = syncCooldown.get(queue) || 0;
  if (now - last < 15_000) return;
  syncCooldown.set(queue, now);

  const pending = listPendingOperations(20).filter((item) => item.scope === queue);
  for (const item of pending) {
    markOperationSyncing(item.id);
    try {
      const response = await livePost(replayRequest(request, item.payload));
      if (!response.ok) {
        const body = await response.clone().json().catch(() => ({})) as { error?: string };
        markOperationError(item.id, body.error || `HTTP ${response.status}`);
        break;
      }
      markOperationDone(item.id, queue);
    } catch (error) {
      markOperationError(item.id, error);
      break;
    }
  }
}

export async function GET(request: NextRequest) {
  const warehouse = request.headers.get("x-warehouse-code") || "department";
  const { snapshot } = scopes(warehouse);
  try {
    await syncPending(request, warehouse);
    const response = await liveGet(request);
    const body = await response.clone().json().catch(() => null) as Record<string, unknown> | null;
    if (response.ok && body) {
      saveLocalSnapshot(snapshot, body);
      return NextResponse.json({ ...body, resilience: { mode: "online", cached: false } }, { status: response.status });
    }
    const cached = loadLocalSnapshot<Record<string, unknown>>(snapshot);
    if (cached) {
      return NextResponse.json({ ...cached.payload, resilience: { mode: "offline", cached: true, snapshotAt: cached.updatedAt } });
    }
    return response;
  } catch (error) {
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

  try {
    await syncPending(request, warehouse);
    const response = await livePost(replayRequest(request, body));
    if (response.status < 500) return response;
  } catch {
    // Центральная база недоступна — операция будет выполнена локально и поставлена в очередь.
  }

  try {
    const operationId = crypto.randomUUID();
    const payload = { ...body, _operationId: operationId };
    const result = applyDepartmentOfflineOperation(snapshot, warehouse, operator, payload);
    enqueueOperation(queue, String(body.action || "operation"), payload, operationId);
    return NextResponse.json({ ...result, operationId, message: "Операция сохранена локально и будет синхронизирована автоматически" }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Операция недоступна в офлайн-режиме" }, { status: 503 });
  }
}
