import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { activityLogs } from "@/db/schema";

export const dynamic = "force-dynamic";

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
    const role = String(request.headers.get("x-warehouse-role") || "").trim();
    const operator = decodeURIComponent(String(request.headers.get("x-warehouse-user") || "Администратор"));
    if (role !== "admin") {
      return Response.json({ error: "Полная очистка материалов доступна только администратору" }, { status: 403 });
    }

    const body = await request.json() as { confirmation?: string };
    if (String(body.confirmation || "").trim().toUpperCase() !== "УДАЛИТЬ ВСЕ") {
      return Response.json({ error: "Для подтверждения введите: УДАЛИТЬ ВСЕ" }, { status: 400 });
    }

    const db = await getDb();
    const productCountResult = await db.execute(sql`SELECT COUNT(*)::int AS count FROM products`);
    const stockCountResult = await db.execute(sql`SELECT COUNT(*)::int AS count FROM stocks WHERE quantity > 0`);
    const productCount = Number(rowsOf<{ count: number }>(productCountResult)[0]?.count || 0);
    const stockCount = Number(rowsOf<{ count: number }>(stockCountResult)[0]?.count || 0);

    try {
      await db.execute(sql`UPDATE onec_materials SET linked_product_id = NULL`);
    } catch {
      // Справочник 1С мог ещё не быть создан — это не мешает очистке склада.
    }

    await db.execute(sql`DELETE FROM stocks`);
    await db.execute(sql`DELETE FROM movements`);
    await db.execute(sql`DELETE FROM warehouse_document_lines`);
    await db.execute(sql`DELETE FROM warehouse_documents`);
    await db.execute(sql`DELETE FROM products`);

    await db.insert(activityLogs).values({
      id: crypto.randomUUID(),
      action: "Полная очистка материалов",
      entityType: "Материалы",
      entityId: "all-materials",
      entityName: "Все материалы склада",
      details: `Удалено материалов: ${productCount}; размещённых позиций: ${stockCount}. Очищены остатки, движения и связанные складские документы. Справочник 1С сохранён, связи с товарами сброшены.`,
      operator,
    });

    return Response.json({ ok: true, deletedProducts: productCount, deletedStockPositions: stockCount });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось удалить материалы" }, { status: 500 });
  }
}
