import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { activityLogs, cells, movements, products, stocks } from "@/db/schema";
import seed from "@/data/onec-materials.json";

export const dynamic = "force-dynamic";

const clean = (value: unknown) => String(value ?? "").trim();
const num = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows as T[];
  }
  return [];
}

async function ensureReference(db: Awaited<ReturnType<typeof getDb>>) {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS onec_materials (
    id text PRIMARY KEY,
    source_row integer NOT NULL UNIQUE,
    name text NOT NULL,
    quantity_1c double precision NOT NULL DEFAULT 0,
    reserved_1c double precision NOT NULL DEFAULT 0,
    available_1c double precision NOT NULL DEFAULT 0,
    linked_product_id text REFERENCES products(id),
    created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  const countResult = await db.execute(sql`SELECT COUNT(*)::int AS count FROM onec_materials`);
  if (Number(rowsOf<{ count: number }>(countResult)[0]?.count || 0) > 0) return;
  for (let offset = 0; offset < seed.length; offset += 80) {
    const tuples = seed.slice(offset, offset + 80).map((item) => sql`(${`onec-${item.sourceRow}`}, ${item.sourceRow}, ${item.name}, ${item.quantity1c}, ${item.reserved1c}, ${item.available1c})`);
    await db.execute(sql`INSERT INTO onec_materials (id, source_row, name, quantity_1c, reserved_1c, available_1c)
      VALUES ${sql.join(tuples, sql`, `)} ON CONFLICT (source_row) DO NOTHING`);
  }
}

async function nextCode(db: Awaited<ReturnType<typeof getDb>>) {
  const all = await db.select({ sku: products.sku }).from(products);
  let max = 0;
  for (const item of all) {
    const m = /^RL-(\d{6})$/i.exec(item.sku);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `RL-${String(max + 1).padStart(6, "0")}`;
}

export async function GET(request: Request) {
  try {
    const db = await getDb();
    await ensureReference(db);
    const q = clean(new URL(request.url).searchParams.get("q"));
    const pattern = `%${q}%`;
    const prefix = `${q}%`;
    const result = await db.execute(sql`
      SELECT om.id, om.source_row AS "sourceRow", om.name,
        om.quantity_1c AS "quantity1c", om.reserved_1c AS "reserved1c", om.available_1c AS "available1c",
        om.linked_product_id AS "linkedProductId", p.sku AS "internalCode", p.barcode,
        COALESCE(SUM(s.quantity), 0)::double precision AS "placedQuantity"
      FROM onec_materials om
      LEFT JOIN products p ON p.id = om.linked_product_id
      LEFT JOIN stocks s ON s.product_id = p.id
      WHERE ${q ? sql`om.name ILIKE ${pattern}` : sql`TRUE`}
      GROUP BY om.id, om.source_row, om.name, om.quantity_1c, om.reserved_1c, om.available_1c, om.linked_product_id, p.sku, p.barcode
      ORDER BY ${q ? sql`CASE WHEN om.name ILIKE ${prefix} THEN 0 ELSE 1 END, om.name` : sql`om.name`}
      LIMIT 60
    `);
    const statsResult = await db.execute(sql`SELECT COUNT(*)::int AS total, COUNT(linked_product_id)::int AS linked FROM onec_materials`);
    return Response.json({ items: rowsOf(result), stats: rowsOf(statsResult)[0] || { total: seed.length, linked: 0 } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось загрузить материалы из 1С" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    if (clean(body.action) !== "place") return Response.json({ error: "Неизвестное действие" }, { status: 400 });
    const onecMaterialId = clean(body.onecMaterialId);
    const cellId = clean(body.cellId);
    const quantity = num(body.quantity);
    const operator = clean(body.operator) || "Кладовщик";
    if (!onecMaterialId || !cellId || quantity <= 0) return Response.json({ error: "Выберите материал, ячейку и количество" }, { status: 400 });

    const db = await getDb();
    await ensureReference(db);
    const materialResult = await db.execute(sql`SELECT id, source_row AS "sourceRow", name, linked_product_id AS "linkedProductId" FROM onec_materials WHERE id = ${onecMaterialId} LIMIT 1`);
    const material = rowsOf<{ id: string; sourceRow: number; name: string; linkedProductId: string | null }>(materialResult)[0];
    if (!material) return Response.json({ error: "Материал из 1С не найден" }, { status: 404 });
    const [cell] = await db.select().from(cells).where(eq(cells.id, cellId)).limit(1);
    if (!cell || cell.blocked) return Response.json({ error: "Ячейка недоступна" }, { status: 409 });

    let productId = material.linkedProductId;
    let code = "";
    if (productId) {
      const [existing] = await db.select().from(products).where(eq(products.id, productId)).limit(1);
      if (existing) code = existing.sku;
      else productId = null;
    }
    if (!productId) {
      productId = crypto.randomUUID();
      code = await nextCode(db);
      await db.insert(products).values({ id: productId, name: material.name, sku: code, barcode: code, category: "Фурнитура", unit: "шт.", packQty: 1, imageUrl: "", minStock: 0, oneCId: `onec-row-${material.sourceRow}` });
      await db.execute(sql`UPDATE onec_materials SET linked_product_id = ${productId} WHERE id = ${onecMaterialId}`);
    }

    const [stock] = await db.select().from(stocks).where(sql`${stocks.productId} = ${productId} AND ${stocks.cellId} = ${cellId}`).limit(1);
    if (stock) await db.update(stocks).set({ quantity: stock.quantity + quantity, updatedAt: sql`CURRENT_TIMESTAMP` }).where(sql`${stocks.productId} = ${productId} AND ${stocks.cellId} = ${cellId}`);
    else await db.insert(stocks).values({ productId, cellId, quantity });

    await db.insert(movements).values({ id: crypto.randomUUID(), type: "Первичный учёт из 1С", productId, cellId, quantity, operator, source: "onec-reference", comment: "Размещение по справочнику 1С" });
    await db.insert(activityLogs).values({ id: crypto.randomUUID(), action: "Размещение из 1С", entityType: "Материал", entityId: productId, entityName: `${material.name} (${code})`, details: `${quantity} шт. → ${cell.code}`, operator });
    return Response.json({ ok: true, productId, internalCode: code, barcode: code });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось разместить материал" }, { status: 500 });
  }
}
