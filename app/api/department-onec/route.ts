import { and, asc, eq, sql } from "drizzle-orm";
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

const legacyReference = pgTable("department_onec_reference", {
  warehouseCode: text("warehouse_code").notNull(),
  productId: text("product_id").notNull(),
  quantity: doublePrecision("quantity").notNull().default(0),
  sourceRow: doublePrecision("source_row").notNull().default(0),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

const clean = (value: unknown) => String(value ?? "").trim();
const amount = (value: unknown) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const n = Number(String(value ?? "").trim().replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
const autoBarcode = () => `${Date.now()}${Math.floor(Math.random() * 100000).toString().padStart(5, "0")}`;

function context(request: NextRequest) {
  const code = request.headers.get("x-warehouse-code");
  if (!isWarehouseCode(code) || code === "hardware") return null;
  return { warehouseCode: code, operator: decodeURIComponent(request.headers.get("x-warehouse-user") || "Кладовщик") };
}

async function ensureCatalog(db: Awaited<ReturnType<typeof getDb>>) {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS department_onec_catalog (
    id text PRIMARY KEY,
    warehouse_code text NOT NULL,
    name text NOT NULL,
    sku text NOT NULL DEFAULT '',
    one_c_id text,
    barcode text NOT NULL DEFAULT '',
    category text NOT NULL DEFAULT 'Краска',
    unit text NOT NULL DEFAULT 'кг',
    quantity double precision NOT NULL DEFAULT 0,
    source_row double precision NOT NULL DEFAULT 0,
    linked_product_id text,
    updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_department_onec_catalog_wh_name ON department_onec_catalog(warehouse_code, name)`);
}

async function migrateLegacyReference(db: Awaited<ReturnType<typeof getDb>>, warehouseCode: string) {
  const existing = await db.select({ id: oneCCatalog.id }).from(oneCCatalog).where(eq(oneCCatalog.warehouseCode, warehouseCode)).limit(1);
  if (existing.length) return;
  try {
    const refs = await db.select().from(legacyReference).where(eq(legacyReference.warehouseCode, warehouseCode));
    if (!refs.length) return;
    const products = await db.select().from(departmentProducts).where(and(eq(departmentProducts.warehouseCode, warehouseCode), eq(departmentProducts.source, "1c")));
    const productMap = new Map(products.map((p) => [p.id, p]));
    for (const ref of refs) {
      const p = productMap.get(ref.productId);
      if (!p) continue;
      await db.insert(oneCCatalog).values({
        id: crypto.randomUUID(), warehouseCode, name: p.name, sku: p.sku, oneCId: p.oneCId || null,
        barcode: p.barcode || autoBarcode(), category: p.category || "Краска", unit: p.unit || "кг",
        quantity: Number(ref.quantity || 0), sourceRow: Number(ref.sourceRow || 0), linkedProductId: p.id,
        updatedAt: new Date().toISOString(),
      });
    }
  } catch { /* legacy table may not exist on a fresh install */ }
}

async function pruneUnplacedImportedProducts(db: Awaited<ReturnType<typeof getDb>>, warehouseCode: string) {
  const imported = await db.select().from(departmentProducts).where(and(eq(departmentProducts.warehouseCode, warehouseCode), eq(departmentProducts.source, "1c")));
  for (const p of imported) {
    const stock = (await db.select({ productId: departmentStocks.productId }).from(departmentStocks)
      .where(and(eq(departmentStocks.warehouseCode, warehouseCode), eq(departmentStocks.productId, p.id), sql`${departmentStocks.quantity} > 0`)).limit(1))[0];
    const movement = (await db.select({ id: departmentMovements.id }).from(departmentMovements)
      .where(and(eq(departmentMovements.warehouseCode, warehouseCode), eq(departmentMovements.productId, p.id))).limit(1))[0];
    if (!stock && !movement) {
      await db.update(oneCCatalog).set({ linkedProductId: null }).where(and(eq(oneCCatalog.warehouseCode, warehouseCode), eq(oneCCatalog.linkedProductId, p.id)));
      await db.delete(departmentProducts).where(eq(departmentProducts.id, p.id));
    }
  }
}

async function addStock(db: Awaited<ReturnType<typeof getDb>>, warehouseCode: string, productId: string, cellId: string, quantity: number) {
  const current = (await db.select().from(departmentStocks).where(and(eq(departmentStocks.warehouseCode, warehouseCode), eq(departmentStocks.productId, productId), eq(departmentStocks.cellId, cellId))).limit(1))[0];
  const next = Number(current?.quantity || 0) + quantity;
  if (current) await db.update(departmentStocks).set({ quantity: next, updatedAt: new Date().toISOString() }).where(and(eq(departmentStocks.warehouseCode, warehouseCode), eq(departmentStocks.productId, productId), eq(departmentStocks.cellId, cellId)));
  else await db.insert(departmentStocks).values({ warehouseCode, productId, cellId, quantity, updatedAt: new Date().toISOString() });
}

export async function GET(request: NextRequest) {
  const ctx = context(request);
  if (!ctx) return NextResponse.json({ error: "Недоступное подразделение" }, { status: 403 });
  try {
    const db = await getDb();
    await ensureCatalog(db);
    await migrateLegacyReference(db, ctx.warehouseCode);
    await pruneUnplacedImportedProducts(db, ctx.warehouseCode);

    const [catalog, racks, cells, stocks] = await Promise.all([
      db.select().from(oneCCatalog).where(eq(oneCCatalog.warehouseCode, ctx.warehouseCode)).orderBy(asc(oneCCatalog.name)),
      db.select().from(departmentRacks).where(and(eq(departmentRacks.warehouseCode, ctx.warehouseCode), eq(departmentRacks.archived, false))).orderBy(asc(departmentRacks.code)),
      db.select().from(departmentCells).where(eq(departmentCells.warehouseCode, ctx.warehouseCode)).orderBy(asc(departmentCells.code)),
      db.select().from(departmentStocks).where(and(eq(departmentStocks.warehouseCode, ctx.warehouseCode), sql`${departmentStocks.quantity} > 0`)),
    ]);
    const activeRackIds = new Set(racks.map((r) => r.id));
    const activeCells = cells.filter((c) => activeRackIds.has(c.rackId));
    const activeCellIds = new Set(activeCells.map((c) => c.id));
    const physicalStocks = stocks.filter((s) => activeCellIds.has(s.cellId));
    return NextResponse.json({ products: catalog.map((x) => ({ ...x, quantity1c: Number(x.quantity || 0) })), racks, cells: activeCells, stocks: physicalStocks });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось загрузить материалы 1С" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const ctx = context(request);
  if (!ctx) return NextResponse.json({ error: "Недоступное подразделение" }, { status: 403 });
  try {
    const db = await getDb();
    await ensureCatalog(db);
    const body = await request.json() as Record<string, unknown>;
    const action = clean(body.action);

    if (action === "import") {
      const items = Array.isArray(body.items) ? body.items as Array<Record<string, unknown>> : [];
      if (!items.length) return NextResponse.json({ error: "В файле нет строк" }, { status: 400 });
      let created = 0, updated = 0;
      for (let index = 0; index < Math.min(items.length, 5000); index += 1) {
        const item = items[index]; const name = clean(item.name); if (!name) continue;
        const sku = clean(item.sku).toUpperCase(); const oneCId = clean(item.oneCId); const barcode = clean(item.barcode);
        let current = oneCId ? (await db.select().from(oneCCatalog).where(and(eq(oneCCatalog.warehouseCode, ctx.warehouseCode), eq(oneCCatalog.oneCId, oneCId))).limit(1))[0] : undefined;
        if (!current && sku) current = (await db.select().from(oneCCatalog).where(and(eq(oneCCatalog.warehouseCode, ctx.warehouseCode), eq(oneCCatalog.sku, sku))).limit(1))[0];
        if (!current) current = (await db.select().from(oneCCatalog).where(and(eq(oneCCatalog.warehouseCode, ctx.warehouseCode), eq(oneCCatalog.name, name))).limit(1))[0];
        const values = {
          name, sku: sku || current?.sku || `1C-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
          oneCId: oneCId || current?.oneCId || null, barcode: barcode || current?.barcode || autoBarcode(),
          category: clean(item.category) || current?.category || "Краска", unit: clean(item.unit) || current?.unit || "кг",
          quantity: Math.max(0, amount(item.quantity)), sourceRow: Number(item.sourceRow || index + 2), updatedAt: new Date().toISOString(),
        };
        if (current) { await db.update(oneCCatalog).set(values).where(eq(oneCCatalog.id, current.id)); updated += 1; }
        else { await db.insert(oneCCatalog).values({ id: crypto.randomUUID(), warehouseCode: ctx.warehouseCode, linkedProductId: null, ...values }); created += 1; }
      }
      await pruneUnplacedImportedProducts(db, ctx.warehouseCode);
      return NextResponse.json({ ok: true, created, updated, references: created + updated });
    }

    if (action === "place") {
      const catalogId = clean(body.catalogId || body.productId), cellId = clean(body.cellId), quantity = amount(body.quantity);
      if (!catalogId || !cellId || quantity <= 0) return NextResponse.json({ error: "Выберите материал, ячейку и количество" }, { status: 400 });
      const [catalog, cell] = await Promise.all([
        db.select().from(oneCCatalog).where(and(eq(oneCCatalog.id, catalogId), eq(oneCCatalog.warehouseCode, ctx.warehouseCode))).limit(1),
        db.select().from(departmentCells).where(and(eq(departmentCells.id, cellId), eq(departmentCells.warehouseCode, ctx.warehouseCode))).limit(1),
      ]);
      const item = catalog[0]; if (!item || !cell[0]) return NextResponse.json({ error: "Материал 1С или ячейка не найдены" }, { status: 404 });

      let product = item.linkedProductId ? (await db.select().from(departmentProducts).where(and(eq(departmentProducts.id, item.linkedProductId), eq(departmentProducts.warehouseCode, ctx.warehouseCode))).limit(1))[0] : undefined;
      if (!product && item.oneCId) product = (await db.select().from(departmentProducts).where(and(eq(departmentProducts.warehouseCode, ctx.warehouseCode), eq(departmentProducts.oneCId, item.oneCId))).limit(1))[0];
      if (!product && item.sku) product = (await db.select().from(departmentProducts).where(and(eq(departmentProducts.warehouseCode, ctx.warehouseCode), eq(departmentProducts.sku, item.sku))).limit(1))[0];
      if (!product) {
        const id = crypto.randomUUID();
        await db.insert(departmentProducts).values({
          id, warehouseCode: ctx.warehouseCode, name: item.name, sku: item.sku || `1C-${id.slice(0, 8).toUpperCase()}`,
          barcode: item.barcode || autoBarcode(), category: item.category || "Краска", subcategory: "", brand: "", color: "", ral: "",
          unit: item.unit || "кг", packType: "", packSize: 0, imageUrl: "", minStock: 0, comment: "",
          oneCId: item.oneCId || null, createdBy: ctx.operator, source: "1c", archived: false,
        });
        product = (await db.select().from(departmentProducts).where(eq(departmentProducts.id, id)).limit(1))[0];
      } else {
        await db.update(departmentProducts).set({ name: item.name, barcode: item.barcode || product.barcode, oneCId: item.oneCId || product.oneCId, unit: item.unit || product.unit, archived: false }).where(eq(departmentProducts.id, product.id));
      }
      await db.update(oneCCatalog).set({ linkedProductId: product.id }).where(eq(oneCCatalog.id, item.id));
      await addStock(db, ctx.warehouseCode, product.id, cellId, quantity);
      await db.insert(departmentMovements).values({ id: crypto.randomUUID(), warehouseCode: ctx.warehouseCode, type: "Размещение", productId: product.id, fromCellId: null, toCellId: cellId, quantity, recipient: "", comment: "Фактическое размещение из справочника 1С", operator: ctx.operator, documentNumber: "1С-РАЗМЕЩЕНИЕ", sourceName: "Справочник 1С", sourceLocation: "", batchId: "" });
      return NextResponse.json({ ok: true, productId: product.id, barcode: product.barcode });
    }

    if (action === "clear") {
      await db.delete(oneCCatalog).where(eq(oneCCatalog.warehouseCode, ctx.warehouseCode));
      await pruneUnplacedImportedProducts(db, ctx.warehouseCode);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Неизвестная операция" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Операция не выполнена" }, { status: 500 });
  }
}
