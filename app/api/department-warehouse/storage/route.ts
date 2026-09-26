import { and, eq, sql } from "drizzle-orm";
import { doublePrecision, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { departmentCells, departmentMovements, departmentProducts, departmentRacks, departmentStocks } from "@/db/schema";
import { isWarehouseCode } from "@/lib/warehouse-auth";

export const dynamic = "force-dynamic";

const departmentCellDimensions = pgTable("department_cell_dimensions", {
  warehouseCode: text("warehouse_code").notNull(),
  cellId: text("cell_id").notNull(),
  width: doublePrecision("width").notNull().default(1),
  height: doublePrecision("height").notNull().default(1.1),
  depth: doublePrecision("depth").notNull().default(1.2),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [primaryKey({ columns: [table.warehouseCode, table.cellId] })]);

function context(request: NextRequest) {
  const code = request.headers.get("x-warehouse-code");
  if (!isWarehouseCode(code) || code === "hardware") return null;
  return { warehouseCode: code, operator: decodeURIComponent(request.headers.get("x-warehouse-user") || "Кладовщик") };
}

const numberValue = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
function columnLetters(index: number) {
  let value = Math.max(0, Math.trunc(index));
  let result = "";
  do {
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return result;
}

async function ensureDimensionsTable(db: Awaited<ReturnType<typeof getDb>>) {
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS department_cell_dimensions (
      warehouse_code text NOT NULL,
      cell_id text NOT NULL REFERENCES department_cells(id) ON DELETE CASCADE,
      width double precision NOT NULL DEFAULT 1,
      height double precision NOT NULL DEFAULT 1.1,
      depth double precision NOT NULL DEFAULT 1.2,
      updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (warehouse_code, cell_id)
    )
  `));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_department_cell_dimensions_warehouse ON department_cell_dimensions(warehouse_code)`));
}

async function upsertDimensions(db: Awaited<ReturnType<typeof getDb>>, warehouseCode: string, cellId: string, width: number, height: number, depth: number) {
  const now = new Date().toISOString();
  await db.insert(departmentCellDimensions).values({ warehouseCode, cellId, width, height, depth, updatedAt: now })
    .onConflictDoUpdate({
      target: [departmentCellDimensions.warehouseCode, departmentCellDimensions.cellId],
      set: { width, height, depth, updatedAt: now },
    });
}

export async function GET(request: NextRequest) {
  const ctx = context(request);
  if (!ctx) return NextResponse.json({ error: "Недоступное подразделение" }, { status: 403 });
  try {
    const db = await getDb();
    await ensureDimensionsTable(db);
    const dimensions = await db.select().from(departmentCellDimensions).where(eq(departmentCellDimensions.warehouseCode, ctx.warehouseCode));
    return NextResponse.json({ dimensions });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось загрузить размеры ячеек" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const ctx = context(request);
  if (!ctx) return NextResponse.json({ error: "Недоступное подразделение" }, { status: 403 });
  try {
    const db = await getDb();
    await ensureDimensionsTable(db);
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action || "");

    if (action === "updateCellDimensions") {
      const cellId = String(body.cellId || "");
      const scope = String(body.scope || "cell");
      const width = clamp(numberValue(body.width, 1), .2, 8);
      const height = clamp(numberValue(body.height, 1.1), .2, 6);
      const depth = clamp(numberValue(body.depth, 1.2), .2, 6);
      const cell = (await db.select().from(departmentCells).where(and(eq(departmentCells.id, cellId), eq(departmentCells.warehouseCode, ctx.warehouseCode))).limit(1))[0];
      if (!cell) return NextResponse.json({ error: "Ячейка не найдена" }, { status: 404 });
      const rack = (await db.select().from(departmentRacks).where(and(eq(departmentRacks.id, cell.rackId), eq(departmentRacks.warehouseCode, ctx.warehouseCode))).limit(1))[0];
      if (!rack || rack.storageType === "floor") return NextResponse.json({ error: "Конструктор размеров доступен для стеллажей" }, { status: 400 });

      let targets = [cell];
      if (scope === "row") targets = await db.select().from(departmentCells).where(and(eq(departmentCells.warehouseCode, ctx.warehouseCode), eq(departmentCells.rackId, cell.rackId), eq(departmentCells.rowIndex, cell.rowIndex)));
      else if (scope === "rack") targets = await db.select().from(departmentCells).where(and(eq(departmentCells.warehouseCode, ctx.warehouseCode), eq(departmentCells.rackId, cell.rackId)));
      for (const target of targets) await upsertDimensions(db, ctx.warehouseCode, target.id, width, height, depth);
      return NextResponse.json({ ok: true, updated: targets.length });
    }

    if (action === "saveVisualLayout") {
      const rackId = String(body.rackId || "");
      const rack = (await db.select().from(departmentRacks).where(and(eq(departmentRacks.id, rackId), eq(departmentRacks.warehouseCode, ctx.warehouseCode))).limit(1))[0];
      if (!rack || rack.storageType === "floor") return NextResponse.json({ error: "Стеллаж не найден" }, { status: 404 });
      const changes = Array.isArray(body.cells) ? body.cells as Array<Record<string, unknown>> : [];
      if (!changes.length) return NextResponse.json({ error: "Нет ячеек для сохранения" }, { status: 400 });
      const owned = await db.select().from(departmentCells).where(and(eq(departmentCells.warehouseCode, ctx.warehouseCode), eq(departmentCells.rackId, rack.id)));
      const ownedById = new Map(owned.map((c) => [c.id, c]));
      const rows = new Map<number, Array<{ id: string; width: number; height: number; depth: number }>>();
      for (const item of changes) {
        const cellId = String(item.id || "");
        const cell = ownedById.get(cellId);
        if (!cell) continue;
        const row = rows.get(cell.rowIndex) || [];
        row.push({
          id: cellId,
          width: clamp(numberValue(item.width, 1), .2, 8),
          height: clamp(numberValue(item.height, 1.1), .2, 6),
          depth: clamp(numberValue(item.depth, rack.depth), .2, 6),
        });
        rows.set(cell.rowIndex, row);
      }

      const targetWidth = Math.max(.4, Number(rack.width || 4));
      let updated = 0;
      for (const row of rows.values()) {
        const requestedTotal = row.reduce((sum, item) => sum + item.width, 0);
        const scale = requestedTotal > 0 ? targetWidth / requestedTotal : 1;
        for (const item of row) {
          await upsertDimensions(db, ctx.warehouseCode, item.id, clamp(item.width * scale, .2, 8), item.height, item.depth);
          updated += 1;
        }
      }
      return NextResponse.json({ ok: true, updated });
    }

    if (action === "addVisualCell") {
      const rackId = String(body.rackId || "");
      const rowIndex = Math.max(0, Math.trunc(numberValue(body.rowIndex, 0)));
      const rack = (await db.select().from(departmentRacks).where(and(eq(departmentRacks.id, rackId), eq(departmentRacks.warehouseCode, ctx.warehouseCode))).limit(1))[0];
      if (!rack || rack.storageType === "floor") return NextResponse.json({ error: "Стеллаж не найден" }, { status: 404 });
      const rowCells = (await db.select().from(departmentCells).where(and(eq(departmentCells.warehouseCode, ctx.warehouseCode), eq(departmentCells.rackId, rack.id), eq(departmentCells.rowIndex, rowIndex)))).sort((a, b) => a.columnIndex - b.columnIndex);
      if (!rowCells.length) return NextResponse.json({ error: "Полка не найдена" }, { status: 404 });
      const dimensions = await db.select().from(departmentCellDimensions).where(eq(departmentCellDimensions.warehouseCode, ctx.warehouseCode));
      const dimMap = new Map(dimensions.map((d) => [d.cellId, d]));
      const widths = rowCells.map((c) => Number(dimMap.get(c.id)?.width || Math.max(.4, rack.width / Math.max(1, rowCells.length))));
      const currentTotal = widths.reduce((s, v) => s + v, 0);
      const targetWidth = Math.max(.4, Number(rack.width || currentTotal || 4));
      const proposed = targetWidth / (rowCells.length + 1);
      const remainingWidth = Math.max(.2 * rowCells.length, targetWidth - proposed);
      const scale = currentTotal > 0 ? remainingWidth / currentTotal : 1;
      for (let i = 0; i < rowCells.length; i += 1) {
        const current = dimMap.get(rowCells[i].id);
        await upsertDimensions(db, ctx.warehouseCode, rowCells[i].id, clamp(widths[i] * scale, .2, 8), Number(current?.height || 1.1), Number(current?.depth || rack.depth));
      }
      const maxColumn = Math.max(...rowCells.map((c) => c.columnIndex));
      const columnIndex = maxColumn + 1;
      const code = `${rack.code}${rowIndex + 1}${columnLetters(columnIndex)}`;
      const duplicate = (await db.select({ id: departmentCells.id }).from(departmentCells).where(and(eq(departmentCells.warehouseCode, ctx.warehouseCode), eq(departmentCells.code, code))).limit(1))[0];
      if (duplicate) return NextResponse.json({ error: `Ячейка ${code} уже существует` }, { status: 409 });
      const id = crypto.randomUUID();
      await db.insert(departmentCells).values({ id, warehouseCode: ctx.warehouseCode, rackId: rack.id, code, label: code, rowIndex, columnIndex, blocked: false });
      const base = dimMap.get(rowCells[0].id);
      await upsertDimensions(db, ctx.warehouseCode, id, clamp(proposed, .2, 8), Number(base?.height || 1.1), Number(base?.depth || rack.depth));
      await db.update(departmentRacks).set({ columns: Math.max(rack.columns, rowCells.length + 1) }).where(eq(departmentRacks.id, rack.id));
      return NextResponse.json({ ok: true, id, code });
    }

    if (action === "deleteVisualCell") {
      const cellId = String(body.cellId || "");
      const cell = (await db.select().from(departmentCells).where(and(eq(departmentCells.id, cellId), eq(departmentCells.warehouseCode, ctx.warehouseCode))).limit(1))[0];
      if (!cell) return NextResponse.json({ error: "Ячейка не найдена" }, { status: 404 });
      const stock = (await db.select().from(departmentStocks).where(and(eq(departmentStocks.warehouseCode, ctx.warehouseCode), eq(departmentStocks.cellId, cell.id), sql`${departmentStocks.quantity} > 0`)).limit(1))[0];
      if (stock) return NextResponse.json({ error: "В ячейке есть товар. Сначала переместите остаток." }, { status: 409 });
      const rowCells = (await db.select().from(departmentCells).where(and(eq(departmentCells.warehouseCode, ctx.warehouseCode), eq(departmentCells.rackId, cell.rackId), eq(departmentCells.rowIndex, cell.rowIndex)))).sort((a, b) => a.columnIndex - b.columnIndex);
      if (rowCells.length <= 1) return NextResponse.json({ error: "На полке должна остаться хотя бы одна ячейка" }, { status: 409 });
      const movement = (await db.select({ id: departmentMovements.id }).from(departmentMovements).where(and(eq(departmentMovements.warehouseCode, ctx.warehouseCode), sql`(${departmentMovements.fromCellId} = ${cell.id} OR ${departmentMovements.toCellId} = ${cell.id})`)).limit(1))[0];
      if (movement) return NextResponse.json({ error: "У этой ячейки есть история движений. Её нельзя удалить, чтобы не потерять историю." }, { status: 409 });

      const rack = (await db.select().from(departmentRacks).where(and(eq(departmentRacks.id, cell.rackId), eq(departmentRacks.warehouseCode, ctx.warehouseCode))).limit(1))[0];
      const dimensions = await db.select().from(departmentCellDimensions).where(eq(departmentCellDimensions.warehouseCode, ctx.warehouseCode));
      const dimMap = new Map(dimensions.map((d) => [d.cellId, d]));
      const remaining = rowCells.filter((rowCell) => rowCell.id !== cell.id);
      const remainingWidths = remaining.map((rowCell) => Number(dimMap.get(rowCell.id)?.width || Math.max(.4, Number(rack?.width || 4) / Math.max(1, rowCells.length))));
      const remainingTotal = remainingWidths.reduce((sum, width) => sum + width, 0);
      const targetWidth = Math.max(.4, Number(rack?.width || remainingTotal || 4));
      const scale = remainingTotal > 0 ? targetWidth / remainingTotal : 1;

      await db.delete(departmentCellDimensions).where(and(eq(departmentCellDimensions.warehouseCode, ctx.warehouseCode), eq(departmentCellDimensions.cellId, cell.id)));
      await db.delete(departmentCells).where(eq(departmentCells.id, cell.id));
      for (let i = 0; i < remaining.length; i += 1) {
        const current = dimMap.get(remaining[i].id);
        await upsertDimensions(
          db,
          ctx.warehouseCode,
          remaining[i].id,
          clamp(remainingWidths[i] * scale, .2, 8),
          Number(current?.height || 1.1),
          Number(current?.depth || rack?.depth || 1.2),
        );
      }
      return NextResponse.json({ ok: true });
    }

    if (action === "deleteStorage") {
      const id = String(body.id || "");
      const force = Boolean(body.force);
      const rack = (await db.select().from(departmentRacks).where(and(eq(departmentRacks.id, id), eq(departmentRacks.warehouseCode, ctx.warehouseCode))).limit(1))[0];
      if (!rack) return NextResponse.json({ error: "Место хранения не найдено" }, { status: 404 });
      const cells = await db.select().from(departmentCells).where(and(eq(departmentCells.warehouseCode, ctx.warehouseCode), eq(departmentCells.rackId, rack.id)));
      const cellIds = new Set(cells.map((cell) => cell.id));
      const allStocks = await db.select().from(departmentStocks).where(eq(departmentStocks.warehouseCode, ctx.warehouseCode));
      const contents = allStocks.filter((stock) => cellIds.has(stock.cellId) && Number(stock.quantity) > 0);
      if (contents.length && !force) return NextResponse.json({ error: "В месте хранения есть остатки", hasStock: true, positions: contents.length, totalQuantity: contents.reduce((sum, row) => sum + Number(row.quantity), 0) }, { status: 409 });

      if (contents.length && force) {
        const productIds = [...new Set(contents.map((row) => row.productId))];
        const products = await db.select().from(departmentProducts).where(eq(departmentProducts.warehouseCode, ctx.warehouseCode));
        const productMap = new Map(products.filter((p) => productIds.includes(p.id)).map((p) => [p.id, p]));
        for (const stock of contents) {
          const product = productMap.get(stock.productId);
          await db.insert(departmentMovements).values({
            id: crypto.randomUUID(), warehouseCode: ctx.warehouseCode, type: "Списание при удалении места хранения", productId: stock.productId,
            fromCellId: stock.cellId, toCellId: null, quantity: Number(stock.quantity), recipient: "",
            comment: `Удалено вместе с ${rack.storageType === "floor" ? "напольной зоной" : "стеллажом"} ${rack.code}${product ? ` · ${product.name}` : ""}`,
            operator: ctx.operator, documentNumber: "", sourceName: "", sourceLocation: "", batchId: "",
          });
          await db.delete(departmentStocks).where(and(eq(departmentStocks.warehouseCode, ctx.warehouseCode), eq(departmentStocks.productId, stock.productId), eq(departmentStocks.cellId, stock.cellId)));
        }
      }
      await db.update(departmentRacks).set({ archived: true }).where(eq(departmentRacks.id, rack.id));
      return NextResponse.json({ ok: true, removedPositions: contents.length });
    }

    return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Операция не выполнена" }, { status: 500 });
  }
}
