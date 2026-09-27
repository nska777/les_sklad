import { and, desc, eq, like } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { activityLogs, departmentCells, departmentMovements, departmentProducts } from "@/db/schema";
import { canAccessWarehouse, isWarehouseCode, verifySessionToken } from "@/lib/warehouse-auth";

export const dynamic = "force-dynamic";

const clean = (value: unknown) => String(value ?? "").trim();
const safeObject = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

const canonicalAction = (action: string) => {
  const value = clean(action);
  const map: Record<string, { label: string; category: string }> = {
    productCreated: { label: "Создание материала", category: "Материалы" },
    productUpdated: { label: "Редактирование материала", category: "Материалы" },
    productDeleted: { label: "Удаление материала", category: "Удаления" },
    rackCreated: { label: "Создание стеллажа", category: "Стеллажи" },
    rackUpdated: { label: "Редактирование стеллажа", category: "Стеллажи" },
    rackDeleted: { label: "Удаление стеллажа", category: "Удаления" },
    inventoryCreated: { label: "Инвентаризация", category: "Инвентаризация" },
    inventoryUpdated: { label: "Редактирование инвентаризации", category: "Инвентаризация" },
    inventoryDeleted: { label: "Удаление инвентаризации", category: "Удаления" },
  };
  return map[value] || null;
};

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
      db.select({ id: departmentProducts.id, name: departmentProducts.name, sku: departmentProducts.sku, unit: departmentProducts.unit, category: departmentProducts.category, brand: departmentProducts.brand, color: departmentProducts.color, ral: departmentProducts.ral, packType: departmentProducts.packType, packSize: departmentProducts.packSize, minStock: departmentProducts.minStock, comment: departmentProducts.comment }).from(departmentProducts).where(eq(departmentProducts.warehouseCode, ctx.code)),
      db.select({ id: departmentCells.id, code: departmentCells.code }).from(departmentCells).where(eq(departmentCells.warehouseCode, ctx.code)),
    ]);
    const productById = new Map(products.map((p) => [p.id, p]));
    const cellById = new Map(cells.map((c) => [c.id, c.code]));

    const rawAuditRows = logs.map((row) => {
      let details: Record<string, unknown> = {};
      try { details = JSON.parse(row.details || "{}") as Record<string, unknown>; } catch { details = { text: row.details }; }
      const canonical = canonicalAction(row.action);
      const product = productById.get(row.entityId);
      const detailParts = [clean(details.summary) || clean(details.text)];
      if (product && canonical?.label === "Создание материала") {
        detailParts.push(`Артикул: ${product.sku}`);
        detailParts.push(`Ед.: ${product.unit}`);
        if (product.category) detailParts.push(`Категория: ${product.category}`);
        if (product.brand) detailParts.push(`Бренд: ${product.brand}`);
        if (product.color) detailParts.push(`Цвет: ${product.color}`);
        if (product.ral) detailParts.push(`RAL: ${product.ral}`);
        if (product.packType) detailParts.push(`Тара: ${product.packType}${Number(product.packSize) > 0 ? ` ${Number(product.packSize).toLocaleString("ru-RU", { maximumFractionDigits: 9 })} ${product.unit}` : ""}`);
        if (Number(product.minStock) > 0) detailParts.push(`Мин. остаток: ${Number(product.minStock).toLocaleString("ru-RU", { maximumFractionDigits: 9 })} ${product.unit}`);
      }
      return {
        id: row.id,
        source: "audit",
        action: canonical?.label || row.action,
        category: canonical?.category || clean(details.category) || "Прочее",
        entityType: row.entityType.split(":").slice(2).join(":") || "warehouse",
        entityId: row.entityId,
        entityName: row.entityName,
        details: detailParts.filter(Boolean).join(" · "),
        quantity: clean(details.quantity),
        route: clean(details.route),
        document: clean(details.document),
        operator: row.operator,
        createdAt: row.createdAt,
      };
    });

    const auditRows = rawAuditRows.filter((row, index, rows) => {
      const duplicateIndex = rows.findIndex((other) => {
        if (other.action !== row.action || other.operator !== row.operator || other.entityName !== row.entityName) return false;
        const delta = Math.abs(new Date(other.createdAt).getTime() - new Date(row.createdAt).getTime());
        return delta < 12_000;
      });
      return duplicateIndex === index;
    });

    const isDuplicate = (movement: typeof movements[number]) => auditRows.some((row) => {
      const product = productById.get(movement.productId);
      if (row.entityId !== movement.productId && row.entityName !== product?.name) return false;
      const delta = Math.abs(new Date(row.createdAt).getTime() - new Date(movement.createdAt).getTime());
      return delta < 10_000 && row.operator === movement.operator;
    });

    const legacyRows = movements.filter((m) => !isDuplicate(m)).map((m) => {
      const product = productById.get(m.productId);
      const from = m.fromCellId ? cellById.get(m.fromCellId) || "" : "";
      const to = m.toCellId ? cellById.get(m.toCellId) || "" : "";
      const rawType = clean(m.type);
      const action = /выда|спис/i.test(rawType) ? "Выдача" : /перем/i.test(rawType) ? "Перемещение" : /размещ/i.test(rawType) ? "Размещение" : "Приход";
      return {
        id: `movement:${m.id}`,
        source: "movement",
        action,
        category: action === "Выдача" ? "Выдача" : action === "Перемещение" ? "Перемещение" : "Приход",
        entityType: "material",
        entityId: m.productId,
        entityName: product?.name || "Материал",
        details: [m.comment || m.sourceName || "", rawType && rawType !== action ? `Тип: ${rawType}` : ""].filter(Boolean).join(" · "),
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
      action === "createProduct" && unit ? `Ед.: ${unit}` : "",
      action === "createProduct" && clean(payload.category) ? `Категория: ${clean(payload.category)}` : "",
      action === "createProduct" && clean(payload.brand) ? `Бренд: ${clean(payload.brand)}` : "",
      action === "createProduct" && clean(payload.color) ? `Цвет: ${clean(payload.color)}` : "",
      action === "createProduct" && clean(payload.ral) ? `RAL: ${clean(payload.ral)}` : "",
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
