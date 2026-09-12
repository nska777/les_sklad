import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { activityLogs } from "@/db/schema";

export const dynamic = "force-dynamic";

const clean = (value: unknown) => String(value ?? "").trim();
const number = (value: unknown, fallback = 0) => {
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

function cellCode(rackCode: string, side: "front" | "back", rowIndex: number, columnIndex: number) {
  const letter = String.fromCharCode(65 + columnIndex);
  return side === "front"
    ? `${rackCode}${rowIndex + 1}${letter}`
    : `${rackCode}-B-${rowIndex + 1}${letter}`;
}

async function createSide(
  db: Awaited<ReturnType<typeof getDb>>,
  rack: { id: string; code: string; rows: number; columns: number },
  side: "front" | "back",
) {
  for (let rowIndex = 0; rowIndex < rack.rows; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < rack.columns; columnIndex += 1) {
      const code = cellCode(rack.code, side, rowIndex, columnIndex);
      await db.execute(sql`
        INSERT INTO cells (id, rack_id, code, label, row_index, column_index, blocked, side)
        VALUES (${crypto.randomUUID()}, ${rack.id}, ${code}, ${code}, ${rowIndex}, ${columnIndex}, false, ${side})
      `);
    }
  }
}

export async function GET() {
  try {
    const db = await getDb();
    await ensureSideColumn(db);

    const [racksResult, cellsResult, stocksResult] = await Promise.all([
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
    ]);

    return Response.json({
      racks: rowsOf(racksResult),
      cells: rowsOf(cellsResult),
      stocks: rowsOf(stocksResult),
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

    if (action === "createRack") {
      const name = clean(body.name);
      const code = clean(body.code).toUpperCase();
      const rows = Math.min(12, Math.max(1, Math.floor(number(body.rows, 4))));
      const columns = Math.min(12, Math.max(1, Math.floor(number(body.columns, 4))));
      const twoSided = body.twoSided === true;
      if (!name || !code) return Response.json({ error: "Укажите название и код стеллажа" }, { status: 400 });

      const duplicate = await db.execute(sql`SELECT id FROM racks WHERE code = ${code} LIMIT 1`);
      if (rowsOf(duplicate).length) return Response.json({ error: "Такой код стеллажа уже существует" }, { status: 409 });

      const id = crypto.randomUUID();
      await db.execute(sql`
        INSERT INTO racks (id, name, code, rows, columns, archived)
        VALUES (${id}, ${name}, ${code}, ${rows}, ${columns}, false)
      `);
      await createSide(db, { id, code, rows, columns }, "front");
      if (twoSided) await createSide(db, { id, code, rows, columns }, "back");

      await db.insert(activityLogs).values({
        id: crypto.randomUUID(),
        action: "Создание",
        entityType: "Стеллаж",
        entityId: id,
        entityName: `${name} (${code})`,
        details: `${rows} полок × ${columns} ячеек · ${twoSided ? "двухсторонний" : "односторонний"}`,
        operator,
      });
      return Response.json({ ok: true, rackId: id }, { status: 201 });
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

    if (action === "enableBackSide") {
      const existsResult = await db.execute(sql`SELECT COUNT(*)::int AS count FROM cells WHERE rack_id = ${rackId} AND side = 'back'`);
      const exists = Number(rowsOf<{ count: number }>(existsResult)[0]?.count || 0);
      if (exists > 0) return Response.json({ ok: true, alreadyExists: true });
      await createSide(db, rack, "back");
      await db.insert(activityLogs).values({
        id: crypto.randomUUID(), action: "Добавлена задняя сторона", entityType: "Стеллаж", entityId: rack.id,
        entityName: `${rack.name} (${rack.code})`, details: `${rack.rows} полок × ${rack.columns} ячеек на задней стороне`, operator,
      });
      return Response.json({ ok: true });
    }

    if (action === "updateRack") {
      const name = clean(body.name);
      const code = clean(body.code).toUpperCase();
      const rows = Math.min(12, Math.max(1, Math.floor(number(body.rows, rack.rows))));
      const columns = Math.min(12, Math.max(1, Math.floor(number(body.columns, rack.columns))));
      const twoSided = body.twoSided === true;
      if (!name || !code) return Response.json({ error: "Укажите название и код стеллажа" }, { status: 400 });

      const duplicate = await db.execute(sql`SELECT id FROM racks WHERE code = ${code} AND id <> ${rackId} LIMIT 1`);
      if (rowsOf(duplicate).length) return Response.json({ error: "Такой код стеллажа уже существует" }, { status: 409 });

      const stockResult = await db.execute(sql`
        SELECT COUNT(*)::int AS count
        FROM stocks s JOIN cells c ON c.id = s.cell_id
        WHERE c.rack_id = ${rackId} AND s.quantity > 0
      `);
      const hasStock = Number(rowsOf<{ count: number }>(stockResult)[0]?.count || 0) > 0;
      const sizeChanged = rows !== rack.rows || columns !== rack.columns;
      if (sizeChanged && hasStock) return Response.json({ error: "Нельзя менять размеры занятого стеллажа" }, { status: 409 });

      const backCountResult = await db.execute(sql`SELECT COUNT(*)::int AS count FROM cells WHERE rack_id = ${rackId} AND side = 'back'`);
      const hasBack = Number(rowsOf<{ count: number }>(backCountResult)[0]?.count || 0) > 0;
      if (!twoSided && hasBack) {
        const backStockResult = await db.execute(sql`
          SELECT COUNT(*)::int AS count FROM stocks s JOIN cells c ON c.id = s.cell_id
          WHERE c.rack_id = ${rackId} AND c.side = 'back' AND s.quantity > 0
        `);
        if (Number(rowsOf<{ count: number }>(backStockResult)[0]?.count || 0) > 0) {
          return Response.json({ error: "Нельзя убрать заднюю сторону: на ней есть материалы" }, { status: 409 });
        }
      }

      if (sizeChanged) {
        await db.execute(sql`DELETE FROM cells WHERE rack_id = ${rackId}`);
        await db.execute(sql`UPDATE racks SET name = ${name}, code = ${code}, rows = ${rows}, columns = ${columns} WHERE id = ${rackId}`);
        await createSide(db, { id: rackId, code, rows, columns }, "front");
        if (twoSided) await createSide(db, { id: rackId, code, rows, columns }, "back");
      } else {
        await db.execute(sql`UPDATE racks SET name = ${name}, code = ${code} WHERE id = ${rackId}`);
        const cellRows = rowsOf<{ id: string; side: "front" | "back"; rowIndex: number; columnIndex: number }>(await db.execute(sql`
          SELECT id, side, row_index AS "rowIndex", column_index AS "columnIndex" FROM cells WHERE rack_id = ${rackId}
        `));
        for (const cell of cellRows) {
          const nextCode = cellCode(code, cell.side, cell.rowIndex, cell.columnIndex);
          await db.execute(sql`UPDATE cells SET code = ${nextCode}, label = ${nextCode} WHERE id = ${cell.id}`);
        }
        if (twoSided && !hasBack) await createSide(db, { id: rackId, code, rows, columns }, "back");
        if (!twoSided && hasBack) await db.execute(sql`DELETE FROM cells WHERE rack_id = ${rackId} AND side = 'back'`);
      }

      await db.insert(activityLogs).values({
        id: crypto.randomUUID(), action: "Редактирование", entityType: "Стеллаж", entityId: rack.id,
        entityName: `${name} (${code})`, details: `${rows} полок × ${columns} ячеек · ${twoSided ? "двухсторонний" : "односторонний"}`, operator,
      });
      return Response.json({ ok: true });
    }

    if (action === "deleteRack") {
      const stockResult = await db.execute(sql`
        SELECT COUNT(*)::int AS count FROM stocks s JOIN cells c ON c.id = s.cell_id
        WHERE c.rack_id = ${rackId} AND s.quantity > 0
      `);
      if (Number(rowsOf<{ count: number }>(stockResult)[0]?.count || 0) > 0) {
        return Response.json({ error: "Сначала переместите материалы из этого стеллажа" }, { status: 409 });
      }
      await db.execute(sql`UPDATE racks SET archived = true WHERE id = ${rackId}`);
      await db.insert(activityLogs).values({
        id: crypto.randomUUID(), action: "Удаление", entityType: "Стеллаж", entityId: rack.id,
        entityName: `${rack.name} (${rack.code})`, details: "Стеллаж удалён из рабочего списка", operator,
      });
      return Response.json({ ok: true });
    }

    return Response.json({ error: "Неизвестное действие" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Операция не выполнена" }, { status: 500 });
  }
}
