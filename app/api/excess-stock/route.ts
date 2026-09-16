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

export async function GET() {
  try {
    const db = await getDb();
    const tableResult = await db.execute(sql`SELECT to_regclass('public.onec_materials')::text AS name`);
    const exists = Boolean(rowsOf<{ name: string | null }>(tableResult)[0]?.name);
    if (!exists) return Response.json({ items: [], stats: { items: 0, units: 0 } });

    const result = await db.execute(sql`
      WITH totals AS (
        SELECT product_id, SUM(quantity)::double precision AS factual
        FROM stocks
        WHERE quantity > 0
        GROUP BY product_id
      ), locations AS (
        SELECT s.product_id,
          json_agg(
            json_build_object(
              'cellId', c.id,
              'cellCode', c.code,
              'quantity', s.quantity,
              'rackId', r.id,
              'rackCode', r.code,
              'rackName', r.name,
              'side', c.side,
              'rowIndex', c.row_index,
              'columnIndex', c.column_index
            ) ORDER BY r.code, c.side, c.row_index, c.column_index
          ) AS locations
        FROM stocks s
        JOIN cells c ON c.id = s.cell_id
        JOIN racks r ON r.id = c.rack_id
        WHERE s.quantity > 0 AND r.archived = false
        GROUP BY s.product_id
      )
      SELECT
        p.id AS "productId",
        p.name,
        p.sku,
        p.barcode,
        p.unit,
        om.available_1c::double precision AS "available1c",
        COALESCE(t.factual, 0)::double precision AS factual,
        GREATEST(COALESCE(t.factual, 0) - om.available_1c, 0)::double precision AS excess,
        COALESCE(l.locations, '[]'::json) AS locations
      FROM onec_materials om
      JOIN products p ON p.id = om.linked_product_id
      LEFT JOIN totals t ON t.product_id = p.id
      LEFT JOIN locations l ON l.product_id = p.id
      WHERE COALESCE(t.factual, 0) > om.available_1c + 0.000000001
      ORDER BY GREATEST(COALESCE(t.factual, 0) - om.available_1c, 0) DESC, p.name
    `);

    const items = rowsOf<{
      productId: string;
      name: string;
      sku: string;
      barcode: string;
      unit: string;
      available1c: number;
      factual: number;
      excess: number;
      locations: unknown[];
    }>(result);

    return Response.json({
      items,
      stats: {
        items: items.length,
        units: items.reduce((sum, item) => sum + Number(item.excess || 0), 0),
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось загрузить излишки" }, { status: 500 });
  }
}
