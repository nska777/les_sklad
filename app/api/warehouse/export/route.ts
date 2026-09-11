import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { activityLogs, cells, movements, products, warehouseDocuments } from "@/db/schema";

export const dynamic = "force-dynamic";

const escapeXml = (value: unknown) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

const workbook = (sheet: string, headers: string[], rows: unknown[][], numericColumns: number[] = []) => {
  const body = rows.map((row) => row.map((cell, index) =>
    `<Cell><Data ss:Type="${numericColumns.includes(index) ? "Number" : "String"}">${escapeXml(cell)}</Data></Cell>`).join(""));
  return `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="${escapeXml(sheet)}"><Table><Row>${headers.map((header) => `<Cell><Data ss:Type="String">${escapeXml(header)}</Data></Cell>`).join("")}</Row>${body.map((row) => `<Row>${row}</Row>`).join("")}</Table></Worksheet></Workbook>`;
};

export async function GET(request: Request) {
  try {
    const db = await getDb();
    const type = new URL(request.url).searchParams.get("type");
    if (type === "activity") {
      const rows = await db.select().from(activityLogs).orderBy(desc(activityLogs.createdAt));
      const xml = workbook("Журнал изменений", ["Дата и время", "Действие", "Тип объекта", "Объект", "Подробности", "Пользователь"],
        rows.map((row) => [row.createdAt, row.action, row.entityType, row.entityName, row.details, row.operator]));
      return new Response(xml, { headers: { "Content-Type": "application/vnd.ms-excel; charset=utf-8", "Content-Disposition": `attachment; filename="warehouse-edit-log-${new Date().toISOString().slice(0, 10)}.xls"` } });
    }
    const rows = await db.select({ createdAt: movements.createdAt, type: movements.type,
      documentNumber: warehouseDocuments.number, productName: products.name, productSku: products.sku,
      cellCode: cells.code, quantity: movements.quantity, unit: products.unit, operator: movements.operator,
      recipient: movements.recipient, comment: movements.comment })
      .from(movements)
      .innerJoin(products, eq(movements.productId, products.id))
      .innerJoin(cells, eq(movements.cellId, cells.id))
      .leftJoin(warehouseDocuments, eq(movements.documentId, warehouseDocuments.id))
      .orderBy(desc(movements.createdAt));

    const headers = ["Дата и время", "Операция", "Документ", "Материал", "Артикул", "Ячейка", "Количество", "Единица", "Кладовщик", "Получатель / поставщик", "Комментарий"];
    const xml = workbook("Движения", headers, rows.map((row) => [row.createdAt, row.type, row.documentNumber, row.productName, row.productSku,
      row.cellCode, Math.abs(row.quantity), row.unit, row.operator, row.recipient, row.comment]), [6]);
    return new Response(xml, { headers: { "Content-Type": "application/vnd.ms-excel; charset=utf-8", "Content-Disposition": `attachment; filename="warehouse-movements-${new Date().toISOString().slice(0, 10)}.xls"` } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось сформировать Excel" }, { status: 500 });
  }
}
