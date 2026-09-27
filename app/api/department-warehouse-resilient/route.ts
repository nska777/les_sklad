import { NextRequest, NextResponse } from "next/server";
import { GET as liveGet } from "@/app/api/department-warehouse/route";
import { loadLocalSnapshot, saveLocalSnapshot } from "@/lib/local-resilience";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const warehouse = request.headers.get("x-warehouse-code") || "department";
  const scope = `department:${warehouse}:snapshot`;
  try {
    const response = await liveGet(request);
    const body = await response.clone().json().catch(() => null) as Record<string, unknown> | null;
    if (response.ok && body) {
      saveLocalSnapshot(scope, body);
      return NextResponse.json({ ...body, resilience: { mode: "online", cached: false } }, { status: response.status });
    }
    const cached = loadLocalSnapshot<Record<string, unknown>>(scope);
    if (cached) {
      return NextResponse.json({ ...cached.payload, resilience: { mode: "offline", cached: true, snapshotAt: cached.updatedAt } });
    }
    return response;
  } catch (error) {
    const cached = loadLocalSnapshot<Record<string, unknown>>(scope);
    if (cached) {
      return NextResponse.json({ ...cached.payload, resilience: { mode: "offline", cached: true, snapshotAt: cached.updatedAt } });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Склад временно недоступен", resilience: { mode: "offline", cached: false } }, { status: 503 });
  }
}
