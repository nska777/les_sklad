import { and, eq, sql } from "drizzle-orm";
import { doublePrecision, pgTable, text } from "drizzle-orm/pg-core";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { departmentCells, departmentMovements, departmentProducts, departmentStocks } from "@/db/schema";
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

const clean = (value: unknown) => String(value ?? "").trim();
const amount = (value: unknown) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const normalized = String(value ?? "").trim().replace(/\s/g, "").replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
};
const autoBarcode = () => `${Date.now()}${Math.floor(Math.random() * 100000).toString().padStart(5, "0")}`;

type UnitInfo = { code: string; kind: "mass" | "volume" | "count"; factor: number };
function unitInfo(value: unknown): UnitInfo | null {
  const raw = clean(value).toLowerCase().replace(/\./g, "");
  if (["кг", "kg", "килограмм", "килограммы"].includes(raw)) return { code: "кг", kind: "mass", factor: 1 };
  if (["г", "гр", "g", "грамм", "граммы"].includes(raw)) return { code: "г", kind: "mass", factor: 0.001 };
  if (["мг", "mg", "миллиграмм", "миллиграммы"].includes(raw)) return { code: "мг", kind: "mass", factor: 0.000001 };
  if (["л", "l", "литр", "литры"].includes(raw)) return { code: "л", kind: "volume", factor: 1 };
  if (["мл", "ml", "миллилитр", "миллилитры"].includes(raw)) return { code: "мл", kind: "volume", factor: 0.001 };
  if (["мкл", "mkl", "µl", "ul"].includes(raw)) return { code: "мкл", kind: "volume", factor: 0.000001 };
  if (["шт", "шт.", "pcs", "piece", "штука", "штуки"].includes(clean(value).toLowerCase())) return { code: "шт.", kind: "count", factor: 1 };
  return null;
}

function context(request: NextRequest) {
  const code = request.headers.get("x-warehouse-code");
  if (!isWarehouseCode(code) || code === "hardware") return null;
  return { warehouseCode: code, operator: decodeURIComponent(request.headers.get("x-warehouse-user") || "Кладовщик") };
}

async function addStock(db: Awaited<ReturnType<typeof getDb>>, warehouseCode: string, productId: string, cellId: string, quantity: number) {
  const current = (await db.select().from(departmentStocks).where(and(eq(departmentStocks.warehouseCode, warehouseCode), eq(departmentStocks.productId, productId), eq(departmentStocks.cellId, cellId))).limit(1))[0];
  const next = Number(current?.quantity || 0) + quantity;
  if (current) await db.update(departmentStocks).set({ quantity: next, updatedAt: new Date().toISOString() }).where(and(eq(departmentStocks.warehouseCode, warehouseCode), eq(departmentStocks.productId, productId), eq(departmentStocks.cellId, cellId)));
  else await db.insert(departmentStocks).values({ warehouseCode, productId, cellId, quantity, updatedAt: new Date().toISOString() });
}

export async function POST(request: NextRequest) {
  const ctx = context(request);
  if (!ctx) return NextResponse.json({ error: "Недоступное подразделение" }, { status: 403 });
  try {
    const db = await getDb();
    const body = await request.json() as Record<string, unknown>;
    const catalogId = clean(body.catalogId), cellId = clean(body.cellId);
    const enteredQuantity = amount(body.quantity);
    const input = unitInfo(body.inputUnit);
    if (!catalogId || !cellId || enteredQuantity <= 0 || !input) return NextResponse.json({ error: "Выберите материал, ячейку, единицу и точное количество" }, { status: 400 });

    const [catalogRows, cellRows] = await Promise.all([
      db.select().from(oneCCatalog).where(and(eq(oneCCatalog.id, catalogId), eq(oneCCatalog.warehouseCode, ctx.warehouseCode))).limit(1),
      db.select().from(departmentCells).where(and(eq(departmentCells.id, cellId), eq(departmentCells.warehouseCode, ctx.warehouseCode))).limit(1),
    ]);
    const item = catalogRows[0]; const cell = cellRows[0];
    if (!item || !cell) return NextResponse.json({ error: "Материал 1С или ячейка не найдены" }, { status: 404 });

    let product = item.linkedProductId ? (await db.select().from(departmentProducts).where(and(eq(departmentProducts.id, item.linkedProductId), eq(departmentProducts.warehouseCode, ctx.warehouseCode))).limit(1))[0] : undefined;
    if (!product && item.oneCId) product = (await db.select().from(departmentProducts).where(and(eq(departmentProducts.warehouseCode, ctx.warehouseCode), eq(departmentProducts.oneCId, item.oneCId))).limit(1))[0];
    if (!product && item.sku) product = (await db.select().from(departmentProducts).where(and(eq(departmentProducts.warehouseCode, ctx.warehouseCode), eq(departmentProducts.sku, item.sku))).limit(1))[0];

    const catalogUnit = unitInfo(item.unit);
    let baseUnit = input.code;
    let normalizedQuantity = enteredQuantity;
    if (product) {
      const currentUnit = unitInfo(product.unit);
      if (!currentUnit) return NextResponse.json({ error: `У материала неподдерживаемая базовая единица: ${product.unit}` }, { status: 409 });
      if (currentUnit.kind !== input.kind) return NextResponse.json({ error: `Нельзя разместить ${input.code} в материал, который учитывается в ${currentUnit.code}` }, { status: 409 });
      baseUnit = currentUnit.code;
      normalizedQuantity = enteredQuantity * input.factor / currentUnit.factor;
    } else {
      const targetUnit = catalogUnit && catalogUnit.kind === input.kind ? catalogUnit : input;
      baseUnit = targetUnit.code;
      normalizedQuantity = enteredQuantity * input.factor / targetUnit.factor;
      const id = crypto.randomUUID();
      await db.insert(departmentProducts).values({
        id, warehouseCode: ctx.warehouseCode, name: item.name, sku: item.sku || `1C-${id.slice(0, 8).toUpperCase()}`,
        barcode: item.barcode || autoBarcode(), category: item.category || "Краска", subcategory: "", brand: "", color: "", ral: "",
        unit: baseUnit, packType: "", packSize: 0, imageUrl: "", minStock: 0, comment: "",
        oneCId: item.oneCId || null, createdBy: ctx.operator, source: "1c", archived: false,
      });
      product = (await db.select().from(departmentProducts).where(eq(departmentProducts.id, id)).limit(1))[0];
    }

    if (!product) return NextResponse.json({ error: "Не удалось создать фактический материал" }, { status: 500 });
    normalizedQuantity = Number(normalizedQuantity.toFixed(9));
    const productUnit = unitInfo(baseUnit);
    if (!productUnit) return NextResponse.json({ error: "Не удалось определить единицу учёта" }, { status: 409 });

    const stockBefore = await db.select().from(departmentStocks).where(and(eq(departmentStocks.warehouseCode, ctx.warehouseCode), eq(departmentStocks.productId, product.id), sql`${departmentStocks.quantity} > 0`));
    const factBeforeProduct = stockBefore.reduce((sum, s) => sum + Number(s.quantity), 0);
    const comparisonUnit = catalogUnit && catalogUnit.kind === productUnit.kind ? catalogUnit : productUnit;
    const factBeforeComparison = factBeforeProduct * productUnit.factor / comparisonUnit.factor;
    const addComparison = normalizedQuantity * productUnit.factor / comparisonUnit.factor;
    const limit1c = Number(item.quantity || 0);
    const excessBefore = Math.max(0, factBeforeComparison - limit1c);
    const factAfterComparison = factBeforeComparison + addComparison;
    const excessAfter = Math.max(0, factAfterComparison - limit1c);
    const excessAdded = Math.max(0, excessAfter - excessBefore);

    await db.update(departmentProducts).set({ name: item.name, barcode: item.barcode || product.barcode || autoBarcode(), oneCId: item.oneCId || product.oneCId, unit: baseUnit, archived: false }).where(eq(departmentProducts.id, product.id));
    await db.update(oneCCatalog).set({ linkedProductId: product.id }).where(eq(oneCCatalog.id, item.id));
    await addStock(db, ctx.warehouseCode, product.id, cellId, normalizedQuantity);
    const conversionNote = input.code === baseUnit ? `${enteredQuantity} ${input.code}` : `${enteredQuantity} ${input.code} = ${normalizedQuantity} ${baseUnit}`;
    const excessNote = excessAdded > 1e-12 ? ` · ВНИМАНИЕ: сверх 1С +${Number(excessAdded.toFixed(9))} ${comparisonUnit.code}; количество учтено в разделе «Излишки»` : "";
    await db.insert(departmentMovements).values({
      id: crypto.randomUUID(), warehouseCode: ctx.warehouseCode, type: excessAdded > 1e-12 ? "Размещение / излишек" : "Размещение", productId: product.id, fromCellId: null, toCellId: cellId,
      quantity: normalizedQuantity, recipient: "", comment: `Фактическое размещение из справочника 1С · ${conversionNote}${excessNote}`, operator: ctx.operator,
      documentNumber: excessAdded > 1e-12 ? "1С-ИЗЛИШЕК" : "1С-РАЗМЕЩЕНИЕ", sourceName: "Справочник 1С", sourceLocation: "", batchId: "",
    });
    const warning = excessAdded > 1e-12 ? `Вы пополняете больше, чем существует в базе 1С. Сверх лимита: ${Number(excessAdded.toFixed(9))} ${comparisonUnit.code}. Излишек автоматически учтён в разделе «Излишки».` : undefined;
    return NextResponse.json({ ok: true, productId: product.id, barcode: product.barcode, enteredQuantity, inputUnit: input.code, storedQuantity: normalizedQuantity, storedUnit: baseUnit, excessAdded: Number(excessAdded.toFixed(9)), excessTotal: Number(excessAfter.toFixed(9)), excessUnit: comparisonUnit.code, warning });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Операция не выполнена" }, { status: 500 });
  }
}
