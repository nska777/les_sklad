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

function columnLetters(index: number) {
  let value = Math.max(0, Math.trunc(index));
  let result = "";
  do {
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return result;
}

async function ensureVisualColumns(db: Awaited<ReturnType<typeof getDb>>) {
  await db.execute(sql`ALTER TABLE cells ADD COLUMN IF NOT EXISTS side text NOT NULL DEFAULT 'front'`);
  await db.execute(sql`ALTER TABLE cells ADD COLUMN IF NOT EXISTS width_ratio double precision NOT NULL DEFAULT 1`);
  await db.execute(sql`ALTER TABLE cells ADD COLUMN IF NOT EXISTS height_ratio double precision NOT NULL DEFAULT 1`);
  await db.execute(sql`ALTER TABLE cells ADD COLUMN IF NOT EXISTS layout_archived boolean NOT NULL DEFAULT false`);
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const anchorCode = clean(body.anchorCode);
    const operator = clean(body.operator) || "Визуальный редактор";
    if (!anchorCode) return Response.json({ error: "Не удалось определить полку" }, { status: 400 });

    const db = await getDb();
    await ensureVisualColumns(db);

    const anchorResult = await db.execute(sql`
      SELECT c.id, c.rack_id AS "rackId", c.row_index AS "rowIndex", c.side,
             c.height_ratio::double precision AS "heightRatio", r.code AS "rackCode"
      FROM cells c
      JOIN racks r ON r.id = c.rack_id
      WHERE c.code = ${anchorCode}
        AND r.archived = false
        AND c.layout_archived = false
      LIMIT 1
    `);
    const anchor = rowsOf<{ id: string; rackId: string; rowIndex: number; side: "front" | "back"; heightRatio: number; rackCode: string }>(anchorResult)[0];
    if (!anchor) return Response.json({ error: "Исходная ячейка не найдена" }, { status: 404 });

    const rowResult = await db.execute(sql`
      SELECT id, code, column_index AS "columnIndex",
             width_ratio::double precision AS "widthRatio",
             height_ratio::double precision AS "heightRatio"
      FROM cells
      WHERE rack_id = ${anchor.rackId}
        AND side = ${anchor.side}
        AND row_index = ${anchor.rowIndex}
        AND layout_archived = false
      ORDER BY column_index
    `);
    const rowCells = rowsOf<{ id: string; code: string; columnIndex: number; widthRatio: number; heightRatio: number }>(rowResult);
    if (!rowCells.length) return Response.json({ error: "На полке нет активных ячеек" }, { status: 409 });

    const allRowResult = await db.execute(sql`
      SELECT COALESCE(MAX(column_index), -1)::int AS max_index
      FROM cells
      WHERE rack_id = ${anchor.rackId}
        AND side = ${anchor.side}
        AND row_index = ${anchor.rowIndex}
    `);
    const maxIndex = Number(rowsOf<{ max_index: number }>(allRowResult)[0]?.max_index ?? -1);
    const columnIndex = maxIndex + 1;
    const letter = columnLetters(columnIndex);
    const cellCode = anchor.side === "front"
      ? `${anchor.rackCode}${anchor.rowIndex + 1}${letter}`
      : `${anchor.rackCode}-B-${anchor.rowIndex + 1}${letter}`;

    const totalWidth = rowCells.reduce((sum, cell) => sum + Math.max(0.12, Number(cell.widthRatio || 1)), 0);
    const newWidth = Math.max(0.12, totalWidth / Math.max(1, rowCells.length));
    const scale = totalWidth / (totalWidth + newWidth);

    for (const cell of rowCells) {
      await db.execute(sql`
        UPDATE cells
        SET width_ratio = ${Math.max(0.12, Number(cell.widthRatio || 1) * scale)}
        WHERE id = ${cell.id}
      `);
    }

    const id = crypto.randomUUID();
    const heightRatio = Math.max(0.25, Number(anchor.heightRatio || rowCells[0]?.heightRatio || 1));
    const insertedWidth = Math.max(0.12, newWidth * scale);
    await db.execute(sql`
      INSERT INTO cells (
        id, rack_id, code, label, row_index, column_index,
        blocked, side, width_ratio, height_ratio, layout_archived
      ) VALUES (
        ${id}, ${anchor.rackId}, ${cellCode}, ${cellCode}, ${anchor.rowIndex}, ${columnIndex},
        false, ${anchor.side}, ${insertedWidth}, ${heightRatio}, false
      )
    `);

    await db.execute(sql`
      INSERT INTO activity_logs (id, action, entity_type, entity_id, entity_name, details, operator, created_at)
      VALUES (
        ${crypto.randomUUID()}, 'Добавление ячейки', 'Ячейка', ${id}, ${cellCode},
        ${`Добавлена визуальным редактором: ${anchor.side === "front" ? "лицевая" : "задняя"} сторона, полка ${anchor.rowIndex + 1}`},
        ${operator}, CURRENT_TIMESTAMP
      )
    `);

    return Response.json({
      ok: true,
      cell: {
        id,
        rackId: anchor.rackId,
        code: cellCode,
        label: cellCode,
        rowIndex: anchor.rowIndex,
        columnIndex,
        blocked: false,
        side: anchor.side,
        widthRatio: insertedWidth,
        heightRatio,
        archived: false,
        hasStock: false,
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось добавить ячейку" }, { status: 500 });
  }
}
