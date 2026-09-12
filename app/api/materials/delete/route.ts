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
      return Response.json({ error: "Удаление материала доступно только администратору" }, { status: 403 });
    }

    const body = await request.json() as { productId?: string; confirmation?: string };
    const productId = String(body.productId || "").trim();
    if (!productId) return Response.json({ error: "Материал не выбран" }, { status: 400 });
    if (String(body.confirmation || "").trim().toUpperCase() !== "УДАЛИТЬ") {
      return Response.json({ error: "Для подтверждения введите: УДАЛИТЬ" }, { status: 400 });
    }

    const db = await getDb();
    const productResult = await db.execute(sql`
      SELECT id, name, sku, unit
      FROM products
      WHERE id = ${productId}
      LIMIT 1
    `);
    const product = rowsOf<{ id: string; name: string; sku: string; unit: string }>(productResult)[0];
    if (!product) return Response.json({ error: "Материал уже удалён или не найден" }, { status: 404 });

    const stockResult = await db.execute(sql`
      SELECT COUNT(*)::int AS positions, COALESCE(SUM(quantity), 0)::double precision AS total
      FROM stocks
      WHERE product_id = ${productId} AND quantity > 0
    `);
    const stock = rowsOf<{ positions: number; total: number }>(stockResult)[0] || { positions: 0, total: 0 };

    try {
      await db.execute(sql`UPDATE onec_materials SET linked_product_id = NULL WHERE linked_product_id = ${productId}`);
    } catch {
      // Справочник 1С мог ещё не существовать.
    }

    await db.execute(sql`DELETE FROM stocks WHERE product_id = ${productId}`);
    await db.execute(sql`DELETE FROM movements WHERE product_id = ${productId}`);
    await db.execute(sql`DELETE FROM warehouse_document_lines WHERE product_id = ${productId}`);
    await db.execute(sql`DELETE FROM products WHERE id = ${productId}`);

    await db.insert(activityLogs).values({
      id: crypto.randomUUID(),
      action: "Удаление материала",
      entityType: "Материал",
      entityId: productId,
      entityName: `${product.name} (${product.sku})`,
      details: `Удалена карточка материала. Остаток перед удалением: ${Number(stock.total || 0)} ${product.unit}; мест хранения: ${Number(stock.positions || 0)}. Связь со справочником 1С сброшена.`,
      operator,
    });

    return Response.json({
      ok: true,
      deletedProduct: product.name,
      deletedSku: product.sku,
      deletedStockPositions: Number(stock.positions || 0),
      deletedQuantity: Number(stock.total || 0),
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось удалить материал" }, { status: 500 });
  }
}
