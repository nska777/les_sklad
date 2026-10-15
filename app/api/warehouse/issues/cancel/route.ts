import { NextRequest, NextResponse } from "next/server";
import { withHardwareTransaction } from "@/db";
import { verifySessionToken } from "@/lib/warehouse-auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await verifySessionToken(request.cookies.get("warehouse_session")?.value);
  if (!session || session.username.trim().toLowerCase() !== "roman" || !session.warehouses.includes("hardware")) {
    return NextResponse.json({ error: "Отмена выдачи доступна только roman" }, { status: 403 });
  }
  let documentId = "";
  try {
    const body = await request.json() as { documentId?: unknown };
    documentId = String(body.documentId ?? "").trim();
    if (!documentId) return NextResponse.json({ error: "Не указан документ" }, { status: 400 });
    const result = await withHardwareTransaction(async (client) => {
      const doc = await client.query<{ id: string; number: string; status: string; one_c_id: string | null }>(
        "SELECT id, number, status, one_c_id FROM warehouse_documents WHERE id = $1 AND type = 'issue' FOR UPDATE", [documentId]);
      if (!doc.rowCount) throw new Error("Документ выдачи не найден");
      const document = doc.rows[0];
      if (document.status === "cancelled") throw new Error("Выдача уже отменена");
      const issues = await client.query<{ id: string; product_id: string; cell_id: string; quantity: number }>(
        "SELECT id, product_id, cell_id, quantity FROM movements WHERE document_id = $1 AND type = 'Выдача' AND quantity < 0 ORDER BY id FOR UPDATE", [documentId]);
      if (!issues.rowCount) throw new Error("По документу нет фактически выданных материалов");
      const lines = await client.query<{ product_id: string; processed_quantity: number }>(
        "SELECT product_id, processed_quantity FROM warehouse_document_lines WHERE document_id = $1 FOR UPDATE", [documentId]);
      const expected = new Map<string, number>();
      for (const line of lines.rows) expected.set(line.product_id, (expected.get(line.product_id) || 0) + Number(line.processed_quantity));
      const actual = new Map<string, number>();
      for (const issue of issues.rows) actual.set(issue.product_id, (actual.get(issue.product_id) || 0) - Number(issue.quantity));
      if (expected.size !== actual.size || [...expected].some(([id, qty]) => Math.abs(qty - (actual.get(id) || 0)) > 0.000001)) {
        throw new Error("Данные документа не совпадают с движениями. Автоматический возврат запрещён");
      }
      for (const issue of issues.rows) {
        const qty = -Number(issue.quantity);
        if (!Number.isFinite(qty) || qty <= 0) throw new Error("Некорректное количество выдачи");
        const updated = await client.query(
          "UPDATE stocks SET quantity = quantity + $1, updated_at = CURRENT_TIMESTAMP WHERE product_id = $2 AND cell_id = $3",
          [qty, issue.product_id, issue.cell_id]);
        if (updated.rowCount !== 1) throw new Error("Исходная ячейка отсутствует, возврат остановлен");
        await client.query(
          "INSERT INTO movements (id, type, product_id, cell_id, quantity, operator, source, document_id, recipient, comment) VALUES ($1, 'Возврат выдачи', $2, $3, $4, $5, 'issue-cancel', $6, '', $7)",
          [crypto.randomUUID(), issue.product_id, issue.cell_id, qty, session.username, documentId, `Отмена выдачи №${document.number}; исходное движение ${issue.id}`]);
      }
      await client.query("UPDATE warehouse_documents SET status = 'cancelled', completed_at = CURRENT_TIMESTAMP WHERE id = $1", [documentId]);
      await client.query(
        "INSERT INTO activity_logs (id, action, entity_type, entity_id, entity_name, details, operator) VALUES ($1, 'Отмена выдачи', 'Документ', $2, $3, $4, $5)",
        [crypto.randomUUID(), documentId, document.number, `Возвращено движений: ${issues.rows.length}. Остатки восстановлены по исходным ячейкам. 1С: ${document.one_c_id || "нет"}`, session.username]);
      return { ok: true, documentId, number: document.number, returnedLines: issues.rows.length, oneCId: document.one_c_id };
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ошибка отмены выдачи";
    return NextResponse.json({ error: message }, { status: /уже отменена|не совпадают|отсутствует|нет фактически/.test(message) ? 409 : 500 });
  }
}
