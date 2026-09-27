import { and, desc, eq, like } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { activityLogs, departmentCells, departmentMovements, departmentProducts } from "@/db/schema";
import { canAccessWarehouse, isWarehouseCode, verifySessionToken } from "@/lib/warehouse-auth";

export const dynamic = "force-dynamic";

const clean = (value: unknown) => String(value ?? "").trim();
const safeObject = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

const actionMeta = (action: string, endpoint: string) => {
  const inventory = endpoint.includes("department-warehouse-inventory");
  const map: Record<string, { label: string; category: string; entityType: string }> = {
    createProduct: { label: "Создание материала", category: "Материалы", entityType: "material" },
    updateProduct: { label: "Редактирование материала", category: "Материалы", entityType: "material" },
    deleteProduct: { label: "Удаление материала", category: "Удаления", entityType: "material" },
    bulkDeleteProducts: { label: "Удаление материалов", category: "Удаления", entityType: "material" },
    hardDeleteProducts: { label: "Удаление материалов", category: "Удаления", entityType: "material" },
    deleteProductAdmin: { label: "Удаление материала", category: "Удаления", entityType: "material" },
    createRack: { label: "Создание стеллажа", category: "Стеллажи", entityType: "rack" },
    createFloorZone: { label: "Создание напольной зоны", category: "Стеллажи", entityType: "rack" },
    updateRack: { label: "Редактирование стеллажа", category: "Стеллажи", entityType: "rack" },
    deleteRack: { label: "Удаление стеллажа", category: "Удаления", entityType: "rack" },
    hardDeleteRack: { label: "Удаление стеллажа", category: "Удаления", entityType: "rack" },
    receive: { label: "Приход", category: "Приход", entityType: "material" },
    placeProduct: { label: "Размещение", category: "Приход", entityType: "material" },
    transfer: { label: "Перемещение", category: "Перемещение", entityType: "material" },
    moveProduct: { label: "Перемещение", category: "Перемещение", entityType: "material" },
    issue: { label: "Выдача", category: "Выдача", entityType: "material" },
    issueMix: { label: "Выдача / сборка", category: "Выдача", entityType: "material" },
    inventorySnapshot: { label: "Инвентаризация", category: "Инвентаризация", entityType: "inventory" },
    import1c: { label: "Импорт из 1С / Excel", category: "Импорт", entityType: "import" },
    bulkImportProducts: { label: "Импорт материалов", category: "Импорт", entityType: "import" },
    undoMovement: { label: "Отмена движения", category: "Отмены", entityType: "movement" },
    clearMovements: { label: "Очистка рабочей истории", category: "Удаления", entityType: "history" },
    adjust: { label: "Корректировка", category: "Корректировки", entityType: "material" },
  };
  if (inventory && action === "delete") return { label: "Удаление инвентаризации", category: "Удаления", entityType: "inventory" };
  if (inventory && action === "update") return { label: "Редактирование инвентаризации", category: "Инвентаризация", entityType: "inventory" };
  return map[action] || { label: action || "Действие", category: "Прочее", entityType: "warehouse" };
};

async function context(request: NextRequest) {
  const session = await verifySessionToken(request.cookies.get("warehouse_session")?.value);
  if (!session) return null;
  const code = request.headers.get("x-warehouse-code") || session.warehouse;
  if (!isWarehouseCode(code) || code === "hardware" || !canAccessWarehouse(session, code)) return null;
  return { code, session };
}

export async function GET(request: NextRequest) {
  const ctx = await context(request);
  if (!ctx) return NextResponse.json({ error: "Нет доступа к складу" }, { status: 403 });
  try {
    const db = await getDb();
    const [logs, movements, products, cells] = await Promise.all([
      db.select().from(activityLogs).where(like(activityLogs.entityType, `department:${ctx.code}:%`)).orderBy(desc(activityLogs.createdAt)).limit(1000),
      db.select().from(departmentMovements).where(eq(departmentMovements.warehouseCode, ctx.code)).orderBy(desc(departmentMovements.createdAt)).limit(700),
      db.select({ id: departmentProducts.id, name: departmentProducts.name, sku: departmentProducts.sku, unit: departmentProducts.unit }).from(departmentProducts).where(eq(departmentProducts.warehouseCode, ctx.code)),
      db.select({ id: departmentCells.id, code: departmentCells.code }).from(departmentCells).where(eq(departmentCells.warehouseCode, ctx.code)),
    ]);
    const productById = new Map(products.map((p) => [p.id, p]));
    const cellById = new Map(cells.map((c) => [c.id, c.code]));
    const auditRows = logs.map((row) => {
      let details: Record<string, unknown> = {};
      try { details = JSON.parse(row.details || "{}") as Record<string, unknown>; } catch { details = { text: row.details }; }
      return {
        id: row.id,
        source: "audit",
        action: row.action,
        category: clean(details.category) || "Прочее",
        entityType: row.entityType.split(":").slice(2).join(":") || "warehouse",
        entityId: row.entityId,
        entityName: row.entityName,
        details: clean(details.summary) || clean(details.text),
        quantity: clean(details.quantity),
        route: clean(details.route),
        document: clean(details.document),
        operator: row.operator,
        createdAt: row.createdAt,
      };
    });

    const isDuplicate = (movement: typeof movements[number]) => auditRows.some((row) => {
      if (row.entityId !== movement.productId) return false;
      const delta = Math.abs(new Date(row.createdAt).getTime() - new Date(movement.createdAt).getTime());
      return delta < 10_000 && row.operator === movement.operator;
    });

    const legacyRows = movements.filter((m) => !isDuplicate(m)).map((m) => {
      const product = productById.get(m.productId);
      const from = m.fromCellId ? cellById.get(m.fromCellId) || "" : "";
      const to = m.toCellId ? cellById.get(m.toCellId) || "" : "";
      return {
        id: `movement:${m.id}`,
        source: "movement",
        action: m.type,
        category: /выда|спис/i.test(m.type) ? "Выдача" : /перем/i.test(m.type) ? "Перемещение" : "Приход",
        entityType: "material",
        entityId: m.productId,
        entityName: product?.name || "Материал",
        details: m.comment || m.sourceName || "",
        quantity: `${Number(m.quantity).toLocaleString("ru-RU", { maximumFractionDigits: 9 })} ${product?.unit || ""}`.trim(),
        route: from || to ? `${from || m.sourceLocation || "—"} → ${to || "—"}` : m.sourceLocation || "",
        document: m.documentNumber || "",
        operator: m.operator,
        createdAt: m.createdAt,
      };
    });

    const rows = [...auditRows, ...legacyRows]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 1200);
    return NextResponse.json({ rows });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось загрузить журнал" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const ctx = await context(request);
  if (!ctx) return NextResponse.json({ error: "Нет доступа к складу" }, { status: 403 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = clean(body.action);
    const endpoint = clean(body.endpoint);
    const payload = safeObject(body.payload);
    const meta = actionMeta(action, endpoint);
    const db = await getDb();

    const productId = clean(payload.productId);
    const fromCellId = clean(payload.fromCellId);
    const toCellId = clean(payload.toCellId || payload.cellId);
    const [productRows, fromRows, toRows] = await Promise.all([
      productId ? db.select({ name: departmentProducts.name, sku: departmentProducts.sku, unit: departmentProducts.unit }).from(departmentProducts).where(and(eq(departmentProducts.id, productId), eq(departmentProducts.warehouseCode, ctx.code))).limit(1) : Promise.resolve([]),
      fromCellId ? db.select({ code: departmentCells.code }).from(departmentCells).where(and(eq(departmentCells.id, fromCellId), eq(departmentCells.warehouseCode, ctx.code))).limit(1) : Promise.resolve([]),
      toCellId ? db.select({ code: departmentCells.code }).from(departmentCells).where(and(eq(departmentCells.id, toCellId), eq(departmentCells.warehouseCode, ctx.code))).limit(1) : Promise.resolve([]),
    ]);
    const product = productRows[0];
    const entityId = productId || clean(payload.id) || (Array.isArray(payload.ids) ? payload.ids.map(clean).filter(Boolean).join(",") : "") || ctx.code;
    const entityName = product?.name || clean(payload.name) || clean(payload.materialName) || clean(payload.code) || meta.label;
    const unit = clean(payload.unit) || product?.unit || "";
    const quantityRaw = payload.quantity;
    const quantity = quantityRaw !== undefined && quantityRaw !== null && clean(quantityRaw) !== "" ? `${clean(quantityRaw)}${unit ? ` ${unit}` : ""}` : "";
    const from = fromRows[0]?.code || clean(payload.sourceLocation);
    const to = toRows[0]?.code || "";
    const route = from || to ? `${from || "—"} → ${to || "—"}` : "";
    const document = clean(payload.documentNumber || payload.document || payload.number);
    const summaryParts = [
      clean(payload.comment),
      clean(payload.recipient) ? `Кому: ${clean(payload.recipient)}` : "",
      clean(payload.sourceName) ? `Источник: ${clean(payload.sourceName)}` : "",
      Array.isArray(payload.ids) ? `Объектов: ${payload.ids.length}` : "",
      Array.isArray(payload.items) ? `Позиций: ${payload.items.length}` : "",
    ].filter(Boolean);

    await db.insert(activityLogs).values({
      id: crypto.randomUUID(),
      action: meta.label,
      entityType: `department:${ctx.code}:${meta.entityType}`,
      entityId,
      entityName,
      details: JSON.stringify({ category: meta.category, summary: summaryParts.join(" · "), quantity, route, document, endpoint, sourceAction: action }),
      operator: ctx.session.name || ctx.session.username,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось записать аудит" }, { status: 500 });
  }
}
