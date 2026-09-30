import { NextRequest, NextResponse } from "next/server";
import { ensureOnecIntegrationSchema, ONEC_API_VERSION, ONEC_WAREHOUSES, requireOnecApiToken } from "@/lib/onec-integration-api";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = requireOnecApiToken(request);
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });

  try {
    await ensureOnecIntegrationSchema();
    return NextResponse.json({
      ok: true,
      service: "Russian Forest WMS / 1C Integration",
      version: ONEC_API_VERSION,
      warehouses: ONEC_WAREHOUSES,
      time: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: {
        code: "DATABASE_UNAVAILABLE",
        message: error instanceof Error ? error.message : "База данных недоступна",
      },
    }, { status: 503 });
  }
}
