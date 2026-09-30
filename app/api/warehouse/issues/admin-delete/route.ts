import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { activityLogs, movements, warehouseDocumentLines, warehouseDocuments } from "@/db/schema";
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

    const lines = await db.select().from(warehouseDocumentLines)
      .where(eq(warehouseDocumentLines.documentId, documentId));
    const processedQuantity = lines.reduce((sum, row) => sum + Number(row.processedQuantity || 0), 0);

    // Историю уже выполненных складских движений сохраняем. Сам документ можно удалить,
    // но фактически выданный ранее товар назад на остаток автоматически не возвращаем.
    await db.update(movements).set({ documentId: null }).where(eq(movements.documentId, documentId));
    await db.delete(warehouseDocumentLines).where(eq(warehouseDocumentLines.documentId, documentId));
    await db.delete(warehouseDocuments).where(eq(warehouseDocuments.id, documentId));

    await db.insert(activityLogs).values({
      id: crypto.randomUUID(),
      action: "Удаление задания на выдачу",
      entityType: "Документ",
      entityId: documentId,
      entityName: document.number,
      details: `Администратор удалил заявку со склада. Статус: ${document.status}. Выдано до удаления: ${processedQuantity}. Получатель: ${document.recipient || "—"}.${document.oneCId ? ` Связь с 1С: ${document.oneCId}.` : ""} Движения склада сохранены, остатки автоматически не восстанавливались.`,
      operator: session.name || session.username,
    });

    return NextResponse.json({
      ok: true,
      documentId,
      number: document.number,
      processedQuantity,
      oneCId: document.oneCId || null,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось удалить задание" }, { status: 500 });
  }
}
