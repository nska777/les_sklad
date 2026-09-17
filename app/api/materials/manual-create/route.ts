import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { activityLogs, cells, movements, products, stocks } from "@/db/schema";

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

async function nextCode(db: Awaited<ReturnType<typeof getDb>>) {
  const result = await db.execute(sql`SELECT sku FROM products WHERE sku ~ '^RL-[0-9]{6}$'`);
  let max = 0;
  for (const row of rowsOf<{ sku: string }>(result)) {
    const match = /^RL-(\d{6})$/i.exec(String(row.sku || ""));
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `RL-${String(max + 1).padStart(6, "0")}`;
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const name = clean(body.name);
    const quantity = num(body.quantity);
    const cellId = clean(body.cellId);
    const unit = clean(body.unit) || "шт.";
    const category = clean(body.category) || "Фурнитура";
    const operator = clean(body.operator) || decodeURIComponent(String(request.headers.get("x-warehouse-user") || "Кладовщик"));

    if (!name) return Response.json({ error: "Введите название материала" }, { status: 400 });
    if (!cellId) return Response.json({ error: "Выберите стеллаж, полку и ячейку" }, { status: 400 });
    if (!Number.isFinite(quantity) || quantity <= 0) return Response.json({ error: "Количество должно быть больше нуля" }, { status: 400 });

    const role = String(request.headers.get("x-warehouse-role") || "").trim();
    if (role === "viewer") return Response.json({ error: "Для роли «Просмотр» добавление недоступно" }, { status: 403 });

    const db = await getDb();
    const [cell] = await db.select().from(cells).where(eq(cells.id, cellId)).limit(1);
    if (!cell || cell.blocked) return Response.json({ error: "Выбранная ячейка недоступна" }, { status: 409 });

    const occupiedResult = await db.execute(sql`
      SELECT p.name AS "productName", p.sku, s.quantity::double precision AS quantity, p.unit
      FROM stocks s
      JOIN products p ON p.id = s.product_id
      WHERE s.cell_id = ${cellId} AND s.quantity > 0
      ORDER BY p.name
    `);
    const occupied = rowsOf<{ productName: string; sku: string; quantity: number; unit: string }>(occupiedResult);
    if (occupied.length) {
      const contents = occupied.map((row) => `${row.productName} (${row.sku}) — ${Number(row.quantity).toLocaleString("ru-RU", { maximumFractionDigits: 3 })} ${row.unit || "шт."}`).join(", ");
      return Response.json({ error: `Ячейка ${cell.code} уже занята: ${contents}. Выберите свободную ячейку.` }, { status: 409 });
    }

    const duplicateResult = await db.execute(sql`
      SELECT id, name, sku FROM products WHERE lower(trim(name)) = lower(trim(${name})) LIMIT 1
    `);
    const duplicate = rowsOf<{ id: string; name: string; sku: string }>(duplicateResult)[0];
    if (duplicate) {
      return Response.json({ error: `Материал «${duplicate.name}» уже существует (${duplicate.sku}). Используйте существующую карточку.` }, { status: 409 });
    }

    const productId = crypto.randomUUID();
    const code = await nextCode(db);

    await db.insert(products).values({
      id: productId,
      name,
      sku: code,
      barcode: code,
      category,
      unit,
      packQty: 1,
      imageUrl: "",
      minStock: 0,
      oneCId: null,
    });

    await db.insert(stocks).values({ productId, cellId, quantity });

    await db.insert(movements).values({
      id: crypto.randomUUID(),
      type: "Ручное поступление",
      productId,
      cellId,
      quantity,
      operator,
      source: "manual-material",
      comment: "Материал создан вручную вне справочника 1С и сразу размещён в ячейке",
    });

    await db.insert(activityLogs).values({
      id: crypto.randomUUID(),
      action: "Создание материала вручную",
      entityType: "Материал",
      entityId: productId,
      entityName: `${name} (${code})`,
      details: `${quantity} ${unit} → ${cell.code}. Присвоен RL-код и штрихкод ${code}. Материал не связан со справочником 1С.`,
      operator,
    });

    return Response.json({
      ok: true,
      product: { id: productId, name, sku: code, barcode: code, unit, category },
      placement: { cellId: cell.id, cellCode: cell.code, quantity },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось создать материал" }, { status: 500 });
  }
}
