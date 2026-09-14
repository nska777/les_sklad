import { sql } from "drizzle-orm";
import { getDb } from "@/db";

export const dynamic = "force-dynamic";

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows as T[];
  }
  return [];
}

const clean = (value: unknown) => String(value ?? "").trim();
const finite = (value: unknown, fallback = 1) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

async function ensureVisualLayoutColumns(db: Awaited<ReturnType<typeof getDb>>) {
  await db.execute(sql`ALTER TABLE cells ADD COLUMN IF NOT EXISTS width_ratio double precision NOT NULL DEFAULT 1`);
  await db.execute(sql`ALTER TABLE cells ADD COLUMN IF NOT EXISTS height_ratio double precision NOT NULL DEFAULT 1`);
  await db.execute(sql`ALTER TABLE cells ADD COLUMN IF NOT EXISTS layout_archived boolean NOT NULL DEFAULT false`);
  await db.execute(sql`UPDATE cells SET width_ratio = 1 WHERE width_ratio IS NULL OR width_ratio <= 0`);
  await db.execute(sql`UPDATE cells SET height_ratio = 1 WHERE height_ratio IS NULL OR height_ratio <= 0`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_cells_visual_layout ON cells(rack_id, side, row_index, layout_archived)`);
}

async function loadLayout(db: Awaited<ReturnType<typeof getDb>>, rackId = "") {
  const result = rackId
    ? await db.execute(sql`
        SELECT c.id,
               c.rack_id AS "rackId",
               c.code,
               c.row_index AS "rowIndex",
               c.column_index AS "columnIndex",
               c.side,
               c.blocked,
               c.width_ratio::double precision AS "widthRatio",
               c.height_ratio::double precision AS "heightRatio",
               c.layout_archived AS archived,
               EXISTS (
                 SELECT 1 FROM stocks s
                 WHERE s.cell_id = c.id AND s.quantity > 0
               ) AS "hasStock"
        FROM cells c
        JOIN racks r ON r.id = c.rack_id
        WHERE r.archived = false AND c.rack_id = ${rackId}
        ORDER BY c.side, c.row_index, c.column_index
      `)
    : await db.execute(sql`
        SELECT c.id,
               c.rack_id AS "rackId",
               c.code,
               c.row_index AS "rowIndex",
               c.column_index AS "columnIndex",
               c.side,
               c.blocked,
               c.width_ratio::double precision AS "widthRatio",
               c.height_ratio::double precision AS "heightRatio",
               c.layout_archived AS archived,
               EXISTS (
                 SELECT 1 FROM stocks s
                 WHERE s.cell_id = c.id AND s.quantity > 0
               ) AS "hasStock"
        FROM cells c
        JOIN racks r ON r.id = c.rack_id
        WHERE r.archived = false
        ORDER BY r.code, c.side, c.row_index, c.column_index
      `);
  return rowsOf(result);
}

export async function GET(request: Request) {
  try {
    const db = await getDb();
    await ensureVisualLayoutColumns(db);
    const url = new URL(request.url);
    const rackId = clean(url.searchParams.get("rackId"));
    return Response.json({ cells: await loadLayout(db, rackId) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось загрузить визуальную схему" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = clean(body.action);
    const operator = clean(body.operator) || "Кладовщик";
    const db = await getDb();
    await ensureVisualLayoutColumns(db);

    if (action === "saveLayout") {
      const rackId = clean(body.rackId);
      const side = clean(body.side) === "back" ? "back" : "front";
      const changes = Array.isArray(body.cells) ? body.cells as Array<Record<string, unknown>> : [];
      if (!rackId || !changes.length) return Response.json({ error: "Нет данных схемы для сохранения" }, { status: 400 });

      const rowHeights = new Map<number, number>();
      let changed = 0;
      for (const item of changes) {
        const id = clean(item.id);
        const rowIndex = Math.max(0, Math.trunc(finite(item.rowIndex, 0)));
        if (!id) continue;
        const widthRatio = clamp(finite(item.widthRatio, 1), 0.12, 20);
        const heightRatio = clamp(finite(item.heightRatio, 1), 0.25, 10);
        rowHeights.set(rowIndex, heightRatio);
        const update = await db.execute(sql`
          UPDATE cells
          SET width_ratio = ${widthRatio}
          WHERE id = ${id}
            AND rack_id = ${rackId}
            AND side = ${side}
            AND layout_archived = false
          RETURNING id
        `);
        changed += rowsOf(update).length;
      }

      // Высота уровня — физическая высота полки, поэтому синхронизируем её
      // между лицевой и задней сторонами одного стеллажа.
      for (const [rowIndex, heightRatio] of rowHeights) {
        await db.execute(sql`
          UPDATE cells
          SET height_ratio = ${heightRatio}
          WHERE rack_id = ${rackId}
            AND row_index = ${rowIndex}
            AND layout_archived = false
        `);
      }

      await db.execute(sql`
        INSERT INTO activity_logs (id, action, entity_type, entity_id, entity_name, details, operator, created_at)
        VALUES (${crypto.randomUUID()}, 'Изменение схемы', 'Стеллаж', ${rackId}, ${rackId}, ${`Визуально изменена геометрия ячеек: ${changed}`}, ${operator}, CURRENT_TIMESTAMP)
      `);

      return Response.json({ ok: true, cells: await loadLayout(db, rackId) });
    }

    if (action === "archiveCell") {
      const cellId = clean(body.cellId);
      if (!cellId) return Response.json({ error: "Ячейка не выбрана" }, { status: 400 });

      const cellResult = await db.execute(sql`
        SELECT id, rack_id AS "rackId", code, side, row_index AS "rowIndex"
        FROM cells
        WHERE id = ${cellId} AND layout_archived = false
        LIMIT 1
      `);
      const cell = rowsOf<{ id: string; rackId: string; code: string; side: string; rowIndex: number }>(cellResult)[0];
      if (!cell) return Response.json({ error: "Ячейка не найдена или уже удалена из схемы" }, { status: 404 });

      const stockResult = await db.execute(sql`
        SELECT COALESCE(SUM(quantity), 0)::double precision AS quantity
        FROM stocks
        WHERE cell_id = ${cellId}
      `);
      const stockQuantity = Number(rowsOf<{ quantity: number }>(stockResult)[0]?.quantity || 0);
      if (stockQuantity > 0) {
        return Response.json({ error: "В ячейке есть материал. Сначала переместите остаток в другую ячейку." }, { status: 409 });
      }

      const rowCountResult = await db.execute(sql`
        SELECT COUNT(*)::int AS count
        FROM cells
        WHERE rack_id = ${cell.rackId}
          AND side = ${cell.side}
          AND row_index = ${cell.rowIndex}
          AND layout_archived = false
      `);
      const rowCount = Number(rowsOf<{ count: number }>(rowCountResult)[0]?.count || 0);
      if (rowCount <= 1) {
        return Response.json({ error: "На полке должна остаться хотя бы одна ячейка." }, { status: 409 });
      }

      await db.execute(sql`
        UPDATE cells
        SET layout_archived = true, blocked = true
        WHERE id = ${cellId}
      `);
      await db.execute(sql`
        INSERT INTO activity_logs (id, action, entity_type, entity_id, entity_name, details, operator, created_at)
        VALUES (${crypto.randomUUID()}, 'Удаление ячейки из схемы', 'Ячейка', ${cellId}, ${cell.code}, 'Ячейка архивирована визуальным редактором', ${operator}, CURRENT_TIMESTAMP)
      `);

      return Response.json({ ok: true, cells: await loadLayout(db, cell.rackId) });
    }

    return Response.json({ error: "Неизвестное действие визуального редактора" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось сохранить визуальную схему" }, { status: 500 });
  }
}
