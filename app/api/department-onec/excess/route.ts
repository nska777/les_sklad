import { and, eq, sql } from "drizzle-orm";
import { doublePrecision, pgTable, text } from "drizzle-orm/pg-core";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { departmentCells, departmentMovements, departmentProducts, departmentRacks, departmentStocks } from "@/db/schema";
import { isWarehouseCode } from "@/lib/warehouse-auth";

export const dynamic = "force-dynamic";

const oneCCatalog = pgTable("department_onec_catalog", {
  id: text("id").primaryKey(),
  warehouseCode: text("warehouse_code").notNull(),
  name: text("name").notNull(),
  sku: text("sku").notNull().default(""),
  oneCId: text("one_c_id"),
  barcode: text("barcode").notNull().default(""),
  category: text("category").notNull().default("Краска"),
  unit: text("unit").notNull().default("кг"),
  quantity: doublePrecision("quantity").notNull().default(0),
  sourceRow: doublePrecision("source_row").notNull().default(0),
  linkedProductId: text("linked_product_id"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

type UnitKind = "mass" | "volume" | "count";
type UnitInfo = { code: string; kind: UnitKind; factor: number };
const clean = (value: unknown) => String(value ?? "").trim();
const amount = (value: unknown) => {
  const n = Number(String(value ?? "").trim().replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
function unitInfo(value: unknown): UnitInfo | null {
  const raw = clean(value).toLowerCase().replace(/\./g, "");
  if (["кг", "kg", "килограмм", "килограммы"].includes(raw)) return { code: "кг", kind: "mass", factor: 1 };
  if (["г", "гр", "g", "грамм", "граммы"].includes(raw)) return { code: "г", kind: "mass", factor: .001 };
  if (["мг", "mg", "миллиграмм", "миллиграммы"].includes(raw)) return { code: "мг", kind: "mass", factor: .000001 };
  if (["л", "l", "литр", "литры"].includes(raw)) return { code: "л", kind: "volume", factor: 1 };
  if (["мл", "ml", "миллилитр", "миллилитры"].includes(raw)) return { code: "мл", kind: "volume", factor: .001 };
  if (["мкл", "mkl", "µl", "ul"].includes(raw)) return { code: "мкл", kind: "volume", factor: .000001 };
  if (["шт", "шт", "pcs", "piece", "штука", "штуки"].includes(raw)) return { code: "шт.", kind: "count", factor: 1 };
  return null;
}
function context(request: NextRequest) {
  const code = request.headers.get("x-warehouse-code");
  if (!isWarehouseCode(code) || code === "hardware") return null;
  return { warehouseCode: code, operator: decodeURIComponent(request.headers.get("x-warehouse-user") || "Кладовщик") };
}
function convert(value: number, from: UnitInfo, to: UnitInfo) {
  if (from.kind !== to.kind) return null;
  return value * from.factor / to.factor;
}

async function snapshot(db: Awaited<ReturnType<typeof getDb>>, warehouseCode: string) {
  const [catalog, products, stocks, cells, racks] = await Promise.all([
    db.select().from(oneCCatalog).where(eq(oneCCatalog.warehouseCode, warehouseCode)),
    db.select().from(departmentProducts).where(eq(departmentProducts.warehouseCode, warehouseCode)),
    db.select().from(departmentStocks).where(and(eq(departmentStocks.warehouseCode, warehouseCode), sql`${departmentStocks.quantity} > 0`)),
    db.select().from(departmentCells).where(eq(departmentCells.warehouseCode, warehouseCode)),
    db.select().from(departmentRacks).where(and(eq(departmentRacks.warehouseCode, warehouseCode), eq(departmentRacks.archived, false))),
  ]);
  const productMap = new Map(products.map((p) => [p.id, p]));
  const cellMap = new Map(cells.map((c) => [c.id, c]));
  const rackMap = new Map(racks.map((r) => [r.id, r]));
  const items = catalog.flatMap((item) => {
    if (!item.linkedProductId) return [];
    const product = productMap.get(item.linkedProductId);
    if (!product) return [];
    const productUnit = unitInfo(product.unit);
    const catalogUnit = unitInfo(item.unit) || productUnit;
    if (!productUnit || !catalogUnit || productUnit.kind !== catalogUnit.kind) return [];
    const productStocks = stocks.filter((s) => s.productId === product.id);
    const factProduct = productStocks.reduce((sum, s) => sum + Number(s.quantity), 0);
    const factCatalog = convert(factProduct, productUnit, catalogUnit) ?? 0;
    const excess = Math.max(0, factCatalog - Number(item.quantity || 0));
    if (excess <= 1e-12) return [];
    return [{
      catalogId: item.id,
      productId: product.id,
      name: item.name,
      sku: item.sku,
      barcode: item.barcode || product.barcode,
      unit: catalogUnit.code,
      productUnit: productUnit.code,
      quantity1c: Number(item.quantity || 0),
      fact: Number(factCatalog.toFixed(9)),
      excess: Number(excess.toFixed(9)),
      locations: productStocks.map((s) => {
        const cell = cellMap.get(s.cellId); const rack = cell ? rackMap.get(cell.rackId) : undefined;
        return {
          cellId: s.cellId,
          cellCode: cell?.code || "—",
          rackCode: rack?.code || "—",
          storageType: rack?.storageType || "rack",
          quantity: Number((convert(Number(s.quantity), productUnit, catalogUnit) || 0).toFixed(9)),
        };
      }).filter((x) => x.quantity > 0),
    }];
  });
  return items.sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

export async function GET(request: NextRequest) {
  const ctx = context(request);
  if (!ctx) return NextResponse.json({ error: "Недоступное подразделение" }, { status: 403 });
  try {
    const db = await getDb();
    const items = await snapshot(db, ctx.warehouseCode);
    return NextResponse.json({ items, totalPositions: items.length });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось загрузить излишки" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const ctx = context(request);
  if (!ctx) return NextResponse.json({ error: "Недоступное подразделение" }, { status: 403 });
  try {
    const db = await getDb();
    const body = await request.json() as Record<string, unknown>;
    const action = clean(body.action), catalogId = clean(body.catalogId), cellId = clean(body.cellId);
    const rows = await snapshot(db, ctx.warehouseCode);
    const row = rows.find((x) => x.catalogId === catalogId);
    if (!row) return NextResponse.json({ error: "Излишек не найден" }, { status: 404 });
    const product = (await db.select().from(departmentProducts).where(and(eq(departmentProducts.id, row.productId), eq(departmentProducts.warehouseCode, ctx.warehouseCode))).limit(1))[0];
    if (!product) return NextResponse.json({ error: "Материал не найден" }, { status: 404 });
    const catalogUnit = unitInfo(row.unit), productUnit = unitInfo(product.unit), input = unitInfo(body.inputUnit || row.unit);
    if (!catalogUnit || !productUnit || !input || input.kind !== catalogUnit.kind || productUnit.kind !== catalogUnit.kind) return NextResponse.json({ error: "Несовместимые единицы измерения" }, { status: 409 });

    if (action === "issue") {
      const entered = amount(body.quantity);
      const issueCatalog = convert(entered, input, catalogUnit) ?? 0;
      const issueProduct = convert(entered, input, productUnit) ?? 0;
      if (entered <= 0 || issueCatalog <= 0) return NextResponse.json({ error: "Укажите количество" }, { status: 400 });
      if (issueCatalog > row.excess + 1e-9) return NextResponse.json({ error: `Можно выдать из излишков не более ${row.excess} ${row.unit}` }, { status: 409 });
      const stock = (await db.select().from(departmentStocks).where(and(eq(departmentStocks.warehouseCode, ctx.warehouseCode), eq(departmentStocks.productId, row.productId), eq(departmentStocks.cellId, cellId))).limit(1))[0];
      if (!stock || Number(stock.quantity) + 1e-9 < issueProduct) return NextResponse.json({ error: "В выбранной ячейке недостаточно остатка" }, { status: 409 });
      const next = Math.max(0, Number(stock.quantity) - issueProduct);
      await db.update(departmentStocks).set({ quantity: next, updatedAt: new Date().toISOString() }).where(and(eq(departmentStocks.warehouseCode, ctx.warehouseCode), eq(departmentStocks.productId, row.productId), eq(departmentStocks.cellId, cellId)));
      await db.insert(departmentMovements).values({ id: crypto.randomUUID(), warehouseCode: ctx.warehouseCode, type: "Выдача излишка", productId: row.productId, fromCellId: cellId, toCellId: null, quantity: Number(issueProduct.toFixed(9)), recipient: clean(body.recipient), comment: "Выдача из раздела Излишки", operator: ctx.operator, documentNumber: "ИЗЛИШКИ", sourceName: "Излишки", sourceLocation: "", batchId: "" });
      return NextResponse.json({ ok: true });
    }

    if (action === "adjust") {
      const enteredTarget = amount(body.targetExcess);
      const targetCatalog = convert(enteredTarget, input, catalogUnit) ?? 0;
      if (enteredTarget < 0 || targetCatalog < 0) return NextResponse.json({ error: "Количество излишка не может быть отрицательным" }, { status: 400 });
      const deltaCatalog = targetCatalog - row.excess;
      if (Math.abs(deltaCatalog) <= 1e-9) return NextResponse.json({ ok: true });
      const deltaProductAbs = Math.abs(convert(Math.abs(deltaCatalog), catalogUnit, productUnit) || 0);
      if (deltaCatalog > 0) {
        if (!cellId) return NextResponse.json({ error: "Для увеличения излишка выберите ячейку" }, { status: 400 });
        const stock = (await db.select().from(departmentStocks).where(and(eq(departmentStocks.warehouseCode, ctx.warehouseCode), eq(departmentStocks.productId, row.productId), eq(departmentStocks.cellId, cellId))).limit(1))[0];
        const next = Number(stock?.quantity || 0) + deltaProductAbs;
        if (stock) await db.update(departmentStocks).set({ quantity: next, updatedAt: new Date().toISOString() }).where(and(eq(departmentStocks.warehouseCode, ctx.warehouseCode), eq(departmentStocks.productId, row.productId), eq(departmentStocks.cellId, cellId)));
        else await db.insert(departmentStocks).values({ warehouseCode: ctx.warehouseCode, productId: row.productId, cellId, quantity: deltaProductAbs, updatedAt: new Date().toISOString() });
        await db.insert(departmentMovements).values({ id: crypto.randomUUID(), warehouseCode: ctx.warehouseCode, type: "Корректировка излишка", productId: row.productId, fromCellId: null, toCellId: cellId, quantity: Number(deltaProductAbs.toFixed(9)), recipient: "", comment: `Излишек увеличен до ${targetCatalog} ${row.unit}`, operator: ctx.operator, documentNumber: "ИЗЛИШКИ-КОРР", sourceName: "Излишки", sourceLocation: "", batchId: "" });
      } else {
        let remaining = deltaProductAbs;
        const productStocks = await db.select().from(departmentStocks).where(and(eq(departmentStocks.warehouseCode, ctx.warehouseCode), eq(departmentStocks.productId, row.productId), sql`${departmentStocks.quantity} > 0`));
        for (const stock of productStocks) {
          if (remaining <= 1e-12) break;
          const take = Math.min(Number(stock.quantity), remaining);
          const next = Math.max(0, Number(stock.quantity) - take);
          await db.update(departmentStocks).set({ quantity: next, updatedAt: new Date().toISOString() }).where(and(eq(departmentStocks.warehouseCode, ctx.warehouseCode), eq(departmentStocks.productId, row.productId), eq(departmentStocks.cellId, stock.cellId)));
          await db.insert(departmentMovements).values({ id: crypto.randomUUID(), warehouseCode: ctx.warehouseCode, type: "Корректировка излишка", productId: row.productId, fromCellId: stock.cellId, toCellId: null, quantity: Number(take.toFixed(9)), recipient: "", comment: `Излишек уменьшен до ${targetCatalog} ${row.unit}`, operator: ctx.operator, documentNumber: "ИЗЛИШКИ-КОРР", sourceName: "Излишки", sourceLocation: "", batchId: "" });
          remaining -= take;
        }
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Неизвестная операция" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Операция не выполнена" }, { status: 500 });
  }
}
