import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { warehouseDocuments } from "@/db/schema";
import { canWrite, verifySessionToken } from "@/lib/warehouse-auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await verifySessionToken(request.cookies.get("warehouse_session")?.value);
  if (!session || !canWrite(session.role)) {
    return NextResponse.json({ error: "Нет прав на выдачу" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as { documentId?: string };
  const documentId = String(body.documentId || "").trim();
  if (!documentId) return NextResponse.json({ error: "Не указан документ" }, { status: 400 });

  try {
    const db = await getDb();
    const [document] = await db.select().from(warehouseDocuments)
      .where(and(eq(warehouseDocuments.id, documentId), eq(warehouseDocuments.type, "issue")))
      .limit(1);
    if (!document) return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
    if (document.status === "ready") {
      await db.update(warehouseDocuments).set({ status: "in_progress" }).where(eq(warehouseDocuments.id, documentId));
      return NextResponse.json({ ok: true, status: "in_progress" });
    }
    return NextResponse.json({ ok: true, status: document.status });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось обновить статус" }, { status: 500 });
  }
}
