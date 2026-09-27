import { existsSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { localResilienceStatus } from "@/lib/local-resilience";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const dataDir = process.env.LOCAL_WAREHOUSE_DATA_DIR || "/opt/russian-forest-sklad/data";
  const forced = process.env.WAREHOUSE_FORCE_OFFLINE === "1" || existsSync(join(dataDir, "FORCE_OFFLINE_TEST"));
  const status = localResilienceStatus();
  const databaseOffline = status.database.known && !status.database.online;

  return NextResponse.json({
    ...status,
    mode: forced || databaseOffline ? "offline" : status.pending > 0 ? "syncing" : "online",
    forced,
  });
}
