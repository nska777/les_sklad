import { and, eq, ne, sql } from "drizzle-orm";
import { getDb, withHardwareTransaction } from "@/db";
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
      if (existingDocument?.status === "completed" || existingDocument?.status === "cancelled") {
        return Response.json({ error: "Документ уже полностью выдан и закрыт" }, { status: 409 });
      }

      const [availableRows, reservationRows] = await Promise.all([
        db.select({ quantity: stocks.quantity }).from(stocks).where(eq(stocks.productId, productId)),
        db.select({ planned: warehouseDocumentLines.plannedQuantity, processed: warehouseDocumentLines.processedQuantity, documentId: warehouseDocumentLines.documentId })
          .from(warehouseDocumentLines)
          .innerJoin(warehouseDocuments, eq(warehouseDocumentLines.documentId, warehouseDocuments.id))
          .where(and(eq(warehouseDocumentLines.productId, productId), eq(warehouseDocuments.type, "issue"), ne(warehouseDocuments.status, "completed"), ne(warehouseDocuments.status, "cancelled"))),
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
      if (!documentId || !lineId || !cellId || quantity <= 0) return Response.json({ error: "Укажите документ, позицию, ячейку и количество", status: 400 }, { status: 400 });
      const result = await withHardwareTransaction(async (client) => {
        const docResult = await client.query<{ id: string; number: string; status: string; recipient: string; comment: string }>(
          "SELECT id, number, status, recipient, comment FROM warehouse_documents WHERE id = $1 AND type = 'issue' FOR UPDATE", [documentId]);
        if (!docResult.rowCount) return { error: "Документ выдачи не найден", status: 404 };
        const document = docResult.rows[0];
        if (document.status === "completed" || document.status === "cancelled") return { error: "Документ уже закрыт", status: 409 };
        const lineResult = await client.query<{ id: string; product_id: string; planned_quantity: number; processed_quantity: number }>(
          "SELECT id, product_id, planned_quantity, processed_quantity FROM warehouse_document_lines WHERE id = $1 AND document_id = $2 FOR UPDATE", [lineId, documentId]);
        if (!lineResult.rowCount) return { error: "Позиция выдачи не найдена", status: 404 };
        const line = lineResult.rows[0];
        const remaining = Number(line.planned_quantity) - Number(line.processed_quantity);
        if (quantity > remaining + 0.000001) return { error: `Осталось выдать ${remaining}`, status: 409 };
        const cellResult = await client.query<{ code: string; blocked: boolean }>("SELECT code, blocked FROM cells WHERE id = $1", [cellId]);
        if (!cellResult.rowCount || cellResult.rows[0].blocked) return { error: "Ячейка недоступна", status: 409 };
        const stockResult = await client.query<{ quantity: number }>(
          "UPDATE stocks SET quantity = quantity - $1, updated_at = CURRENT_TIMESTAMP WHERE product_id = $2 AND cell_id = $3 AND quantity >= $1 RETURNING quantity",
          [quantity, line.product_id, cellId]);
        if (!stockResult.rowCount) return { error: "Недостаточно материала в ячейке", status: 409 };
        const nextProcessed = Number(line.processed_quantity) + quantity;
        await client.query("UPDATE warehouse_document_lines SET processed_quantity = $1 WHERE id = $2", [nextProcessed, line.id]);
        const outstanding = await client.query(
          "SELECT 1 FROM warehouse_document_lines WHERE document_id = $1 AND processed_quantity < planned_quantity - 0.000001 LIMIT 1", [documentId]);
        const completed = outstanding.rowCount === 0;
        await client.query("UPDATE warehouse_documents SET status = $1, completed_at = $2 WHERE id = $3",
          [completed ? "completed" : "partial", completed ? new Date().toISOString() : null, documentId]);
        await client.query(
          "INSERT INTO movements (id, type, product_id, cell_id, quantity, operator, source, document_id, recipient, comment) VALUES ($1, 'Выдача', $2, $3, $4, $5, 'issue', $6, $7, $8)",
          [crypto.randomUUID(), line.product_id, cellId, -quantity, operator, documentId, document.recipient, clean(body.comment) || document.comment]);
        await client.query(
          "INSERT INTO activity_logs (id, action, entity_type, entity_id, entity_name, details, operator) VALUES ($1, 'Выдача', 'Документ', $2, $3, $4, $5)",
          [crypto.randomUUID(), documentId, document.number, `${quantity} ед. · ${cellResult.rows[0].code} → ${document.recipient}`, operator]);
        return { ok: true, completed, lineCompleted: nextProcessed >= Number(line.planned_quantity) - 0.000001 };
      });
      if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
      return Response.json(result);
    }

    return Response.json({ error: "Неизвестная операция" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Операция выдачи не выполнена" }, { status: 500 });
  }
}
