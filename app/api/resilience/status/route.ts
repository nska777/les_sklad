import { existsSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { databaseCircuitState } from "@/lib/db-circuit-breaker";
import { localResilienceStatus } from "@/lib/local-resilience";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const dataDir = process.env.LOCAL_WAREHOUSE_DATA_DIR || "/opt/russian-forest-sklad/data";
  const forced = process.env.WAREHOUSE_FORCE_OFFLINE === "1" || existsSync(join(dataDir, "FORCE_OFFLINE_TEST"));
  const status = localResilienceStatus();
  const circuit = databaseCircuitState();
  const databaseOffline = status.database.known && !status.database.online;
  const protectedOffline = circuit.mode !== "closed";

  return NextResponse.json({
    ...status,
    circuit,
    mode: forced || databaseOffline || protectedOffline ? "offline" : status.pending > 0 ? "syncing" : "online",
    forced,
  });
}
