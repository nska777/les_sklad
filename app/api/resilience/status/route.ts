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

  const databaseKnown = status.database.known;
  const databaseOnline = databaseKnown && status.database.online;
  const databaseOffline = databaseKnown && !status.database.online;

  // A stale/open circuit breaker must not paint the whole UI as offline
  // after the central database has already recovered successfully.
  const protectedOffline = !databaseOnline && circuit.mode !== "closed";

  return NextResponse.json({
    ...status,
    circuit,
    mode: forced || databaseOffline || protectedOffline ? "offline" : status.pending > 0 ? "syncing" : "online",
    forced,
  });
}
