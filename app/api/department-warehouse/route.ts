import { and, asc, desc, eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import {
  departmentCells,
  departmentInventorySnapshots,
  departmentMixLines,
  departmentMixes,
  departmentMovements,
  departmentProducts,
  departmentRacks,
  departmentStocks,
} from "@/db/schema";
import { isWarehouseCode, warehouseName } from "@/lib/warehouse-auth";

export const dynamic = "force-dynamic";
const clean = (value: unknown) => String(value ?? "").trim();
const amount = (value: unknown) => { const n = Number(value); return Number.isFinite(n) ? n : 0; };

function context(request: NextRequest) {
  const code = request.headers.get("x-warehouse-code");
  if (!isWarehouseCode(code) || code === "hardware") return null;
  return { warehouseCode: code, operator: decodeURIComponent(request.headers.get("x-warehouse-user") || "Кладовщик") };
}

async function ownedProduct(db: Awaited<ReturnType<typeof getDb>>, warehouseCode: string, id: string) {
  return (await db.select().from(departmentProducts).where(and(eq(departmentProducts.id, id), eq(departmentProducts.warehouseCode, warehouseCode))).limit(1))[0];
}
async function ownedCell(db: Awaited<ReturnType<typeof getDb>>, warehouseCode: string, id: string) {
  return (await db.select().from(departmentCells).where(and(eq(departmentCells.id, id), eq(departmentCells.warehouseCode, warehouseCode))).limit(1))[0];
}
async function ownedRack(db: Awaited<ReturnType<typeof getDb>>, warehouseCode: string, id: string) {
  return (await db.select().from(departmentRacks).where(and(eq(departmentRacks.id, id), eq(departmentRacks.warehouseCode, warehouseCode))).limit(1))[0];
}
async function getStock(db: Awaited<ReturnType<typeof getDb>>, warehouseCode: string, productId: string, cellId: string) {
  const row = (await db.select().from(departmentStocks).where(and(eq(departmentStocks.warehouseCode, warehouseCode), eq(departmentStocks.productId, productId), eq(departmentStocks.cellId, cellId))).limit(1))[0];
  return Number(row?.quantity || 0);
}
async function setStock(db: Awaited<ReturnType<typeof getDb>>, warehouseCode: string, productId: string, cellId: string, quantity: number) {
  const safe = Math.max(0, quantity);
  const existing = (await db.select().from(departmentStocks).where(and(eq(departmentStocks.warehouseCode, warehouseCode), eq(departmentStocks.productId, productId), eq(departmentStocks.cellId, cellId))).limit(1))[0];
  if (existing) {
    if (safe <= 0) await db.delete(departmentStocks).where(and(eq(departmentStocks.warehouseCode, warehouseCode), eq(departmentStocks.productId, productId), eq(departmentStocks.cellId, cellId)));
    else await db.update(departmentStocks).set({ quantity: safe, updatedAt: new Date().toISOString() }).where(and(eq(departmentStocks.warehouseCode, warehouseCode), eq(departmentStocks.productId, productId), eq(departmentStocks.cellId, cellId)));
  } else if (safe > 0) {
    await db.insert(departmentStocks).values({ warehouseCode, productId, cellId, quantity: safe, updatedAt: new Date().toISOString() });
  }
}
function autoBarcode() { return `${Date.now()}${Math.floor(Math.random() * 100000).toString().padStart(5, "0")}`; }

export async function GET(request: NextRequest) {
  const ctx = context(request);
  if (!ctx) return NextResponse.json({ error: "Недоступное подразделение" }, { status: 403 });
  try {
    const db = await getDb();
    const [racks, cells, products, stocks, movements, mixes, inventories] = await Promise.all([
      db.select().from(departmentRacks).where(and(eq(departmentRacks.warehouseCode, ctx.warehouseCode), eq(departmentRacks.archived, false))).orderBy(asc(departmentRacks.code)),
      db.select().from(departmentCells).where(eq(departmentCells.warehouseCode, ctx.warehouseCode)).orderBy(asc(departmentCells.code)),
      db.select().from(departmentProducts).where(and(eq(departmentProducts.warehouseCode, ctx.warehouseCode), eq(departmentProducts.archived, false))).orderBy(asc(departmentProducts.name)),
      db.select().from(departmentStocks).where(and(eq(departmentStocks.warehouseCode, ctx.warehouseCode), sql`${departmentStocks.quantity} > 0`)),
      db.select().from(departmentMovements).where(eq(departmentMovements.warehouseCode, ctx.warehouseCode)).orderBy(desc(departmentMovements.createdAt)).limit(700),
      db.select().from(departmentMixes).where(eq(departmentMixes.warehouseCode, ctx.warehouseCode)).orderBy(desc(departmentMixes.createdAt)).limit(100),
      db.select().from(departmentInventorySnapshots).where(eq(departmentInventorySnapshots.warehouseCode, ctx.warehouseCode)).orderBy(desc(departmentInventorySnapshots.createdAt)).limit(30),
    ]);
    const productById = new Map(products.map((x) => [x.id, x]));
    const cellById = new Map(cells.map((x) => [x.id, x]));
    const movementRows = movements.map((row) => ({ ...row, productName: productById.get(row.productId)?.name || "Материал", productSku: productById.get(row.productId)?.sku || "", productUnit: productById.get(row.productId)?.unit || "", fromCellCode: row.fromCellId ? cellById.get(row.fromCellId)?.code || "" : "", toCellCode: row.toCellId ? cellById.get(row.toCellId)?.code || "" : "" }));
    const mixRows = await Promise.all(mixes.map(async (mix) => {
      const lines = await db.select().from(departmentMixLines).where(eq(departmentMixLines.mixId, mix.id));
      return { ...mix, lines: lines.map((line) => ({ ...line, productName: productById.get(line.productId)?.name || "Материал", cellCode: cellById.get(line.cellId)?.code || "" })) };
    }));
    return NextResponse.json({ warehouse: { code: ctx.warehouseCode, name: warehouseName(ctx.warehouseCode) }, racks, cells, products, stocks, movements: movementRows, mixes: mixRows, inventories });
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

    if (action === "createRack" || action === "createFloorZone") {
      const name = clean(body.name);
      const code = clean(body.code).toUpperCase().replace(/[^A-ZА-Я0-9_-]/gi, "");
      const floor = action === "createFloorZone";
      const rows = floor ? 1 : Math.max(1, Math.min(12, Math.floor(amount(body.rows) || 4)));
      const columns = floor ? 1 : Math.max(1, Math.min(20, Math.floor(amount(body.columns) || 4)));
      if (!name || !code) return NextResponse.json({ error: "Укажите название и код места хранения" }, { status: 400 });
      const duplicate = (await db.select({ id: departmentRacks.id }).from(departmentRacks).where(and(eq(departmentRacks.warehouseCode, ctx.warehouseCode), eq(departmentRacks.code, code))).limit(1))[0];
      if (duplicate) return NextResponse.json({ error: "Такой код уже существует" }, { status: 409 });
      const rackId = crypto.randomUUID();
      await db.insert(departmentRacks).values({ id: rackId, warehouseCode: ctx.warehouseCode, name, code, rows, columns, storageType: floor ? "floor" : "rack", width: Math.max(0.5, amount(body.width) || (floor ? 2 : 4)), depth: Math.max(0.5, amount(body.depth) || (floor ? 2 : 1.2)), archived: false });
      const cellValues = Array.from({ length: rows * columns }, (_, index) => {
        const rowIndex = Math.floor(index / columns), columnIndex = index % columns;
        const cellCode = floor ? code : `${code}${rowIndex + 1}${String.fromCharCode(65 + columnIndex)}`;
        return { id: crypto.randomUUID(), warehouseCode: ctx.warehouseCode, rackId, code: cellCode, label: cellCode, rowIndex, columnIndex, blocked: false };
      });
      await db.insert(departmentCells).values(cellValues);
      return NextResponse.json({ ok: true, rackId });
    }

    if (action === "updateRack") {
      const rack = await ownedRack(db, ctx.warehouseCode, clean(body.id));
      if (!rack) return NextResponse.json({ error: "Место хранения не найдено" }, { status: 404 });
      await db.update(departmentRacks).set({ name: clean(body.name) || rack.name, width: Math.max(.5, amount(body.width) || rack.width), depth: Math.max(.5, amount(body.depth) || rack.depth), posX: amount(body.posX ?? rack.posX), posZ: amount(body.posZ ?? rack.posZ), rotation: amount(body.rotation ?? rack.rotation) }).where(eq(departmentRacks.id, rack.id));
      return NextResponse.json({ ok: true });
    }

    if (action === "deleteRack") {
      const rack = await ownedRack(db, ctx.warehouseCode, clean(body.id));
      if (!rack) return NextResponse.json({ error: "Место хранения не найдено" }, { status: 404 });
      const rackCells = await db.select({ id: departmentCells.id }).from(departmentCells).where(and(eq(departmentCells.warehouseCode, ctx.warehouseCode), eq(departmentCells.rackId, rack.id)));
      for (const c of rackCells) if (await getStock(db, ctx.warehouseCode, "", c.id)) return NextResponse.json({ error: "Сначала переместите остатки" }, { status: 409 });
      const stockRows = await db.select().from(departmentStocks).where(eq(departmentStocks.warehouseCode, ctx.warehouseCode));
      if (stockRows.some((s) => rackCells.some((c) => c.id === s.cellId) && Number(s.quantity) > 0)) return NextResponse.json({ error: "Сначала переместите остатки из этого места хранения" }, { status: 409 });
      await db.update(departmentRacks).set({ archived: true }).where(eq(departmentRacks.id, rack.id));
      return NextResponse.json({ ok: true });
    }

    if (action === "createProduct") {
      const name = clean(body.name);
      const sku = clean(body.sku).toUpperCase() || `PAINT-${Date.now().toString(36).toUpperCase()}`;
      if (!name) return NextResponse.json({ error: "Укажите название материала" }, { status: 400 });
      const duplicate = (await db.select({ id: departmentProducts.id }).from(departmentProducts).where(and(eq(departmentProducts.warehouseCode, ctx.warehouseCode), eq(departmentProducts.sku, sku))).limit(1))[0];
      if (duplicate) return NextResponse.json({ error: "Материал с таким артикулом уже существует" }, { status: 409 });
      const id = crypto.randomUUID();
      await db.insert(departmentProducts).values({ id, warehouseCode: ctx.warehouseCode, name, sku, barcode: clean(body.barcode) || autoBarcode(), category: clean(body.category) || "Краска", subcategory: clean(body.subcategory), brand: clean(body.brand), color: clean(body.color), ral: clean(body.ral), unit: clean(body.unit) || "кг", packType: clean(body.packType), packSize: Math.max(0, amount(body.packSize)), imageUrl: clean(body.imageUrl), minStock: Math.max(0, amount(body.minStock)), comment: clean(body.comment), oneCId: clean(body.oneCId) || null, createdBy: ctx.operator, source: clean(body.source) || "manual", archived: false });
      return NextResponse.json({ ok: true, id });
    }

    if (action === "updateProduct") {
      const product = await ownedProduct(db, ctx.warehouseCode, clean(body.id));
      if (!product) return NextResponse.json({ error: "Материал не найден" }, { status: 404 });
      const sku = clean(body.sku).toUpperCase() || product.sku;
      await db.update(departmentProducts).set({ name: clean(body.name) || product.name, sku, category: clean(body.category) || product.category, subcategory: clean(body.subcategory), brand: clean(body.brand), color: clean(body.color), ral: clean(body.ral), unit: clean(body.unit) || product.unit, packType: clean(body.packType), packSize: Math.max(0, amount(body.packSize)), imageUrl: clean(body.imageUrl), minStock: Math.max(0, amount(body.minStock)), comment: clean(body.comment) }).where(eq(departmentProducts.id, product.id));
      return NextResponse.json({ ok: true });
    }

    if (action === "deleteProduct" || action === "bulkDeleteProducts") {
      const ids = action === "deleteProduct" ? [clean(body.id)] : (Array.isArray(body.ids) ? body.ids.map(clean).filter(Boolean) : []);
      let deleted = 0, skipped = 0;
      for (const id of ids) {
        const product = await ownedProduct(db, ctx.warehouseCode, id);
        if (!product) continue;
        const stock = (await db.select().from(departmentStocks).where(and(eq(departmentStocks.warehouseCode, ctx.warehouseCode), eq(departmentStocks.productId, id), sql`${departmentStocks.quantity} > 0`)).limit(1))[0];
        const movement = (await db.select({ id: departmentMovements.id }).from(departmentMovements).where(and(eq(departmentMovements.warehouseCode, ctx.warehouseCode), eq(departmentMovements.productId, id))).limit(1))[0];
        if (stock || movement) { await db.update(departmentProducts).set({ archived: true }).where(eq(departmentProducts.id, id)); skipped += 1; }
        else { await db.delete(departmentProducts).where(eq(departmentProducts.id, id)); deleted += 1; }
      }
      return NextResponse.json({ ok: true, deleted, archived: skipped });
    }

    if (action === "bulkImportProducts") {
      const items = Array.isArray(body.items) ? body.items as Array<Record<string, unknown>> : [];
      if (!items.length) return NextResponse.json({ error: "В файле нет строк для импорта" }, { status: 400 });
      let created = 0, updated = 0;
      for (const item of items.slice(0, 5000)) {
        const name = clean(item.name); if (!name) continue;
        const oneCId = clean(item.oneCId);
        const sku = (clean(item.sku) || `1C-${crypto.randomUUID().slice(0, 8)}`).toUpperCase();
        const existing = (await db.select().from(departmentProducts).where(and(eq(departmentProducts.warehouseCode, ctx.warehouseCode), eq(departmentProducts.sku, sku))).limit(1))[0];
        const values = { name, sku, barcode: clean(item.barcode) || existing?.barcode || autoBarcode(), category: clean(item.category) || existing?.category || "Краска", subcategory: clean(item.subcategory) || existing?.subcategory || "", brand: clean(item.brand) || existing?.brand || "", color: clean(item.color) || existing?.color || "", ral: clean(item.ral) || existing?.ral || "", unit: clean(item.unit) || existing?.unit || "кг", packType: clean(item.packType) || existing?.packType || "", packSize: Math.max(0, amount(item.packSize ?? existing?.packSize ?? 0)), imageUrl: clean(item.imageUrl) || existing?.imageUrl || "", minStock: Math.max(0, amount(item.minStock ?? existing?.minStock ?? 0)), comment: clean(item.comment) || existing?.comment || "", oneCId: oneCId || existing?.oneCId || null, createdBy: existing?.createdBy || ctx.operator, source: "1c", archived: false };
        if (existing) { await db.update(departmentProducts).set(values).where(eq(departmentProducts.id, existing.id)); updated += 1; }
        else { await db.insert(departmentProducts).values({ id: crypto.randomUUID(), warehouseCode: ctx.warehouseCode, ...values }); created += 1; }
      }
      return NextResponse.json({ ok: true, created, updated });
    }

    if (action === "receive") {
      const productId = clean(body.productId), cellId = clean(body.cellId), quantity = amount(body.quantity);
      const [product, cell] = await Promise.all([ownedProduct(db, ctx.warehouseCode, productId), ownedCell(db, ctx.warehouseCode, cellId)]);
      if (!product || !cell || quantity <= 0) return NextResponse.json({ error: "Проверьте материал, место хранения и количество" }, { status: 400 });
      await setStock(db, ctx.warehouseCode, productId, cellId, await getStock(db, ctx.warehouseCode, productId, cellId) + quantity);
      await db.insert(departmentMovements).values({ id: crypto.randomUUID(), warehouseCode: ctx.warehouseCode, type: "Приход", productId, fromCellId: null, toCellId: cellId, quantity, recipient: "", comment: clean(body.comment), operator: ctx.operator, documentNumber: clean(body.documentNumber), sourceName: clean(body.sourceName), sourceLocation: clean(body.sourceLocation), batchId: "" });
      return NextResponse.json({ ok: true });
    }

    if (action === "transfer") {
      const productId = clean(body.productId), fromCellId = clean(body.fromCellId), toCellId = clean(body.toCellId), quantity = amount(body.quantity);
      if (!productId || !fromCellId || !toCellId || fromCellId === toCellId || quantity <= 0) return NextResponse.json({ error: "Проверьте товар, ячейки и количество" }, { status: 400 });
      const available = await getStock(db, ctx.warehouseCode, productId, fromCellId);
      if (available < quantity) return NextResponse.json({ error: `Недостаточно остатка: ${available}` }, { status: 409 });
      if (!(await ownedCell(db, ctx.warehouseCode, toCellId))) return NextResponse.json({ error: "Место назначения не найдено" }, { status: 404 });
      await setStock(db, ctx.warehouseCode, productId, fromCellId, available - quantity);
      await setStock(db, ctx.warehouseCode, productId, toCellId, await getStock(db, ctx.warehouseCode, productId, toCellId) + quantity);
      await db.insert(departmentMovements).values({ id: crypto.randomUUID(), warehouseCode: ctx.warehouseCode, type: "Перемещение", productId, fromCellId, toCellId, quantity, recipient: "", comment: clean(body.comment), operator: ctx.operator, documentNumber: "", sourceName: "", sourceLocation: "", batchId: "" });
      return NextResponse.json({ ok: true });
    }

    if (action === "issue") {
      const productId = clean(body.productId), cellId = clean(body.cellId), quantity = amount(body.quantity);
      const available = await getStock(db, ctx.warehouseCode, productId, cellId);
      if (quantity <= 0 || available < quantity) return NextResponse.json({ error: `Недостаточно остатка. Доступно: ${available}` }, { status: 409 });
      await setStock(db, ctx.warehouseCode, productId, cellId, available - quantity);
      await db.insert(departmentMovements).values({ id: crypto.randomUUID(), warehouseCode: ctx.warehouseCode, type: "Выдача", productId, fromCellId: cellId, toCellId: null, quantity, recipient: clean(body.recipient), comment: clean(body.comment), operator: ctx.operator, documentNumber: clean(body.documentNumber), sourceName: "", sourceLocation: "", batchId: "" });
      return NextResponse.json({ ok: true });
    }

    if (action === "issueMix") {
      const lines = Array.isArray(body.lines) ? body.lines as Array<Record<string, unknown>> : [];
      if (!lines.length) return NextResponse.json({ error: "Добавьте компоненты смеси" }, { status: 400 });
      const checked: Array<{ productId: string; cellId: string; quantity: number; unit: string }> = [];
      for (const line of lines) {
        const productId = clean(line.productId), cellId = clean(line.cellId), quantity = amount(line.quantity);
        const product = await ownedProduct(db, ctx.warehouseCode, productId);
        const available = await getStock(db, ctx.warehouseCode, productId, cellId);
        if (!product || quantity <= 0 || available < quantity) return NextResponse.json({ error: `Недостаточно ${product?.name || "материала"}: доступно ${available}` }, { status: 409 });
        checked.push({ productId, cellId, quantity, unit: clean(line.unit) || product.unit });
      }
      const mixId = crypto.randomUUID();
      await db.insert(departmentMixes).values({ id: mixId, warehouseCode: ctx.warehouseCode, name: clean(body.name) || "Смешанный продукт", recipient: clean(body.recipient), documentNumber: clean(body.documentNumber), resultQuantity: Math.max(0, amount(body.resultQuantity)), resultUnit: clean(body.resultUnit) || "кг", comment: clean(body.comment), operator: ctx.operator });
      for (const line of checked) {
        const available = await getStock(db, ctx.warehouseCode, line.productId, line.cellId);
        await setStock(db, ctx.warehouseCode, line.productId, line.cellId, available - line.quantity);
        await db.insert(departmentMixLines).values({ id: crypto.randomUUID(), mixId, productId: line.productId, cellId: line.cellId, quantity: line.quantity, unit: line.unit });
        await db.insert(departmentMovements).values({ id: crypto.randomUUID(), warehouseCode: ctx.warehouseCode, type: "Смешивание/Выдача", productId: line.productId, fromCellId: line.cellId, toCellId: null, quantity: line.quantity, recipient: clean(body.recipient), comment: clean(body.comment), operator: ctx.operator, documentNumber: clean(body.documentNumber), sourceName: "", sourceLocation: "", batchId: mixId });
      }
      return NextResponse.json({ ok: true, mixId });
    }

    if (action === "inventorySnapshot") {
      const products = await db.select().from(departmentProducts).where(and(eq(departmentProducts.warehouseCode, ctx.warehouseCode), eq(departmentProducts.archived, false)));
      const cells = await db.select().from(departmentCells).where(eq(departmentCells.warehouseCode, ctx.warehouseCode));
      const stocks = await db.select().from(departmentStocks).where(and(eq(departmentStocks.warehouseCode, ctx.warehouseCode), sql`${departmentStocks.quantity} > 0`));
      const productById = new Map(products.map((x) => [x.id, x])); const cellById = new Map(cells.map((x) => [x.id, x]));
      const snapshot = stocks.map((s) => ({ productId: s.productId, name: productById.get(s.productId)?.name || "", sku: productById.get(s.productId)?.sku || "", unit: productById.get(s.productId)?.unit || "", cellId: s.cellId, cellCode: cellById.get(s.cellId)?.code || "", quantity: Number(s.quantity) }));
      const id = crypto.randomUUID();
      await db.insert(departmentInventorySnapshots).values({ id, warehouseCode: ctx.warehouseCode, snapshotJson: JSON.stringify(snapshot), createdBy: ctx.operator });
      return NextResponse.json({ ok: true, id, rows: snapshot.length });
    }

    if (action === "undoMovement") {
      const id = clean(body.id);
      const movement = (await db.select().from(departmentMovements).where(and(eq(departmentMovements.id, id), eq(departmentMovements.warehouseCode, ctx.warehouseCode))).limit(1))[0];
      if (!movement) return NextResponse.json({ error: "Движение не найдено" }, { status: 404 });
      if (movement.batchId) return NextResponse.json({ error: "Смешивание отменяется целиком через отдельную операцию" }, { status: 409 });
      if (movement.type === "Приход" && movement.toCellId) {
        const now = await getStock(db, ctx.warehouseCode, movement.productId, movement.toCellId);
        if (now < movement.quantity) return NextResponse.json({ error: "Нельзя отменить: часть прихода уже использована" }, { status: 409 });
        await setStock(db, ctx.warehouseCode, movement.productId, movement.toCellId, now - movement.quantity);
      } else if (movement.type === "Выдача" && movement.fromCellId) {
        await setStock(db, ctx.warehouseCode, movement.productId, movement.fromCellId, await getStock(db, ctx.warehouseCode, movement.productId, movement.fromCellId) + movement.quantity);
      } else if (movement.type === "Перемещение" && movement.fromCellId && movement.toCellId) {
        const target = await getStock(db, ctx.warehouseCode, movement.productId, movement.toCellId);
        if (target < movement.quantity) return NextResponse.json({ error: "Нельзя отменить: товар уже перемещён дальше" }, { status: 409 });
        await setStock(db, ctx.warehouseCode, movement.productId, movement.toCellId, target - movement.quantity);
        await setStock(db, ctx.warehouseCode, movement.productId, movement.fromCellId, await getStock(db, ctx.warehouseCode, movement.productId, movement.fromCellId) + movement.quantity);
      }
      await db.delete(departmentMovements).where(eq(departmentMovements.id, id));
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Неизвестная операция" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Операция не выполнена" }, { status: 500 });
  }
}
