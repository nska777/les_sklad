import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { activityLogs } from "@/db/schema";

export const dynamic = "force-dynamic";

const clean = (value: unknown) => String(value ?? "").trim();

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
    const rackId = clean(body.rackId);
    const operator = clean(body.operator) || "Кладовщик";
    if (!rackId) return Response.json({ error: "Стеллаж не выбран" }, { status: 400 });

    const db = await getDb();
    await ensureSideColumn(db);

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

      for (let rowIndex = 0; rowIndex < rack.rows; rowIndex += 1) {
        for (let columnIndex = 0; columnIndex < rack.columns; columnIndex += 1) {
          const letter = String.fromCharCode(65 + columnIndex);
          const code = `${rack.code}-B-${rowIndex + 1}${letter}`;
          await db.execute(sql`
            INSERT INTO cells (id, rack_id, code, label, row_index, column_index, blocked, side)
            VALUES (${crypto.randomUUID()}, ${rackId}, ${code}, ${code}, ${rowIndex}, ${columnIndex}, false, 'back')
          `);
        }
      }

      await db.insert(activityLogs).values({
        id: crypto.randomUUID(),
        action: "Добавлена задняя сторона",
        entityType: "Стеллаж",
        entityId: rack.id,
        entityName: `${rack.name} (${rack.code})`,
        details: `${rack.rows} полок × ${rack.columns} ячеек на задней стороне`,
        operator,
      });
      return Response.json({ ok: true });
    }

    return Response.json({ error: "Неизвестное действие" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Операция не выполнена" }, { status: 500 });
  }
}
