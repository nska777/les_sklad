import { NextRequest, NextResponse } from "next/server";
import { createLocalBackup, localResilienceStatus } from "@/lib/local-resilience";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(localResilienceStatus());
  } catch (error) {
    return NextResponse.json({ enabled: false, error: error instanceof Error ? error.message : "Не удалось открыть локальное хранилище" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as { action?: string };
    if (body.action !== "backup") return NextResponse.json({ error: "Неизвестная операция" }, { status: 400 });
    const path = createLocalBackup();
    return NextResponse.json({ ok: true, created: Boolean(path) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось создать локальную резервную копию" }, { status: 500 });
  }
}
