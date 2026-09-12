import { and, eq, ne, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { activityLogs, cells, movements, products, stocks, warehouseDocumentLines, warehouseDocuments } from "@/db/schema";

export const dynamic = "force-dynamic";

const clean = (value: unknown) => String(value ?? "").trim();
const num = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = clean(body.action);
    const operator = clean(body.operator) || "Кладовщик";
    const db = await getDb();

    const logActivity = (entry: { action: string; entityType: string; entityId: string; entityName: string; details?: string }) =>
      db.insert(activityLogs).values({ id: crypto.randomUUID(), operator, details: "", ...entry });

    if (action === "createOrAddLine") {
      const documentNumber = clean(body.documentNumber).toUpperCase();
      const recipient = clean(body.recipient);
      const oneCId = clean(body.oneCId) || null;
      const comment = clean(body.comment);
      const productId = clean(body.productId);
      const plannedQuantity = num(body.quantity);

      if (!documentNumber || !recipient || !productId || plannedQuantity <= 0) {
        return Response.json({ error: "Укажите номер документа, получателя, материал и количество" }, { status: 400 });
      }

      const [product] = await db.select().from(products).where(eq(products.id, productId)).limit(1);
      if (!product) return Response.json({ error: "Материал не найден" }, { status: 404 });

      const [existingDocument] = await db.select().from(warehouseDocuments).where(eq(warehouseDocuments.number, documentNumber)).limit(1);
      if (existingDocument && existingDocument.type !== "issue") {
        return Response.json({ error: "Этот номер уже используется другим типом документа" }, { status: 409 });
      }
      if (existingDocument?.status === "completed") {
        return Response.json({ error: "Документ уже полностью выдан и закрыт" }, { status: 409 });
      }

      const [availableRows, reservationRows] = await Promise.all([
        db.select({ quantity: stocks.quantity }).from(stocks).where(eq(stocks.productId, productId)),
        db.select({ planned: warehouseDocumentLines.plannedQuantity, processed: warehouseDocumentLines.processedQuantity, documentId: warehouseDocumentLines.documentId })
          .from(warehouseDocumentLines)
          .innerJoin(warehouseDocuments, eq(warehouseDocumentLines.documentId, warehouseDocuments.id))
          .where(and(eq(warehouseDocumentLines.productId, productId), eq(warehouseDocuments.type, "issue"), ne(warehouseDocuments.status, "completed"))),
      ]);
      const available = availableRows.reduce((sum, row) => sum + row.quantity, 0);
      const reserved = reservationRows
        .filter((row) => row.documentId !== existingDocument?.id)
        .reduce((sum, row) => sum + row.planned - row.processed, 0);
      const existingSameDocument = existingDocument
        ? reservationRows.filter((row) => row.documentId === existingDocument.id).reduce((sum, row) => sum + row.planned - row.processed, 0)
        : 0;
      const free = available - reserved - existingSameDocument;
      if (free < plannedQuantity) {
        return Response.json({ error: `Недостаточно свободного материала. Доступно ${Math.max(0, free)} ${product.unit}` }, { status: 409 });
      }

      const documentId = existingDocument?.id || crypto.randomUUID();
      if (!existingDocument) {
        await db.insert(warehouseDocuments).values({
          id: documentId,
          number: documentNumber,
          type: "issue",
          status: "ready",
          recipient,
          oneCId,
          syncStatus: oneCId ? "linked" : "pending",
          comment,
          createdBy: operator,
        });
      } else {
        await db.update(warehouseDocuments).set({
          recipient,
          oneCId: oneCId || existingDocument.oneCId,
          syncStatus: oneCId || existingDocument.oneCId ? "linked" : existingDocument.syncStatus,
          comment: comment || existingDocument.comment,
        }).where(eq(warehouseDocuments.id, documentId));
      }

      const [sameLine] = await db.select().from(warehouseDocumentLines)
        .where(and(eq(warehouseDocumentLines.documentId, documentId), eq(warehouseDocumentLines.productId, productId))).limit(1);
      if (sameLine) {
        await db.update(warehouseDocumentLines)
          .set({ plannedQuantity: sameLine.plannedQuantity + plannedQuantity })
          .where(eq(warehouseDocumentLines.id, sameLine.id));
      } else {
        await db.insert(warehouseDocumentLines).values({
          id: crypto.randomUUID(), documentId, productId, plannedQuantity, processedQuantity: 0,
        });
      }

      await logActivity({
        action: existingDocument ? "Добавление позиции в выдачу" : "Задание на выдачу",
        entityType: "Документ",
        entityId: documentId,
        entityName: documentNumber,
        details: `${product.name}: ${plannedQuantity} ${product.unit} → ${recipient}`,
      });

      return Response.json({ ok: true, documentId, qrValue: `ISSUE:${documentNumber}` }, { status: existingDocument ? 200 : 201 });
    }

    if (action === "issueLine") {
      const documentId = clean(body.documentId);
      const lineId = clean(body.lineId);
      const cellId = clean(body.cellId);
      const quantity = num(body.quantity);
      if (!documentId || !lineId || !cellId || quantity <= 0) {
        return Response.json({ error: "Выберите документ, позицию, ячейку и количество" }, { status: 400 });
      }

      const [[document], [line]] = await Promise.all([
        db.select().from(warehouseDocuments).where(eq(warehouseDocuments.id, documentId)).limit(1),
        db.select().from(warehouseDocumentLines).where(and(eq(warehouseDocumentLines.id, lineId), eq(warehouseDocumentLines.documentId, documentId))).limit(1),
      ]);
      if (!document || document.type !== "issue" || !line) return Response.json({ error: "Позиция выдачи не найдена" }, { status: 404 });
      if (document.status === "completed") return Response.json({ error: "Документ уже закрыт" }, { status: 409 });

      const remaining = line.plannedQuantity - line.processedQuantity;
      if (quantity > remaining) return Response.json({ error: `По этой позиции осталось выдать ${remaining}` }, { status: 409 });

      const [[cell], [stock], [product]] = await Promise.all([
        db.select().from(cells).where(eq(cells.id, cellId)).limit(1),
        db.select().from(stocks).where(and(eq(stocks.productId, line.productId), eq(stocks.cellId, cellId))).limit(1),
        db.select().from(products).where(eq(products.id, line.productId)).limit(1),
      ]);
      if (!cell || cell.blocked) return Response.json({ error: "Ячейка недоступна" }, { status: 409 });
      if (!stock || stock.quantity < quantity) {
        return Response.json({ error: `В ячейке ${cell.code} доступно только ${stock?.quantity || 0} ${product?.unit || "шт."}` }, { status: 409 });
      }

      const nextProcessed = line.processedQuantity + quantity;
      await db.update(stocks).set({ quantity: stock.quantity - quantity, updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(and(eq(stocks.productId, line.productId), eq(stocks.cellId, cellId)));
      await db.update(warehouseDocumentLines).set({ processedQuantity: nextProcessed }).where(eq(warehouseDocumentLines.id, line.id));

      const allLines = await db.select().from(warehouseDocumentLines).where(eq(warehouseDocumentLines.documentId, documentId));
      const completed = allLines.every((row) => {
        const processed = row.id === line.id ? nextProcessed : row.processedQuantity;
        return processed >= row.plannedQuantity - 0.000001;
      });
      await db.update(warehouseDocuments).set({
        status: completed ? "completed" : "partial",
        completedAt: completed ? new Date().toISOString() : null,
      }).where(eq(warehouseDocuments.id, documentId));

      await db.insert(movements).values({
        id: crypto.randomUUID(), type: "Выдача", productId: line.productId, cellId,
        quantity: -quantity, operator, source: "issue", documentId,
        recipient: document.recipient, comment: clean(body.comment) || document.comment,
      });
      await logActivity({
        action: "Выдача",
        entityType: "Документ",
        entityId: documentId,
        entityName: document.number,
        details: `${product?.name || "Материал"}: ${quantity} ${product?.unit || "ед."} · ${cell.code} → ${document.recipient}`,
      });

      return Response.json({ ok: true, completed, lineCompleted: nextProcessed >= line.plannedQuantity - 0.000001 });
    }

    return Response.json({ error: "Неизвестная операция" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Операция выдачи не выполнена" }, { status: 500 });
  }
}
