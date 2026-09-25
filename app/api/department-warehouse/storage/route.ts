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
  return {
    warehouseCode: code,
    operator: decodeURIComponent(request.headers.get("x-warehouse-user") || "Кладовщик"),
  };
}

const numberValue = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

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
      const width = Math.max(0.2, Math.min(8, numberValue(body.width, 1)));
      const height = Math.max(0.2, Math.min(6, numberValue(body.height, 1.1)));
      const depth = Math.max(0.2, Math.min(6, numberValue(body.depth, 1.2)));
      const cell = (await db.select().from(departmentCells).where(and(eq(departmentCells.id, cellId), eq(departmentCells.warehouseCode, ctx.warehouseCode))).limit(1))[0];
      if (!cell) return NextResponse.json({ error: "Ячейка не найдена" }, { status: 404 });
      const rack = (await db.select().from(departmentRacks).where(and(eq(departmentRacks.id, cell.rackId), eq(departmentRacks.warehouseCode, ctx.warehouseCode))).limit(1))[0];
      if (!rack || rack.storageType === "floor") return NextResponse.json({ error: "Конструктор размеров доступен для стеллажей" }, { status: 400 });

      let targets = [cell];
      if (scope === "row") {
        targets = await db.select().from(departmentCells).where(and(
          eq(departmentCells.warehouseCode, ctx.warehouseCode),
          eq(departmentCells.rackId, cell.rackId),
          eq(departmentCells.rowIndex, cell.rowIndex),
        ));
      } else if (scope === "rack") {
        targets = await db.select().from(departmentCells).where(and(eq(departmentCells.warehouseCode, ctx.warehouseCode), eq(departmentCells.rackId, cell.rackId)));
      }

      const now = new Date().toISOString();
      for (const target of targets) {
        await db.insert(departmentCellDimensions).values({ warehouseCode: ctx.warehouseCode, cellId: target.id, width, height, depth, updatedAt: now })
          .onConflictDoUpdate({
            target: [departmentCellDimensions.warehouseCode, departmentCellDimensions.cellId],
            set: { width, height, depth, updatedAt: now },
          });
      }
      return NextResponse.json({ ok: true, updated: targets.length });
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

      if (contents.length && !force) {
        const totalQuantity = contents.reduce((sum, row) => sum + Number(row.quantity), 0);
        return NextResponse.json({
          error: "В месте хранения есть остатки",
          hasStock: true,
          positions: contents.length,
          totalQuantity,
        }, { status: 409 });
      }

      if (contents.length && force) {
        const productIds = [...new Set(contents.map((row) => row.productId))];
        const products = await db.select().from(departmentProducts).where(eq(departmentProducts.warehouseCode, ctx.warehouseCode));
        const productMap = new Map(products.filter((p) => productIds.includes(p.id)).map((p) => [p.id, p]));
        for (const stock of contents) {
          const product = productMap.get(stock.productId);
          await db.insert(departmentMovements).values({
            id: crypto.randomUUID(),
            warehouseCode: ctx.warehouseCode,
            type: "Списание при удалении места хранения",
            productId: stock.productId,
            fromCellId: stock.cellId,
            toCellId: null,
            quantity: Number(stock.quantity),
            recipient: "",
            comment: `Удалено вместе с ${rack.storageType === "floor" ? "напольной зоной" : "стеллажом"} ${rack.code}${product ? ` · ${product.name}` : ""}`,
            operator: ctx.operator,
            documentNumber: "",
            sourceName: "",
            sourceLocation: "",
            batchId: "",
          });
          await db.delete(departmentStocks).where(and(
            eq(departmentStocks.warehouseCode, ctx.warehouseCode),
            eq(departmentStocks.productId, stock.productId),
            eq(departmentStocks.cellId, stock.cellId),
          ));
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
