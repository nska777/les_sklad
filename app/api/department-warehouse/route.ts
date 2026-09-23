import { and, asc, desc, eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { departmentCells, departmentMovements, departmentProducts, departmentRacks, departmentStocks } from "@/db/schema";
import { isWarehouseCode, warehouseName } from "@/lib/warehouse-auth";

export const dynamic = "force-dynamic";

const clean = (value: unknown) => String(value ?? "").trim();
const amount = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

function context(request: NextRequest) {
  const code = request.headers.get("x-warehouse-code");
  if (!isWarehouseCode(code) || code === "hardware") return null;
  return {
    warehouseCode: code,
    operator: decodeURIComponent(request.headers.get("x-warehouse-user") || "Кладовщик"),
  };
}

async function ownedProduct(db: Awaited<ReturnType<typeof getDb>>, warehouseCode: string, id: string) {
  const [row] = await db.select().from(departmentProducts).where(and(eq(departmentProducts.id, id), eq(departmentProducts.warehouseCode, warehouseCode))).limit(1);
  return row;
}

async function ownedCell(db: Awaited<ReturnType<typeof getDb>>, warehouseCode: string, id: string) {
  const [row] = await db.select().from(departmentCells).where(and(eq(departmentCells.id, id), eq(departmentCells.warehouseCode, warehouseCode))).limit(1);
  return row;
}

async function setStock(db: Awaited<ReturnType<typeof getDb>>, warehouseCode: string, productId: string, cellId: string, quantity: number) {
  const [current] = await db.select().from(departmentStocks).where(and(
    eq(departmentStocks.warehouseCode, warehouseCode),
    eq(departmentStocks.productId, productId),
    eq(departmentStocks.cellId, cellId),
  )).limit(1);

  if (current) {
    await db.update(departmentStocks).set({ quantity, updatedAt: new Date().toISOString() }).where(and(
      eq(departmentStocks.warehouseCode, warehouseCode),
      eq(departmentStocks.productId, productId),
      eq(departmentStocks.cellId, cellId),
    ));
  } else {
    await db.insert(departmentStocks).values({ warehouseCode, productId, cellId, quantity, updatedAt: new Date().toISOString() });
  }
}

export async function GET(request: NextRequest) {
  const ctx = context(request);
  if (!ctx) return NextResponse.json({ error: "Недоступное подразделение" }, { status: 403 });

  try {
    const db = await getDb();
    const [racks, cells, products, stocks, movements] = await Promise.all([
      db.select().from(departmentRacks).where(and(eq(departmentRacks.warehouseCode, ctx.warehouseCode), eq(departmentRacks.archived, false))).orderBy(asc(departmentRacks.code)),
      db.select().from(departmentCells).where(eq(departmentCells.warehouseCode, ctx.warehouseCode)).orderBy(asc(departmentCells.code)),
      db.select().from(departmentProducts).where(eq(departmentProducts.warehouseCode, ctx.warehouseCode)).orderBy(asc(departmentProducts.name)),
      db.select().from(departmentStocks).where(and(eq(departmentStocks.warehouseCode, ctx.warehouseCode), sql`${departmentStocks.quantity} > 0`)),
      db.select().from(departmentMovements).where(eq(departmentMovements.warehouseCode, ctx.warehouseCode)).orderBy(desc(departmentMovements.createdAt)).limit(300),
    ]);

    const productById = new Map(products.map((row) => [row.id, row]));
    const cellById = new Map(cells.map((row) => [row.id, row]));
    const movementRows = movements.map((row) => ({
      ...row,
      productName: productById.get(row.productId)?.name || "Материал",
      productSku: productById.get(row.productId)?.sku || "",
      productUnit: productById.get(row.productId)?.unit || "",
      fromCellCode: row.fromCellId ? cellById.get(row.fromCellId)?.code || "" : "",
      toCellCode: row.toCellId ? cellById.get(row.toCellId)?.code || "" : "",
    }));

    return NextResponse.json({
      warehouse: { code: ctx.warehouseCode, name: warehouseName(ctx.warehouseCode) },
      racks,
      cells,
      products,
      stocks,
      movements: movementRows,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось загрузить склад" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const ctx = context(request);
  if (!ctx) return NextResponse.json({ error: "Недоступное подразделение" }, { status: 403 });

  try {
    const db = await getDb();
    const body = await request.json() as Record<string, unknown>;
    const action = clean(body.action);

    if (action === "createRack") {
      const name = clean(body.name);
      const code = clean(body.code).toUpperCase().replace(/[^A-ZА-Я0-9_-]/gi, "");
      const rows = Math.max(1, Math.min(12, Math.floor(amount(body.rows) || 4)));
      const columns = Math.max(1, Math.min(20, Math.floor(amount(body.columns) || 4)));
      if (!name || !code) return NextResponse.json({ error: "Укажите название и код стеллажа" }, { status: 400 });

      const [duplicate] = await db.select({ id: departmentRacks.id }).from(departmentRacks).where(and(eq(departmentRacks.warehouseCode, ctx.warehouseCode), eq(departmentRacks.code, code))).limit(1);
      if (duplicate) return NextResponse.json({ error: "Стеллаж с таким кодом уже существует" }, { status: 409 });

      const rackId = crypto.randomUUID();
      await db.insert(departmentRacks).values({ id: rackId, warehouseCode: ctx.warehouseCode, name, code, rows, columns, archived: false });
      const cellValues = Array.from({ length: rows * columns }, (_, index) => {
        const rowIndex = Math.floor(index / columns);
        const columnIndex = index % columns;
        const cellCode = `${code}${rowIndex + 1}${String.fromCharCode(65 + columnIndex)}`;
        return { id: crypto.randomUUID(), warehouseCode: ctx.warehouseCode, rackId, code: cellCode, label: cellCode, rowIndex, columnIndex, blocked: false };
      });
      if (cellValues.length) await db.insert(departmentCells).values(cellValues);
      return NextResponse.json({ ok: true, rackId });
    }

    if (action === "createProduct") {
      const name = clean(body.name);
      const sku = clean(body.sku).toUpperCase() || `MAT-${Date.now().toString(36).toUpperCase()}`;
      const barcode = clean(body.barcode);
      const category = clean(body.category) || (ctx.warehouseCode === "paint" ? "Краска" : "Материалы");
      const unit = clean(body.unit) || (ctx.warehouseCode === "paint" ? "кг" : "шт.");
      const minStock = Math.max(0, amount(body.minStock));
      if (!name) return NextResponse.json({ error: "Укажите название материала" }, { status: 400 });
      const [duplicate] = await db.select({ id: departmentProducts.id }).from(departmentProducts).where(and(eq(departmentProducts.warehouseCode, ctx.warehouseCode), eq(departmentProducts.sku, sku))).limit(1);
      if (duplicate) return NextResponse.json({ error: "Материал с таким артикулом уже существует" }, { status: 409 });
      const id = crypto.randomUUID();
      await db.insert(departmentProducts).values({ id, warehouseCode: ctx.warehouseCode, name, sku, barcode, category, unit, minStock, oneCId: null });
      return NextResponse.json({ ok: true, id });
    }

    if (action === "receive") {
      const productId = clean(body.productId);
      const cellId = clean(body.cellId);
      const quantity = amount(body.quantity);
      if (quantity <= 0) return NextResponse.json({ error: "Количество должно быть больше нуля" }, { status: 400 });
      const [product, cell] = await Promise.all([ownedProduct(db, ctx.warehouseCode, productId), ownedCell(db, ctx.warehouseCode, cellId)]);
      if (!product || !cell) return NextResponse.json({ error: "Материал или ячейка не найдены на этом складе" }, { status: 404 });
      const [current] = await db.select().from(departmentStocks).where(and(eq(departmentStocks.warehouseCode, ctx.warehouseCode), eq(departmentStocks.productId, productId), eq(departmentStocks.cellId, cellId))).limit(1);
      await setStock(db, ctx.warehouseCode, productId, cellId, Number(current?.quantity || 0) + quantity);
      await db.insert(departmentMovements).values({ id: crypto.randomUUID(), warehouseCode: ctx.warehouseCode, type: "Приход", productId, fromCellId: null, toCellId: cellId, quantity, recipient: "", comment: clean(body.comment), operator: ctx.operator });
      return NextResponse.json({ ok: true });
    }

    if (action === "issue") {
      const productId = clean(body.productId);
      const cellId = clean(body.cellId);
      const quantity = amount(body.quantity);
      if (quantity <= 0) return NextResponse.json({ error: "Количество должно быть больше нуля" }, { status: 400 });
      const [product, cell] = await Promise.all([ownedProduct(db, ctx.warehouseCode, productId), ownedCell(db, ctx.warehouseCode, cellId)]);
      if (!product || !cell) return NextResponse.json({ error: "Материал или ячейка не найдены на этом складе" }, { status: 404 });
      const [current] = await db.select().from(departmentStocks).where(and(eq(departmentStocks.warehouseCode, ctx.warehouseCode), eq(departmentStocks.productId, productId), eq(departmentStocks.cellId, cellId))).limit(1);
      const available = Number(current?.quantity || 0);
      if (available < quantity) return NextResponse.json({ error: `Недостаточно на ячейке. Доступно: ${available} ${product.unit}` }, { status: 409 });
      await setStock(db, ctx.warehouseCode, productId, cellId, available - quantity);
      await db.insert(departmentMovements).values({ id: crypto.randomUUID(), warehouseCode: ctx.warehouseCode, type: "Выдача", productId, fromCellId: cellId, toCellId: null, quantity, recipient: clean(body.recipient), comment: clean(body.comment), operator: ctx.operator });
      return NextResponse.json({ ok: true });
    }

    if (action === "transfer") {
      const productId = clean(body.productId);
      const fromCellId = clean(body.fromCellId);
      const toCellId = clean(body.toCellId);
      const quantity = amount(body.quantity);
      if (quantity <= 0 || fromCellId === toCellId) return NextResponse.json({ error: "Проверьте ячейки и количество" }, { status: 400 });
      const [product, fromCell, toCell] = await Promise.all([
        ownedProduct(db, ctx.warehouseCode, productId),
        ownedCell(db, ctx.warehouseCode, fromCellId),
        ownedCell(db, ctx.warehouseCode, toCellId),
      ]);
      if (!product || !fromCell || !toCell) return NextResponse.json({ error: "Материал или ячейка не найдены на этом складе" }, { status: 404 });
      const [fromStock] = await db.select().from(departmentStocks).where(and(eq(departmentStocks.warehouseCode, ctx.warehouseCode), eq(departmentStocks.productId, productId), eq(departmentStocks.cellId, fromCellId))).limit(1);
      const available = Number(fromStock?.quantity || 0);
      if (available < quantity) return NextResponse.json({ error: `Недостаточно на исходной ячейке. Доступно: ${available} ${product.unit}` }, { status: 409 });
      const [toStock] = await db.select().from(departmentStocks).where(and(eq(departmentStocks.warehouseCode, ctx.warehouseCode), eq(departmentStocks.productId, productId), eq(departmentStocks.cellId, toCellId))).limit(1);
      await setStock(db, ctx.warehouseCode, productId, fromCellId, available - quantity);
      await setStock(db, ctx.warehouseCode, productId, toCellId, Number(toStock?.quantity || 0) + quantity);
      await db.insert(departmentMovements).values({ id: crypto.randomUUID(), warehouseCode: ctx.warehouseCode, type: "Перемещение", productId, fromCellId, toCellId, quantity, recipient: "", comment: clean(body.comment), operator: ctx.operator });
      return NextResponse.json({ ok: true });
    }

    if (action === "deleteProduct") {
      const id = clean(body.id);
      const product = await ownedProduct(db, ctx.warehouseCode, id);
      if (!product) return NextResponse.json({ error: "Материал не найден" }, { status: 404 });
      const stockRows = await db.select().from(departmentStocks).where(and(eq(departmentStocks.warehouseCode, ctx.warehouseCode), eq(departmentStocks.productId, id), sql`${departmentStocks.quantity} > 0`)).limit(1);
      if (stockRows.length) return NextResponse.json({ error: "Нельзя удалить материал с остатком" }, { status: 409 });
      await db.delete(departmentProducts).where(and(eq(departmentProducts.id, id), eq(departmentProducts.warehouseCode, ctx.warehouseCode)));
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Неизвестная операция" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Операция не выполнена" }, { status: 500 });
  }
}
