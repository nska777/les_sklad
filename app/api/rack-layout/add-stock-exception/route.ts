import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { activityLogs } from "@/db/schema";

export const dynamic = "force-dynamic";

const clean = (value: unknown) => String(value ?? "").trim();
const num = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows as T[];
  }
  return [];
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const cellId = clean(body.cellId);
    const productId = clean(body.productId);
    const quantity = num(body.quantity);
    const reason = clean(body.reason);
    const operator = clean(body.operator) || "Кладовщик";

    if (!cellId || !productId || quantity <= 0) {
      return Response.json({ error: "Выберите материал, ячейку и количество" }, { status: 400 });
    }
    if (!reason) {
      return Response.json({ error: "Обязательно укажите причину дополнительного оприходования" }, { status: 400 });
    }

    const db = await getDb();
    const [cellResult, productResult, currentResult] = await Promise.all([
      db.execute(sql`SELECT id, code, blocked FROM cells WHERE id = ${cellId} LIMIT 1`),
      db.execute(sql`SELECT id, name, unit FROM products WHERE id = ${productId} LIMIT 1`),
      db.execute(sql`SELECT COALESCE(SUM(quantity), 0)::double precision AS total FROM stocks WHERE product_id = ${productId}`),
    ]);

    const cell = rowsOf<{ id: string; code: string; blocked: boolean }>(cellResult)[0];
    const product = rowsOf<{ id: string; name: string; unit: string }>(productResult)[0];
    const previousTotal = Number(rowsOf<{ total: number }>(currentResult)[0]?.total || 0);

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
      VALUES (
        ${crypto.randomUUID()},
        'Дополнительное оприходование',
        ${productId},
        ${cellId},
        ${quantity},
        ${operator},
        'rack-cell-exception',
        ${`Причина: ${reason}`},
        CURRENT_TIMESTAMP
      )
    `);

    await db.insert(activityLogs).values({
      id: crypto.randomUUID(),
      action: "Дополнительное оприходование",
      entityType: "Ячейка",
      entityId: cellId,
      entityName: cell.code,
      details: `${product.name}: +${quantity} ${product.unit}. Причина: ${reason}. Было на складе: ${previousTotal} ${product.unit}.`,
      operator,
    });

    return Response.json({ ok: true, previousTotal, newTotal: previousTotal + quantity });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось выполнить дополнительное оприходование" }, { status: 500 });
  }
}
