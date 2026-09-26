import { and, asc, eq, sql } from "drizzle-orm";
import { doublePrecision, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { departmentCells, departmentMovements, departmentProducts, departmentRacks, departmentStocks } from "@/db/schema";
import { isWarehouseCode } from "@/lib/warehouse-auth";

export const dynamic = "force-dynamic";

const oneCReference = pgTable("department_onec_reference", {
  warehouseCode: text("warehouse_code").notNull(),
  productId: text("product_id").notNull(),
  quantity: doublePrecision("quantity").notNull().default(0),
  sourceRow: doublePrecision("source_row").notNull().default(0),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [primaryKey({ columns: [table.warehouseCode, table.productId] })]);

const clean = (value: unknown) => String(value ?? "").trim();
const amount = (value: unknown) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const normalized = String(value ?? "").trim().replace(/\s/g, "").replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
};
const autoBarcode = () => `${Date.now()}${Math.floor(Math.random() * 100000).toString().padStart(5, "0")}`;

function context(request: NextRequest) {
  const code = request.headers.get("x-warehouse-code");
  if (!isWarehouseCode(code) || code === "hardware") return null;
  return { warehouseCode: code, operator: decodeURIComponent(request.headers.get("x-warehouse-user") || "Кладовщик") };
}

async function ensureReferenceTable(db: Awaited<ReturnType<typeof getDb>>) {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS department_onec_reference (
    warehouse_code text NOT NULL,
    product_id text NOT NULL,
    quantity double precision NOT NULL DEFAULT 0,
    source_row double precision NOT NULL DEFAULT 0,
    updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (warehouse_code, product_id)
  )`);
}

async function setReference(db: Awaited<ReturnType<typeof getDb>>, warehouseCode: string, productId: string, quantity: number, sourceRow = 0) {
  const current = (await db.select().from(oneCReference).where(and(eq(oneCReference.warehouseCode, warehouseCode), eq(oneCReference.productId, productId))).limit(1))[0];
  if (current) {
    await db.update(oneCReference).set({ quantity: Math.max(0, quantity), sourceRow, updatedAt: new Date().toISOString() }).where(and(eq(oneCReference.warehouseCode, warehouseCode), eq(oneCReference.productId, productId)));
  } else {
    await db.insert(oneCReference).values({ warehouseCode, productId, quantity: Math.max(0, quantity), sourceRow, updatedAt: new Date().toISOString() });
  }
}

async function addStock(db: Awaited<ReturnType<typeof getDb>>, warehouseCode: string, productId: string, cellId: string, quantity: number) {
  const current = (await db.select().from(departmentStocks).where(and(eq(departmentStocks.warehouseCode, warehouseCode), eq(departmentStocks.productId, productId), eq(departmentStocks.cellId, cellId))).limit(1))[0];
  const next = Number(current?.quantity || 0) + quantity;
  if (current) {
    await db.update(departmentStocks).set({ quantity: next, updatedAt: new Date().toISOString() }).where(and(eq(departmentStocks.warehouseCode, warehouseCode), eq(departmentStocks.productId, productId), eq(departmentStocks.cellId, cellId)));
  } else {
    await db.insert(departmentStocks).values({ warehouseCode, productId, cellId, quantity, updatedAt: new Date().toISOString() });
  }
}

export async function GET(request: NextRequest) {
  const ctx = context(request);
  if (!ctx) return NextResponse.json({ error: "Недоступное подразделение" }, { status: 403 });
  try {
    const db = await getDb();
    await ensureReferenceTable(db);
    const [products, references, racks, cells, stocks] = await Promise.all([
      db.select().from(departmentProducts).where(and(eq(departmentProducts.warehouseCode, ctx.warehouseCode), eq(departmentProducts.archived, false), eq(departmentProducts.source, "1c"))).orderBy(asc(departmentProducts.name)),
      db.select().from(oneCReference).where(eq(oneCReference.warehouseCode, ctx.warehouseCode)),
      db.select().from(departmentRacks).where(and(eq(departmentRacks.warehouseCode, ctx.warehouseCode), eq(departmentRacks.archived, false))).orderBy(asc(departmentRacks.code)),
      db.select().from(departmentCells).where(eq(departmentCells.warehouseCode, ctx.warehouseCode)).orderBy(asc(departmentCells.code)),
      db.select().from(departmentStocks).where(and(eq(departmentStocks.warehouseCode, ctx.warehouseCode), sql`${departmentStocks.quantity} > 0`)),
    ]);
    const refByProduct = new Map(references.map((row) => [row.productId, Number(row.quantity || 0)]));
    const activeRackIds = new Set(racks.map((r) => r.id));
    const activeCells = cells.filter((c) => activeRackIds.has(c.rackId));
    const activeCellIds = new Set(activeCells.map((c) => c.id));
    const physicalStocks = stocks.filter((s) => activeCellIds.has(s.cellId));
    return NextResponse.json({
      products: products.map((p) => ({ ...p, quantity1c: refByProduct.get(p.id) || 0 })),
      racks,
      cells: activeCells,
      stocks: physicalStocks,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось загрузить материалы 1С" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const ctx = context(request);
  if (!ctx) return NextResponse.json({ error: "Недоступное подразделение" }, { status: 403 });
  try {
    const db = await getDb();
    await ensureReferenceTable(db);
    const body = await request.json() as Record<string, unknown>;
    const action = clean(body.action);

    if (action === "import") {
      const items = Array.isArray(body.items) ? body.items as Array<Record<string, unknown>> : [];
      if (!items.length) return NextResponse.json({ error: "В файле нет строк" }, { status: 400 });
      let created = 0, updated = 0, refs = 0;
      for (let index = 0; index < Math.min(items.length, 5000); index += 1) {
        const item = items[index];
        const name = clean(item.name);
        if (!name) continue;
        const skuRaw = clean(item.sku).toUpperCase();
        const oneCId = clean(item.oneCId);
        let existing = skuRaw ? (await db.select().from(departmentProducts).where(and(eq(departmentProducts.warehouseCode, ctx.warehouseCode), eq(departmentProducts.sku, skuRaw))).limit(1))[0] : undefined;
        if (!existing && oneCId) existing = (await db.select().from(departmentProducts).where(and(eq(departmentProducts.warehouseCode, ctx.warehouseCode), eq(departmentProducts.oneCId, oneCId))).limit(1))[0];
        if (!existing) existing = (await db.select().from(departmentProducts).where(and(eq(departmentProducts.warehouseCode, ctx.warehouseCode), eq(departmentProducts.name, name))).limit(1))[0];

        const sku = skuRaw || existing?.sku || `1C-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
        const values = {
          name,
          sku,
          barcode: clean(item.barcode) || existing?.barcode || autoBarcode(),
          category: clean(item.category) || existing?.category || "Краска",
          subcategory: clean(item.subcategory) || existing?.subcategory || "",
          brand: clean(item.brand) || existing?.brand || "",
          color: clean(item.color) || existing?.color || "",
          ral: clean(item.ral) || existing?.ral || "",
          unit: clean(item.unit) || existing?.unit || "кг",
          packType: clean(item.packType) || existing?.packType || "",
          packSize: Math.max(0, amount(item.packSize ?? existing?.packSize ?? 0)),
          imageUrl: clean(item.imageUrl) || existing?.imageUrl || "",
          minStock: Math.max(0, amount(item.minStock ?? existing?.minStock ?? 0)),
          comment: clean(item.comment) || existing?.comment || "",
          oneCId: oneCId || existing?.oneCId || null,
          createdBy: existing?.createdBy || ctx.operator,
          source: "1c",
          archived: false,
        };
        let productId: string;
        if (existing) {
          productId = existing.id;
          await db.update(departmentProducts).set(values).where(eq(departmentProducts.id, existing.id));
          updated += 1;
        } else {
          productId = crypto.randomUUID();
          await db.insert(departmentProducts).values({ id: productId, warehouseCode: ctx.warehouseCode, ...values });
          created += 1;
        }
        if (item.quantity !== undefined && item.quantity !== null && clean(item.quantity) !== "") {
          await setReference(db, ctx.warehouseCode, productId, Math.max(0, amount(item.quantity)), Number(item.sourceRow || index + 2));
          refs += 1;
        }
      }

      const incomingCells = await db.select({ id: departmentCells.id }).from(departmentCells).where(and(eq(departmentCells.warehouseCode, ctx.warehouseCode), eq(departmentCells.code, "ПРИЁМКА-1С")));
      for (const cell of incomingCells) await db.delete(departmentStocks).where(and(eq(departmentStocks.warehouseCode, ctx.warehouseCode), eq(departmentStocks.cellId, cell.id)));
      return NextResponse.json({ ok: true, created, updated, references: refs });
    }

    if (action === "place") {
      const productId = clean(body.productId), cellId = clean(body.cellId), quantity = amount(body.quantity);
      if (!productId || !cellId || quantity <= 0) return NextResponse.json({ error: "Выберите материал, ячейку и количество" }, { status: 400 });
      const [product, cell] = await Promise.all([
        db.select().from(departmentProducts).where(and(eq(departmentProducts.id, productId), eq(departmentProducts.warehouseCode, ctx.warehouseCode), eq(departmentProducts.archived, false))).limit(1),
        db.select().from(departmentCells).where(and(eq(departmentCells.id, cellId), eq(departmentCells.warehouseCode, ctx.warehouseCode))).limit(1),
      ]);
      if (!product[0] || !cell[0]) return NextResponse.json({ error: "Материал или ячейка не найдены" }, { status: 404 });
      await addStock(db, ctx.warehouseCode, productId, cellId, quantity);
      await db.insert(departmentMovements).values({
        id: crypto.randomUUID(), warehouseCode: ctx.warehouseCode, type: "Размещение", productId, fromCellId: null, toCellId: cellId,
        quantity, recipient: "", comment: clean(body.comment) || "Размещение из справочника 1С", operator: ctx.operator,
        documentNumber: clean(body.documentNumber) || "1С-РАЗМЕЩЕНИЕ", sourceName: "Справочник 1С", sourceLocation: "", batchId: "",
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "clear") {
      await db.delete(oneCReference).where(eq(oneCReference.warehouseCode, ctx.warehouseCode));
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Неизвестная операция" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Операция не выполнена" }, { status: 500 });
  }
}
