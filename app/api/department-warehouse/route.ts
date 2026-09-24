import { and, asc, desc, eq, or, sql } from "drizzle-orm";
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

async function ownedRack(db: Awaited<ReturnType<typeof getDb>>, warehouseCode: string, id: string) {
  const [row] = await db.select().from(departmentRacks).where(and(eq(departmentRacks.id, id), eq(departmentRacks.warehouseCode, warehouseCode))).limit(1);
  return row;
}

async function setStock(db: Awaited<ReturnType<typeof getDb>>, warehouseCode: string, productId: string, cellId: string, quantity: number) {
  const safeQuantity = Math.max(0, quantity);
  const [current] = await db.select().from(departmentStocks).where(and(
    eq(departmentStocks.warehouseCode, warehouseCode),
    eq(departmentStocks.productId, productId),
    eq(departmentStocks.cellId, cellId),
  )).limit(1);

  if (current) {
    await db.update(departmentStocks).set({ quantity: safeQuantity, updatedAt: new Date().toISOString() }).where(and(
      eq(departmentStocks.warehouseCode, warehouseCode),
      eq(departmentStocks.productId, productId),
      eq(departmentStocks.cellId, cellId),
    ));
  } else if (safeQuantity > 0) {
    await db.insert(departmentStocks).values({ warehouseCode, productId, cellId, quantity: safeQuantity, updatedAt: new Date().toISOString() });
  }
}

async function getStock(db: Awaited<ReturnType<typeof getDb>>, warehouseCode: string, productId: string, cellId: string) {
  const [row] = await db.select().from(departmentStocks).where(and(
    eq(departmentStocks.warehouseCode, warehouseCode),
    eq(departmentStocks.productId, productId),
    eq(departmentStocks.cellId, cellId),
  )).limit(1);
  return Number(row?.quantity || 0);
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
      db.select().from(departmentMovements).where(eq(departmentMovements.warehouseCode, ctx.warehouseCode)).orderBy(desc(departmentMovements.createdAt)).limit(500),
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

    return NextResponse.json({ warehouse: { code: ctx.warehouseCode, name: warehouseName(ctx.warehouseCode) }, racks, cells, products, stocks, movements: movementRows });
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

    if (action === "updateRack") {
      const id = clean(body.id);
      const rack = await ownedRack(db, ctx.warehouseCode, id);
      if (!rack) return NextResponse.json({ error: "Стеллаж не найден" }, { status: 404 });
      const name = clean(body.name) || rack.name;
      await db.update(departmentRacks).set({ name }).where(and(eq(departmentRacks.id, id), eq(departmentRacks.warehouseCode, ctx.warehouseCode)));
      return NextResponse.json({ ok: true });
    }

    if (action === "deleteRack") {
      const id = clean(body.id);
      const rack = await ownedRack(db, ctx.warehouseCode, id);
      if (!rack) return NextResponse.json({ error: "Стеллаж не найден" }, { status: 404 });
      const rackCells = await db.select({ id: departmentCells.id }).from(departmentCells).where(and(eq(departmentCells.warehouseCode, ctx.warehouseCode), eq(departmentCells.rackId, id)));
      const cellIds = rackCells.map((row) => row.id);
      if (cellIds.length) {
        const stockRows = await db.select().from(departmentStocks).where(and(eq(departmentStocks.warehouseCode, ctx.warehouseCode), sql`${departmentStocks.cellId} IN (${sql.join(cellIds.map((value) => sql`${value}`), sql`, `)})`, sql`${departmentStocks.quantity} > 0`)).limit(1);
        if (stockRows.length) return NextResponse.json({ error: "Сначала переместите или выдайте остатки из этого стеллажа" }, { status: 409 });
        for (const cellId of cellIds) {
          await db.update(departmentMovements).set({ fromCellId: null }).where(and(eq(departmentMovements.warehouseCode, ctx.warehouseCode), eq(departmentMovements.fromCellId, cellId)));
          await db.update(departmentMovements).set({ toCellId: null }).where(and(eq(departmentMovements.warehouseCode, ctx.warehouseCode), eq(departmentMovements.toCellId, cellId)));
        }
      }
      await db.delete(departmentRacks).where(and(eq(departmentRacks.id, id), eq(departmentRacks.warehouseCode, ctx.warehouseCode)));
      return NextResponse.json({ ok: true });
    }

    if (action === "updateCell") {
      const id = clean(body.id);
      const cell = await ownedCell(db, ctx.warehouseCode, id);
      if (!cell) return NextResponse.json({ error: "Ячейка не найдена" }, { status: 404 });
      await db.update(departmentCells).set({ label: clean(body.label) || cell.label, blocked: Boolean(body.blocked) }).where(and(eq(departmentCells.id, id), eq(departmentCells.warehouseCode, ctx.warehouseCode)));
      return NextResponse.json({ ok: true });
    }

    if (action === "createProduct") {
      const name = clean(body.name);
      const sku = clean(body.sku).toUpperCase() || `PAINT-${Date.now().toString(36).toUpperCase()}`;
      const barcode = clean(body.barcode) || `${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, "0")}`;
      const category = clean(body.category) || (ctx.warehouseCode === "paint" ? "Краска" : "Материалы");
      const unit = clean(body.unit) || (ctx.warehouseCode === "paint" ? "кг" : "шт.");
      const minStock = Math.max(0, amount(body.minStock));
      if (!name) return NextResponse.json({ error: "Укажите название материала" }, { status: 400 });
      const [duplicate] = await db.select({ id: departmentProducts.id }).from(departmentProducts).where(and(eq(departmentProducts.warehouseCode, ctx.warehouseCode), eq(departmentProducts.sku, sku))).limit(1);
      if (duplicate) return NextResponse.json({ error: "Материал с таким артикулом уже существует" }, { status: 409 });
      const id = crypto.randomUUID();
      await db.insert(departmentProducts).values({ id, warehouseCode: ctx.warehouseCode, name, sku, barcode, category, unit, minStock, oneCId: clean(body.oneCId) || null });
      return NextResponse.json({ ok: true, id });
    }

    if (action === "updateProduct") {
      const id = clean(body.id);
      const product = await ownedProduct(db, ctx.warehouseCode, id);
      if (!product) return NextResponse.json({ error: "Материал не найден" }, { status: 404 });
      const sku = clean(body.sku).toUpperCase() || product.sku;
      const [duplicate] = await db.select({ id: departmentProducts.id }).from(departmentProducts).where(and(eq(departmentProducts.warehouseCode, ctx.warehouseCode), eq(departmentProducts.sku, sku))).limit(1);
      if (duplicate && duplicate.id !== id) return NextResponse.json({ error: "Такой артикул уже используется" }, { status: 409 });
      await db.update(departmentProducts).set({
        name: clean(body.name) || product.name,
        sku,
        barcode: clean(body.barcode) || product.barcode,
        category: clean(body.category) || product.category,
        unit: clean(body.unit) || product.unit,
        minStock: Math.max(0, amount(body.minStock)),
      }).where(and(eq(departmentProducts.id, id), eq(departmentProducts.warehouseCode, ctx.warehouseCode)));
      return NextResponse.json({ ok: true });
    }

    if (action === "bulkImportProducts") {
      const items = Array.isArray(body.items) ? body.items as Array<Record<string, unknown>> : [];
      if (!items.length) return NextResponse.json({ error: "В файле нет строк для импорта" }, { status: 400 });
      let created = 0;
      let updated = 0;
      for (const item of items.slice(0, 5000)) {
        const name = clean(item.name);
        if (!name) continue;
        const sku = (clean(item.sku) || `1C-${crypto.randomUUID().slice(0, 8)}`).toUpperCase();
        const [existing] = await db.select().from(departmentProducts).where(and(eq(departmentProducts.warehouseCode, ctx.warehouseCode), eq(departmentProducts.sku, sku))).limit(1);
        const values = {
          name,
          sku,
          barcode: clean(item.barcode) || existing?.barcode || `${Date.now()}${Math.floor(Math.random() * 100000).toString().padStart(5, "0")}`,
          category: clean(item.category) || existing?.category || (ctx.warehouseCode === "paint" ? "Краска" : "Материалы"),
          unit: clean(item.unit) || existing?.unit || (ctx.warehouseCode === "paint" ? "кг" : "шт."),
          minStock: Math.max(0, amount(item.minStock ?? existing?.minStock ?? 0)),
          oneCId: clean(item.oneCId) || existing?.oneCId || null,
        };
        if (existing) {
          await db.update(departmentProducts).set(values).where(eq(departmentProducts.id, existing.id));
          updated += 1;
        } else {
          await db.insert(departmentProducts).values({ id: crypto.randomUUID(), warehouseCode: ctx.warehouseCode, ...values });
          created += 1;
        }
      }
      return NextResponse.json({ ok: true, created, updated });
    }

    if (action === "receive") {
      const productId = clean(body.productId);
      const cellId = clean(body.cellId);
      const quantity = amount(body.quantity);
      if (quantity <= 0) return NextResponse.json({ error: "Количество должно быть больше нуля" }, { status: 400 });
      const [product, cell] = await Promise.all([ownedProduct(db, ctx.warehouseCode, productId), ownedCell(db, ctx.warehouseCode, cellId)]);
      if (!product || !cell || cell.blocked) return NextResponse.json({ error: "Материал или доступная ячейка не найдены" }, { status: 404 });
      await setStock(db, ctx.warehouseCode, productId, cellId, await getStock(db, ctx.warehouseCode, productId, cellId) + quantity);
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
      const available = await getStock(db, ctx.warehouseCode, productId, cellId);
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
      const [product, fromCell, toCell] = await Promise.all([ownedProduct(db, ctx.warehouseCode, productId), ownedCell(db, ctx.warehouseCode, fromCellId), ownedCell(db, ctx.warehouseCode, toCellId)]);
      if (!product || !fromCell || !toCell || toCell.blocked) return NextResponse.json({ error: "Материал или доступная ячейка не найдены" }, { status: 404 });
      const available = await getStock(db, ctx.warehouseCode, productId, fromCellId);
      if (available < quantity) return NextResponse.json({ error: `Недостаточно на исходной ячейке. Доступно: ${available} ${product.unit}` }, { status: 409 });
      await setStock(db, ctx.warehouseCode, productId, fromCellId, available - quantity);
      await setStock(db, ctx.warehouseCode, productId, toCellId, await getStock(db, ctx.warehouseCode, productId, toCellId) + quantity);
      await db.insert(departmentMovements).values({ id: crypto.randomUUID(), warehouseCode: ctx.warehouseCode, type: "Перемещение", productId, fromCellId, toCellId, quantity, recipient: "", comment: clean(body.comment), operator: ctx.operator });
      return NextResponse.json({ ok: true });
    }

    if (action === "undoMovement") {
      const id = clean(body.id);
      const [movement] = await db.select().from(departmentMovements).where(and(eq(departmentMovements.id, id), eq(departmentMovements.warehouseCode, ctx.warehouseCode))).limit(1);
      if (!movement) return NextResponse.json({ error: "Операция не найдена" }, { status: 404 });
      const quantity = Number(movement.quantity);
      if (movement.type === "Приход" && movement.toCellId) {
        const current = await getStock(db, ctx.warehouseCode, movement.productId, movement.toCellId);
        if (current < quantity) return NextResponse.json({ error: "Нельзя отменить приход: часть материала уже перемещена или выдана" }, { status: 409 });
        await setStock(db, ctx.warehouseCode, movement.productId, movement.toCellId, current - quantity);
      } else if (movement.type === "Выдача" && movement.fromCellId) {
        await setStock(db, ctx.warehouseCode, movement.productId, movement.fromCellId, await getStock(db, ctx.warehouseCode, movement.productId, movement.fromCellId) + quantity);
      } else if (movement.type === "Перемещение" && movement.fromCellId && movement.toCellId) {
        const target = await getStock(db, ctx.warehouseCode, movement.productId, movement.toCellId);
        if (target < quantity) return NextResponse.json({ error: "Нельзя отменить перемещение: материал уже использован из новой ячейки" }, { status: 409 });
        await setStock(db, ctx.warehouseCode, movement.productId, movement.toCellId, target - quantity);
        await setStock(db, ctx.warehouseCode, movement.productId, movement.fromCellId, await getStock(db, ctx.warehouseCode, movement.productId, movement.fromCellId) + quantity);
      }
      await db.delete(departmentMovements).where(and(eq(departmentMovements.id, id), eq(departmentMovements.warehouseCode, ctx.warehouseCode)));
      return NextResponse.json({ ok: true });
    }

    if (action === "deleteProduct") {
      const id = clean(body.id);
      const product = await ownedProduct(db, ctx.warehouseCode, id);
      if (!product) return NextResponse.json({ error: "Материал не найден" }, { status: 404 });
      const stockRows = await db.select().from(departmentStocks).where(and(eq(departmentStocks.warehouseCode, ctx.warehouseCode), eq(departmentStocks.productId, id), sql`${departmentStocks.quantity} > 0`)).limit(1);
      if (stockRows.length) return NextResponse.json({ error: "Нельзя удалить материал с остатком" }, { status: 409 });
      await db.delete(departmentMovements).where(and(eq(departmentMovements.warehouseCode, ctx.warehouseCode), eq(departmentMovements.productId, id)));
      await db.delete(departmentProducts).where(and(eq(departmentProducts.id, id), eq(departmentProducts.warehouseCode, ctx.warehouseCode)));
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Неизвестная операция" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Операция не выполнена" }, { status: 500 });
  }
}
