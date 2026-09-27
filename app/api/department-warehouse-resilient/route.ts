import { existsSync } from "node:fs";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { GET as liveGet, POST as livePost } from "@/app/api/department-warehouse/route";
import { applyDepartmentOfflineOperation } from "@/lib/department-offline";
import {
  canUseCentralDatabase,
  databaseCircuitState,
  recordCentralDatabaseFailure,
  recordCentralDatabaseSuccess,
} from "@/lib/db-circuit-breaker";
import {
  enqueueOperation,
  loadLocalSnapshot,
  saveLocalSnapshot,
  setCentralDatabaseState,
} from "@/lib/local-resilience";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

function offlineGetResponse(snapshot: string, forced = false) {
  const cached = loadLocalSnapshot<Record<string, unknown>>(snapshot);
  const circuit = databaseCircuitState();
  if (cached) {
    return NextResponse.json({
      ...cached.payload,
      resilience: {
        mode: "offline",
        cached: true,
        forced,
        circuit: circuit.mode,
        snapshotAt: cached.updatedAt,
      },
    });
  }
  return NextResponse.json({
    error: "Центральная база временно недоступна, а локальный снимок склада ещё не создан",
    resilience: { mode: "offline", cached: false, forced, circuit: circuit.mode },
  }, { status: 503 });
}

export async function GET(request: NextRequest) {
  const warehouse = request.headers.get("x-warehouse-code") || "department";
  const { snapshot } = scopes(warehouse);

  if (forcedOffline()) return offlineGetResponse(snapshot, true);
  if (!canUseCentralDatabase()) return offlineGetResponse(snapshot, false);

  try {
    const response = await liveGet(request);
    const body = await response.clone().json().catch(() => null) as Record<string, unknown> | null;
    if (response.ok && body) {
      saveLocalSnapshot(snapshot, body);
      recordCentralDatabaseSuccess();
      setCentralDatabaseState(true);
      return NextResponse.json({ ...body, resilience: { mode: "online", cached: false, circuit: "closed" } }, { status: response.status });
    }
    if (response.status >= 500) {
      const message = `HTTP ${response.status}`;
      recordCentralDatabaseFailure(message);
      setCentralDatabaseState(false, message);
      return offlineGetResponse(snapshot, false);
    }
    return response;
  } catch (error) {
    recordCentralDatabaseFailure(error);
    setCentralDatabaseState(false, error instanceof Error ? error.message : String(error));
    return offlineGetResponse(snapshot, false);
  }
}

export async function POST(request: NextRequest) {
  const warehouse = request.headers.get("x-warehouse-code") || "department";
  const operator = decodeURIComponent(request.headers.get("x-warehouse-user") || "Кладовщик");
  const { snapshot, queue } = scopes(warehouse);
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;

  if (!forcedOffline() && canUseCentralDatabase()) {
    try {
      const response = await livePost(replayRequest(request, body));
      if (response.status < 500) {
        recordCentralDatabaseSuccess();
        setCentralDatabaseState(true);
        return response;
      }
      const message = `HTTP ${response.status}`;
      recordCentralDatabaseFailure(message);
      setCentralDatabaseState(false, message);
    } catch (error) {
      recordCentralDatabaseFailure(error);
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
      resilience: {
        mode: "offline",
        queued: true,
        forced: forcedOffline(),
        circuit: databaseCircuitState().mode,
      },
      message: "Операция сохранена локально. Система синхронизирует её автоматически после восстановления базы.",
    }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Операция недоступна в офлайн-режиме" }, { status: 503 });
  }
}
