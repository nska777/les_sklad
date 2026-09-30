import { and, eq, gt } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { activityLogs, warehouseDocumentLines, warehouseDocuments } from "@/db/schema";
import { canAdmin, verifySessionToken } from "@/lib/warehouse-auth";

export const dynamic = "force-dynamic";

const clean = (value: unknown) => String(value ?? "").trim();

export async function POST(request: NextRequest) {
  const session = await verifySessionToken(request.cookies.get("warehouse_session")?.value);
  if (!session || !canAdmin(session.role)) {
    return NextResponse.json({ error: "Удалять задания может только администратор" }, { status: 403 });
  }

  try {
    const body = await request.json() as Record<string, unknown>;
    const documentId = clean(body.documentId);
    if (!documentId) return NextResponse.json({ error: "Не указан документ" }, { status: 400 });

    const db = await getDb();
    const [document] = await db.select().from(warehouseDocuments)
      .where(and(eq(warehouseDocuments.id, documentId), eq(warehouseDocuments.type, "issue")))
      .limit(1);

    if (!document) return NextResponse.json({ error: "Задание на выдачу не найдено" }, { status: 404 });
    if (document.oneCId) {
      return NextResponse.json({ error: "Задание связано с 1С. Его нужно отменять через интеграционный процесс" }, { status: 409 });
    }
    if (document.status === "completed") {
      return NextResponse.json({ error: "Завершённый документ удалять нельзя" }, { status: 409 });
    }

    const [processed] = await db.select({ id: warehouseDocumentLines.id }).from(warehouseDocumentLines)
      .where(and(eq(warehouseDocumentLines.documentId, documentId), gt(warehouseDocumentLines.processedQuantity, 0)))
      .limit(1);
    if (processed) {
      return NextResponse.json({ error: "По документу уже была выдача. Для сохранения истории удалить его нельзя" }, { status: 409 });
    }

    await db.delete(warehouseDocumentLines).where(eq(warehouseDocumentLines.documentId, documentId));
    await db.delete(warehouseDocuments).where(eq(warehouseDocuments.id, documentId));
    await db.insert(activityLogs).values({
      id: crypto.randomUUID(),
      action: "Удаление задания на выдачу",
      entityType: "Документ",
      entityId: documentId,
      entityName: document.number,
      details: `Локальный документ удалён до начала выдачи. Получатель: ${document.recipient || "—"}`,
      operator: session.name || session.username,
    });

    return NextResponse.json({ ok: true, documentId, number: document.number });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось удалить задание" }, { status: 500 });
  }
}
