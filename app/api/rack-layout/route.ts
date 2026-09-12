import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { activityLogs } from "@/db/schema";

export const dynamic = "force-dynamic";

const clean = (value: unknown) => String(value ?? "").trim();
const num = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows as T[];
  }
  return [];
}

async function ensureSideColumn(db: Awaited<ReturnType<typeof getDb>>) {
  await db.execute(sql`ALTER TABLE cells ADD COLUMN IF NOT EXISTS side text NOT NULL DEFAULT 'front'`);
  await db.execute(sql`UPDATE cells SET side = 'front' WHERE side IS NULL OR side = ''`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_cells_rack_side_position ON cells(rack_id, side, row_index, column_index)`);
}

export async function GET() {
  try {
    const db = await getDb();
    await ensureSideColumn(db);

    const [racksResult, cellsResult, stocksResult, productsResult, movementsResult] = await Promise.all([
      db.execute(sql`
        SELECT id, name, code, rows, columns
        FROM racks
        WHERE archived = false
        ORDER BY code
      `),
      db.execute(sql`
        SELECT c.id, c.rack_id AS "rackId", c.code, c.label,
               c.row_index AS "rowIndex", c.column_index AS "columnIndex",
               c.blocked, c.side
        FROM cells c
        JOIN racks r ON r.id = c.rack_id
        WHERE r.archived = false
        ORDER BY r.code, c.side, c.row_index, c.column_index
      `),
      db.execute(sql`
        SELECT s.product_id AS "productId", s.cell_id AS "cellId",
               s.quantity::double precision AS quantity,
               p.name AS "productName", p.sku, p.barcode, p.unit
        FROM stocks s
        JOIN products p ON p.id = s.product_id
        WHERE s.quantity > 0
        ORDER BY p.name
      `),
      db.execute(sql`
        SELECT id, name, sku, barcode, unit
        FROM products
        ORDER BY name
      `),
      db.execute(sql`
        SELECT m.id, m.cell_id AS "cellId", m.product_id AS "productId",
               m.type, m.quantity::double precision AS quantity, m.operator,
               m.comment, m.created_at AS "createdAt", p.name AS "productName", p.unit
        FROM movements m
        JOIN products p ON p.id = m.product_id
        ORDER BY m.created_at DESC
        LIMIT 300
      `),
    ]);

    return Response.json({
      racks: rowsOf(racksResult),
      cells: rowsOf(cellsResult),
      stocks: rowsOf(stocksResult),
      products: rowsOf(productsResult),
      movements: rowsOf(movementsResult),
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось загрузить стеллажи" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = clean(body.action);
    const operator = clean(body.operator) || "Кладовщик";

    const db = await getDb();
    await ensureSideColumn(db);

    const writeActivity = async (entry: { action: string; entityType: string; entityId: string; entityName: string; details: string }) => {
      await db.insert(activityLogs).values({ id: crypto.randomUUID(), operator, ...entry });
    };

    if (action === "addStock") {
      const cellId = clean(body.cellId);
      const productId = clean(body.productId);
      const quantity = num(body.quantity);
      if (!cellId || !productId || quantity <= 0) return Response.json({ error: "Выберите материал и укажите количество" }, { status: 400 });

      const [cellResult, productResult] = await Promise.all([
        db.execute(sql`SELECT id, code, blocked FROM cells WHERE id = ${cellId} LIMIT 1`),
        db.execute(sql`SELECT id, name, unit FROM products WHERE id = ${productId} LIMIT 1`),
      ]);
      const cell = rowsOf<{ id: string; code: string; blocked: boolean }>(cellResult)[0];
      const product = rowsOf<{ id: string; name: string; unit: string }>(productResult)[0];
      if (!cell || cell.blocked) return Response.json({ error: "Ячейка недоступна" }, { status: 409 });
      if (!product) return Response.json({ error: "Материал не найден" }, { status: 404 });

      await db.execute(sql`
        INSERT INTO stocks (product_id, cell_id, quantity, updated_at)
        VALUES (${productId}, ${cellId}, ${quantity}, CURRENT_TIMESTAMP)
        ON CONFLICT (product_id, cell_id)
        DO UPDATE SET quantity = stocks.quantity + EXCLUDED.quantity, updated_at = CURRENT_TIMESTAMP
      `);
      await db.execute(sql`
        INSERT INTO movements (id, type, product_id, cell_id, quantity, operator, source, comment, created_at)
        VALUES (${crypto.randomUUID()}, 'Оприходование', ${productId}, ${cellId}, ${quantity}, ${operator}, 'rack-cell', 'Добавлено из карточки ячейки', CURRENT_TIMESTAMP)
      `);
      await writeActivity({ action: "Оприходование", entityType: "Ячейка", entityId: cellId, entityName: cell.code, details: `${product.name}: +${quantity} ${product.unit}` });
      return Response.json({ ok: true });
    }

    if (action === "moveStock") {
      const productId = clean(body.productId);
      const fromCellId = clean(body.fromCellId);
      const toCellId = clean(body.toCellId);
      const quantity = num(body.quantity);
      if (!productId || !fromCellId || !toCellId || quantity <= 0) return Response.json({ error: "Укажите материал, новую ячейку и количество" }, { status: 400 });
      if (fromCellId === toCellId) return Response.json({ error: "Новая ячейка должна отличаться от текущей" }, { status: 400 });

      const [sourceResult, targetResult, productResult] = await Promise.all([
        db.execute(sql`SELECT quantity::double precision AS quantity FROM stocks WHERE product_id = ${productId} AND cell_id = ${fromCellId} LIMIT 1`),
        db.execute(sql`SELECT id, code, blocked FROM cells WHERE id = ${toCellId} LIMIT 1`),
        db.execute(sql`SELECT id, name, unit FROM products WHERE id = ${productId} LIMIT 1`),
      ]);
      const source = rowsOf<{ quantity: number }>(sourceResult)[0];
      const target = rowsOf<{ id: string; code: string; blocked: boolean }>(targetResult)[0];
      const product = rowsOf<{ id: string; name: string; unit: string }>(productResult)[0];
      if (!source || source.quantity < quantity) return Response.json({ error: `В исходной ячейке доступно ${source?.quantity || 0}` }, { status: 409 });
      if (!target || target.blocked) return Response.json({ error: "Новая ячейка недоступна" }, { status: 409 });
      if (!product) return Response.json({ error: "Материал не найден" }, { status: 404 });

      await db.execute(sql`UPDATE stocks SET quantity = quantity - ${quantity}, updated_at = CURRENT_TIMESTAMP WHERE product_id = ${productId} AND cell_id = ${fromCellId}`);
      await db.execute(sql`DELETE FROM stocks WHERE product_id = ${productId} AND cell_id = ${fromCellId} AND quantity <= 0`);
      await db.execute(sql`
        INSERT INTO stocks (product_id, cell_id, quantity, updated_at)
        VALUES (${productId}, ${toCellId}, ${quantity}, CURRENT_TIMESTAMP)
        ON CONFLICT (product_id, cell_id)
        DO UPDATE SET quantity = stocks.quantity + EXCLUDED.quantity, updated_at = CURRENT_TIMESTAMP
      `);
      await db.execute(sql`
        INSERT INTO movements (id, type, product_id, cell_id, quantity, operator, source, comment, created_at)
        VALUES (${crypto.randomUUID()}, 'Перемещение', ${productId}, ${fromCellId}, ${-quantity}, ${operator}, 'rack-cell', ${`Перемещение → ${target.code}`}, CURRENT_TIMESTAMP)
      `);
      await db.execute(sql`
        INSERT INTO movements (id, type, product_id, cell_id, quantity, operator, source, comment, created_at)
        VALUES (${crypto.randomUUID()}, 'Перемещение', ${productId}, ${toCellId}, ${quantity}, ${operator}, 'rack-cell', 'Перемещение из другой ячейки', CURRENT_TIMESTAMP)
      `);
      await writeActivity({ action: "Перемещение", entityType: "Материал", entityId: productId, entityName: product.name, details: `${quantity} ${product.unit} → ${target.code}` });
      return Response.json({ ok: true });
    }

    if (action === "correctStock") {
      const productId = clean(body.productId);
      const cellId = clean(body.cellId);
      const newQuantity = num(body.newQuantity, -1);
      const reason = clean(body.reason);
      if (!productId || !cellId || newQuantity < 0 || !reason) return Response.json({ error: "Укажите новое количество и причину корректировки" }, { status: 400 });

      const [stockResult, cellResult, productResult] = await Promise.all([
        db.execute(sql`SELECT quantity::double precision AS quantity FROM stocks WHERE product_id = ${productId} AND cell_id = ${cellId} LIMIT 1`),
        db.execute(sql`SELECT id, code FROM cells WHERE id = ${cellId} LIMIT 1`),
        db.execute(sql`SELECT id, name, unit FROM products WHERE id = ${productId} LIMIT 1`),
      ]);
      const oldQuantity = Number(rowsOf<{ quantity: number }>(stockResult)[0]?.quantity || 0);
      const cell = rowsOf<{ id: string; code: string }>(cellResult)[0];
      const product = rowsOf<{ id: string; name: string; unit: string }>(productResult)[0];
      if (!cell || !product) return Response.json({ error: "Материал или ячейка не найдены" }, { status: 404 });
      const delta = newQuantity - oldQuantity;
      if (Math.abs(delta) < 0.000001) return Response.json({ ok: true, unchanged: true });

      if (newQuantity === 0) {
        await db.execute(sql`DELETE FROM stocks WHERE product_id = ${productId} AND cell_id = ${cellId}`);
      } else {
        await db.execute(sql`
          INSERT INTO stocks (product_id, cell_id, quantity, updated_at)
          VALUES (${productId}, ${cellId}, ${newQuantity}, CURRENT_TIMESTAMP)
          ON CONFLICT (product_id, cell_id)
          DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = CURRENT_TIMESTAMP
        `);
      }
      await db.execute(sql`
        INSERT INTO movements (id, type, product_id, cell_id, quantity, operator, source, comment, created_at)
        VALUES (${crypto.randomUUID()}, 'Корректировка', ${productId}, ${cellId}, ${delta}, ${operator}, 'rack-cell', ${reason}, CURRENT_TIMESTAMP)
      `);
      await writeActivity({ action: "Корректировка", entityType: "Ячейка", entityId: cellId, entityName: cell.code, details: `${product.name}: ${oldQuantity} → ${newQuantity} ${product.unit}. Причина: ${reason}` });
      return Response.json({ ok: true });
    }

    if (action === "createRack") {
      const name = clean(body.name);
      const code = clean(body.code).toUpperCase();
      const rowCount = Math.min(12, Math.max(1, Math.floor(num(body.rows, 4))));
      const columnCount = Math.min(12, Math.max(1, Math.floor(num(body.columns, 4))));
      const twoSided = Boolean(body.twoSided);
      if (!name || !code) return Response.json({ error: "Укажите название и код стеллажа" }, { status: 400 });

      const duplicateResult = await db.execute(sql`SELECT id FROM racks WHERE code = ${code} LIMIT 1`);
      if (rowsOf(duplicateResult).length) return Response.json({ error: "Такой код стеллажа уже используется" }, { status: 409 });

      const newRackId = crypto.randomUUID();
      await db.execute(sql`
        INSERT INTO racks (id, name, code, rows, columns, archived, created_at)
        VALUES (${newRackId}, ${name}, ${code}, ${rowCount}, ${columnCount}, false, CURRENT_TIMESTAMP)
      `);

      const createCells = async (cellSide: "front" | "back") => {
        for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
          for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
            const letter = String.fromCharCode(65 + columnIndex);
            const cellCode = cellSide === "front" ? `${code}${rowIndex + 1}${letter}` : `${code}-B-${rowIndex + 1}${letter}`;
            await db.execute(sql`
              INSERT INTO cells (id, rack_id, code, label, row_index, column_index, blocked, side)
              VALUES (${crypto.randomUUID()}, ${newRackId}, ${cellCode}, ${cellCode}, ${rowIndex}, ${columnIndex}, false, ${cellSide})
            `);
          }
        }
      };

      await createCells("front");
      if (twoSided) await createCells("back");

      await writeActivity({
        action: "Создание",
        entityType: "Стеллаж",
        entityId: newRackId,
        entityName: `${name} (${code})`,
        details: `${rowCount} полок × ${columnCount} ячеек, ${twoSided ? "двухсторонний" : "односторонний"}`,
      });
      return Response.json({ ok: true, rackId: newRackId });
    }

    const rackId = clean(body.rackId);
    if (!rackId) return Response.json({ error: "Стеллаж не выбран" }, { status: 400 });

    const rackResult = await db.execute(sql`
      SELECT id, name, code, rows, columns
      FROM racks
      WHERE id = ${rackId} AND archived = false
      LIMIT 1
    `);
    const rack = rowsOf<{ id: string; name: string; code: string; rows: number; columns: number }>(rackResult)[0];
    if (!rack) return Response.json({ error: "Стеллаж не найден" }, { status: 404 });

    const makeCells = async (side: "front" | "back", rowCount: number, columnCount: number, code: string) => {
      for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
        for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
          const letter = String.fromCharCode(65 + columnIndex);
          const cellCode = side === "front" ? `${code}${rowIndex + 1}${letter}` : `${code}-B-${rowIndex + 1}${letter}`;
          await db.execute(sql`
            INSERT INTO cells (id, rack_id, code, label, row_index, column_index, blocked, side)
            VALUES (${crypto.randomUUID()}, ${rackId}, ${cellCode}, ${cellCode}, ${rowIndex}, ${columnIndex}, false, ${side})
          `);
        }
      }
    };

    if (action === "enableBackSide") {
      const existsResult = await db.execute(sql`SELECT COUNT(*)::int AS count FROM cells WHERE rack_id = ${rackId} AND side = 'back'`);
      const exists = Number(rowsOf<{ count: number }>(existsResult)[0]?.count || 0);
      if (exists > 0) return Response.json({ ok: true, alreadyExists: true });
      await makeCells("back", rack.rows, rack.columns, rack.code);
      await writeActivity({ action: "Добавлена задняя сторона", entityType: "Стеллаж", entityId: rack.id, entityName: `${rack.name} (${rack.code})`, details: `${rack.rows} полок × ${rack.columns} ячеек на задней стороне` });
      return Response.json({ ok: true });
    }

    if (action === "deleteRack") {
      const stockResult = await db.execute(sql`
        SELECT s.product_id AS "productId", s.cell_id AS "cellId",
               s.quantity::double precision AS quantity,
               p.name AS "productName", p.unit, c.code AS "cellCode"
        FROM stocks s
        JOIN cells c ON c.id = s.cell_id
        JOIN products p ON p.id = s.product_id
        WHERE c.rack_id = ${rackId} AND s.quantity > 0
        ORDER BY c.code, p.name
      `);
      const rackStocks = rowsOf<{ productId: string; cellId: string; quantity: number; productName: string; unit: string; cellCode: string }>(stockResult);
      const force = body.force === true;

      if (rackStocks.length && !force) {
        return Response.json({
          error: "В стеллаже есть материал",
          hasStock: true,
          positions: rackStocks.length,
          totalQuantity: rackStocks.reduce((sum, row) => sum + Number(row.quantity || 0), 0),
        }, { status: 409 });
      }

      if (rackStocks.length && force) {
        const role = clean(request.headers.get("x-warehouse-role"));
        if (role !== "admin") {
          return Response.json({ error: "Удаление стеллажа вместе с остатками доступно только администратору" }, { status: 403 });
        }

        for (const stock of rackStocks) {
          await db.execute(sql`
            INSERT INTO movements (id, type, product_id, cell_id, quantity, operator, source, comment, created_at)
            VALUES (${crypto.randomUUID()}, 'Списание при удалении стеллажа', ${stock.productId}, ${stock.cellId}, ${-Number(stock.quantity)}, ${operator}, 'rack-delete', ${`Удалён стеллаж ${rack.code}`}, CURRENT_TIMESTAMP)
          `);
        }
        await db.execute(sql`
          DELETE FROM stocks
          WHERE cell_id IN (SELECT id FROM cells WHERE rack_id = ${rackId})
        `);
      }

      await db.execute(sql`UPDATE racks SET archived = true WHERE id = ${rackId}`);
      await writeActivity({
        action: force && rackStocks.length ? "Удаление с остатками" : "Удаление",
        entityType: "Стеллаж",
        entityId: rack.id,
        entityName: `${rack.name} (${rack.code})`,
        details: rackStocks.length
          ? `Удалён вместе с содержимым: ${rackStocks.length} позиций. Все остатки списаны отдельными движениями.`
          : "Стеллаж удалён из рабочего списка",
      });
      return Response.json({ ok: true, removedPositions: force ? rackStocks.length : 0 });
    }

    if (action === "updateRack") {
      const name = clean(body.name);
      const code = clean(body.code).toUpperCase();
      const rowCount = Math.min(12, Math.max(1, Math.floor(num(body.rows, rack.rows))));
      const columnCount = Math.min(12, Math.max(1, Math.floor(num(body.columns, rack.columns))));
      const twoSided = Boolean(body.twoSided);
      if (!name || !code) return Response.json({ error: "Укажите название и код" }, { status: 400 });
      const duplicateResult = await db.execute(sql`SELECT id FROM racks WHERE code = ${code} AND id <> ${rackId} LIMIT 1`);
      if (rowsOf(duplicateResult).length) return Response.json({ error: "Такой код уже используется" }, { status: 409 });

      const stockResult = await db.execute(sql`SELECT COUNT(*)::int AS count FROM stocks s JOIN cells c ON c.id = s.cell_id WHERE c.rack_id = ${rackId} AND s.quantity > 0`);
      const hasStock = Number(rowsOf<{ count: number }>(stockResult)[0]?.count || 0) > 0;
      const layoutChanged = rowCount !== rack.rows || columnCount !== rack.columns;
      if (layoutChanged && hasStock) return Response.json({ error: "Нельзя менять размеры стеллажа, пока в нём есть материал" }, { status: 409 });

      const backStockResult = await db.execute(sql`SELECT COUNT(*)::int AS count FROM stocks s JOIN cells c ON c.id = s.cell_id WHERE c.rack_id = ${rackId} AND c.side = 'back' AND s.quantity > 0`);
      const backHasStock = Number(rowsOf<{ count: number }>(backStockResult)[0]?.count || 0) > 0;
      if (!twoSided && backHasStock) return Response.json({ error: "Нельзя убрать заднюю сторону: сначала переместите с неё материал" }, { status: 409 });

      const existingBack = Number(rowsOf<{ count: number }>((await db.execute(sql`SELECT COUNT(*)::int AS count FROM cells WHERE rack_id = ${rackId} AND side = 'back'`)))[0]?.count || 0) > 0;
      if (layoutChanged) {
        await db.execute(sql`DELETE FROM cells WHERE rack_id = ${rackId}`);
        await db.execute(sql`UPDATE racks SET name = ${name}, code = ${code}, rows = ${rowCount}, columns = ${columnCount} WHERE id = ${rackId}`);
        await makeCells("front", rowCount, columnCount, code);
        if (twoSided) await makeCells("back", rowCount, columnCount, code);
      } else {
        await db.execute(sql`UPDATE racks SET name = ${name}, code = ${code} WHERE id = ${rackId}`);
        const cellResult = await db.execute(sql`SELECT id, row_index AS "rowIndex", column_index AS "columnIndex", side FROM cells WHERE rack_id = ${rackId}`);
        for (const cell of rowsOf<{ id: string; rowIndex: number; columnIndex: number; side: "front" | "back" }>(cellResult)) {
          const letter = String.fromCharCode(65 + cell.columnIndex);
          const cellCode = cell.side === "front" ? `${code}${cell.rowIndex + 1}${letter}` : `${code}-B-${cell.rowIndex + 1}${letter}`;
          await db.execute(sql`UPDATE cells SET code = ${cellCode}, label = ${cellCode} WHERE id = ${cell.id}`);
        }
        if (twoSided && !existingBack) await makeCells("back", rowCount, columnCount, code);
        if (!twoSided && existingBack) await db.execute(sql`DELETE FROM cells WHERE rack_id = ${rackId} AND side = 'back'`);
      }
      await writeActivity({ action: "Редактирование", entityType: "Стеллаж", entityId: rackId, entityName: `${name} (${code})`, details: `${rowCount}×${columnCount}, ${twoSided ? "двухсторонний" : "односторонний"}` });
      return Response.json({ ok: true });
    }

    return Response.json({ error: "Неизвестное действие" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Операция не выполнена" }, { status: 500 });
  }
}
