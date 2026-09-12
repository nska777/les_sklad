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
  await db.execute(sql`CREATE TABLE IF NOT EXISTS onec_settings (
    key text PRIMARY KEY,
    value text NOT NULL DEFAULT ''
  )`);

  const initializedResult = await db.execute(sql`SELECT value FROM onec_settings WHERE key = 'initialized' LIMIT 1`);
  if (rowsOf(initializedResult).length) return;

  const countResult = await db.execute(sql`SELECT COUNT(*)::int AS count FROM onec_materials`);
  const count = Number(rowsOf<{ count: number }>(countResult)[0]?.count || 0);
  if (count === 0) {
    for (let offset = 0; offset < seed.length; offset += 80) {
      const tuples = seed.slice(offset, offset + 80).map((item) => sql`(${`onec-${item.sourceRow}`}, ${item.sourceRow}, ${item.name}, ${item.quantity1c}, ${item.reserved1c}, ${item.available1c})`);
      await db.execute(sql`INSERT INTO onec_materials (id, source_row, name, quantity_1c, reserved_1c, available_1c)
        VALUES ${sql.join(tuples, sql`, `)} ON CONFLICT (source_row) DO NOTHING`);
    }
  }
  await db.execute(sql`INSERT INTO onec_settings (key, value) VALUES ('initialized', '1') ON CONFLICT (key) DO NOTHING`);
}

async function nextCode(db: Awaited<ReturnType<typeof getDb>>) {
  const all = await db.select({ sku: products.sku }).from(products);
  let max = 0;
  for (const item of all) {
    const match = /^RL-(\d{6})$/i.exec(item.sku);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `RL-${String(max + 1).padStart(6, "0")}`;
}

async function materialById(db: Awaited<ReturnType<typeof getDb>>, onecMaterialId: string) {
  const result = await db.execute(sql`
    SELECT id, source_row AS "sourceRow", name,
      quantity_1c::double precision AS "quantity1c",
      reserved_1c::double precision AS "reserved1c",
      available_1c::double precision AS "available1c",
      linked_product_id AS "linkedProductId"
    FROM onec_materials
    WHERE id = ${onecMaterialId}
    LIMIT 1
  `);
  return rowsOf<{
    id: string;
    sourceRow: number;
    name: string;
    quantity1c: number;
    reserved1c: number;
    available1c: number;
    linkedProductId: string | null;
  }>(result)[0];
}

async function placedTotal(db: Awaited<ReturnType<typeof getDb>>, productId: string | null) {
  if (!productId) return 0;
  const result = await db.execute(sql`SELECT COALESCE(SUM(quantity), 0)::double precision AS total FROM stocks WHERE product_id = ${productId}`);
  return Number(rowsOf<{ total: number }>(result)[0]?.total || 0);
}

export async function GET(request: Request) {
  try {
    const db = await getDb();
    await ensureReference(db);

    const url = new URL(request.url);
    const q = clean(url.searchParams.get("q"));
    const page = Math.max(1, Math.floor(num(url.searchParams.get("page")) || 1));
    const pageSize = Math.min(100, Math.max(10, Math.floor(num(url.searchParams.get("pageSize")) || 50)));
    const pattern = `%${q}%`;
    const prefix = `${q}%`;

    const countResult = await db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM onec_materials om
      WHERE ${q ? sql`om.name ILIKE ${pattern}` : sql`TRUE`}
    `);
    const filteredTotal = Number(rowsOf<{ count: number }>(countResult)[0]?.count || 0);
    const pages = Math.max(1, Math.ceil(filteredTotal / pageSize));
    const safePage = Math.min(page, pages);
    const safeOffset = (safePage - 1) * pageSize;

    const result = await db.execute(sql`
      SELECT om.id, om.source_row AS "sourceRow", om.name,
        om.quantity_1c::double precision AS "quantity1c",
        om.reserved_1c::double precision AS "reserved1c",
        om.available_1c::double precision AS "available1c",
        om.linked_product_id AS "linkedProductId", p.sku AS "internalCode", p.barcode,
        COALESCE(SUM(s.quantity), 0)::double precision AS "placedQuantity",
        COALESCE(
          json_agg(
            json_build_object('cellId', c.id, 'cellCode', c.code, 'quantity', s.quantity)
            ORDER BY c.code
          ) FILTER (WHERE s.quantity > 0 AND c.id IS NOT NULL),
          '[]'::json
        ) AS locations
      FROM onec_materials om
      LEFT JOIN products p ON p.id = om.linked_product_id
      LEFT JOIN stocks s ON s.product_id = p.id
      LEFT JOIN cells c ON c.id = s.cell_id
      WHERE ${q ? sql`om.name ILIKE ${pattern}` : sql`TRUE`}
      GROUP BY om.id, om.source_row, om.name, om.quantity_1c, om.reserved_1c, om.available_1c, om.linked_product_id, p.sku, p.barcode
      ORDER BY ${q ? sql`CASE WHEN om.name ILIKE ${prefix} THEN 0 ELSE 1 END, om.name` : sql`om.name`}
      LIMIT ${pageSize} OFFSET ${safeOffset}
    `);

    const statsResult = await db.execute(sql`SELECT COUNT(*)::int AS total, COUNT(linked_product_id)::int AS linked FROM onec_materials`);
    return Response.json({
      items: rowsOf(result),
      stats: rowsOf(statsResult)[0] || { total: 0, linked: 0 },
      pagination: { page: safePage, pageSize, pages, filteredTotal },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось загрузить материалы из 1С" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = clean(body.action);
    const operator = clean(body.operator) || "Кладовщик";
    const db = await getDb();
    await ensureReference(db);

    if (action === "clearReference") {
      const countResult = await db.execute(sql`SELECT COUNT(*)::int AS count FROM onec_materials`);
      const count = Number(rowsOf<{ count: number }>(countResult)[0]?.count || 0);
      await db.execute(sql`DELETE FROM onec_materials`);
      await db.execute(sql`INSERT INTO onec_settings (key, value) VALUES ('initialized', '1') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
      await db.insert(activityLogs).values({
        id: crypto.randomUUID(),
        action: "Очистка справочника 1С",
        entityType: "Справочник 1С",
        entityId: "onec-materials",
        entityName: "Материалы из 1С",
        details: `Удалено ${count} строк справочника. Фактические товары и остатки склада не удалялись.`,
        operator,
      });
      return Response.json({ ok: true, deleted: count });
    }

    if (action === "place") {
      const onecMaterialId = clean(body.onecMaterialId);
      const cellId = clean(body.cellId);
      const quantity = num(body.quantity);
      if (!onecMaterialId || !cellId || quantity <= 0) {
        return Response.json({ error: "Выберите материал, ячейку и количество" }, { status: 400 });
      }

      const material = await materialById(db, onecMaterialId);
      if (!material) return Response.json({ error: "Материал из 1С не найден" }, { status: 404 });

      const placedQuantity = await placedTotal(db, material.linkedProductId);
      const remaining = Math.max(0, Number(material.available1c) - placedQuantity);
      if (remaining <= 0) {
        return Response.json({ error: `Весь доступный остаток из 1С уже размещён (${material.available1c} шт.)` }, { status: 409 });
      }
      if (quantity > remaining + 1e-9) {
        return Response.json({ error: `Нельзя разместить ${quantity} шт. Осталось по 1С: ${remaining} шт.` }, { status: 409 });
      }

      const [cell] = await db.select().from(cells).where(eq(cells.id, cellId)).limit(1);
      if (!cell || cell.blocked) return Response.json({ error: "Ячейка недоступна" }, { status: 409 });

      const occupiedResult = await db.execute(sql`
        SELECT p.name AS "productName", p.sku,
               s.quantity::double precision AS quantity, p.unit
        FROM stocks s
        JOIN products p ON p.id = s.product_id
        WHERE s.cell_id = ${cellId} AND s.quantity > 0
        ORDER BY p.name
      `);
      const occupied = rowsOf<{ productName: string; sku: string; quantity: number; unit: string }>(occupiedResult);
      if (occupied.length) {
        const contents = occupied
          .map((row) => `${row.productName}${row.sku ? ` (${row.sku})` : ""} — ${Number(row.quantity).toLocaleString("ru-RU", { maximumFractionDigits: 3 })} ${row.unit || "шт."}`)
          .join(", ");
        return Response.json({
          error: `Ячейка ${cell.code} уже занята: ${contents}. Выберите свободную ячейку.`,
          occupied: true,
          cellCode: cell.code,
          contents: occupied,
        }, { status: 409 });
      }

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
        await db.insert(products).values({
          id: productId,
          name: material.name,
          sku: code,
          barcode: code,
          category: "Фурнитура",
          unit: "шт.",
          packQty: 1,
          imageUrl: "",
          minStock: 0,
          oneCId: `onec-row-${material.sourceRow}`,
        });
        await db.execute(sql`UPDATE onec_materials SET linked_product_id = ${productId} WHERE id = ${onecMaterialId}`);
      }

      await db.insert(stocks).values({ productId, cellId, quantity });

      await db.insert(movements).values({
        id: crypto.randomUUID(),
        type: "Первичный учёт из 1С",
        productId,
        cellId,
        quantity,
        operator,
        source: "onec-reference",
        comment: "Размещение по справочнику 1С",
      });
      await db.insert(activityLogs).values({
        id: crypto.randomUUID(),
        action: "Размещение из 1С",
        entityType: "Материал",
        entityId: productId,
        entityName: `${material.name} (${code})`,
        details: `${quantity} шт. → ${cell.code}`,
        operator,
      });
      return Response.json({ ok: true, productId, internalCode: code, barcode: code, cellCode: cell.code, quantity, remainingAfter: remaining - quantity });
    }

    if (action === "correctLocation") {
      const onecMaterialId = clean(body.onecMaterialId);
      const cellId = clean(body.cellId);
      const newQuantity = num(body.newQuantity);
      const reason = clean(body.reason);
      if (!onecMaterialId || !cellId || newQuantity < 0) {
        return Response.json({ error: "Укажите материал, ячейку и новое количество" }, { status: 400 });
      }
      if (!reason) return Response.json({ error: "Укажите причину исправления" }, { status: 400 });

      const material = await materialById(db, onecMaterialId);
      if (!material?.linkedProductId) return Response.json({ error: "Материал ещё не размещён" }, { status: 404 });
      const productId = material.linkedProductId;
      const [product] = await db.select().from(products).where(eq(products.id, productId)).limit(1);
      if (!product) return Response.json({ error: "Связанный материал не найден" }, { status: 404 });
      const [cell] = await db.select().from(cells).where(eq(cells.id, cellId)).limit(1);
      if (!cell) return Response.json({ error: "Ячейка не найдена" }, { status: 404 });

      const [stock] = await db.select().from(stocks).where(sql`${stocks.productId} = ${productId} AND ${stocks.cellId} = ${cellId}`).limit(1);
      const oldQuantity = Number(stock?.quantity || 0);
      const delta = newQuantity - oldQuantity;
      if (Math.abs(delta) < 1e-9) return Response.json({ ok: true, unchanged: true });

      const totalBefore = await placedTotal(db, productId);
      const totalAfter = totalBefore - oldQuantity + newQuantity;
      if (delta > 0 && totalAfter > Number(material.available1c) + 1e-9) {
        return Response.json({ error: `После исправления получится ${totalAfter} шт., а доступно по 1С ${material.available1c} шт.` }, { status: 409 });
      }

      if (newQuantity <= 0) {
        if (stock) await db.delete(stocks).where(sql`${stocks.productId} = ${productId} AND ${stocks.cellId} = ${cellId}`);
      } else if (stock) {
        await db.update(stocks).set({ quantity: newQuantity, updatedAt: sql`CURRENT_TIMESTAMP` }).where(sql`${stocks.productId} = ${productId} AND ${stocks.cellId} = ${cellId}`);
      } else {
        await db.insert(stocks).values({ productId, cellId, quantity: newQuantity });
      }

      await db.insert(movements).values({
        id: crypto.randomUUID(),
        type: "Корректировка размещения",
        productId,
        cellId,
        quantity: delta,
        operator,
        source: "onec-correction",
        comment: `Исправление ${oldQuantity} → ${newQuantity}. Причина: ${reason}`,
      });
      await db.insert(activityLogs).values({
        id: crypto.randomUUID(),
        action: "Корректировка",
        entityType: "Материал",
        entityId: productId,
        entityName: `${material.name} (${product.sku})`,
        details: `${cell.code}: ${oldQuantity} → ${newQuantity} шт. · ${reason}`,
        operator,
      });

      return Response.json({
        ok: true,
        oldQuantity,
        newQuantity,
        delta,
        totalAfter,
        remainingAfter: Number(material.available1c) - totalAfter,
      });
    }

    return Response.json({ error: "Неизвестное действие" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Операция не выполнена" }, { status: 500 });
  }
}
