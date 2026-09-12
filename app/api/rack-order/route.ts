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
    const result = await db.execute(sql`
      SELECT id, code
      FROM racks
      WHERE archived = false
      ORDER BY created_at ASC, code ASC
    `);
    return Response.json({ racks: rowsOf<{ id: string; code: string }>(result) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось получить порядок стеллажей" }, { status: 500 });
  }
}
