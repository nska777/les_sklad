import * as XLSX from "xlsx";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { activityLogs, products } from "@/db/schema";

export const dynamic = "force-dynamic";

const clean = (value: unknown) => String(value ?? "").trim();
const keyOf = (value: string) => value.trim().toLocaleLowerCase("ru-RU").replace(/\s+/g, " ");
const isNumericText = (value: string) => /^[-+]?\d+(?:[.,]\d+)?$/.test(value.replace(/\s/g, ""));

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows as T[];
  }
  return [];
}

function toNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = clean(value).replace(/\s/g, "").replace(",", ".");
  if (!text) return fallback;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function ensureTables(db: Awaited<ReturnType<typeof getDb>>) {
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
  await db.execute(sql`CREATE TABLE IF NOT EXISTS onec_imports (
    id text PRIMARY KEY,
    file_name text NOT NULL,
    mode text NOT NULL,
    row_count integer NOT NULL,
    imported_by text NOT NULL DEFAULT 'Кладовщик',
    created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
}

type ParsedItem = {
  sourceRow: number;
  name: string;
  quantity1c: number;
  reserved1c: number;
  available1c: number;
};

type Detection = {
  nameColumn: number;
  quantityColumn: number;
  reservedColumn: number;
  availableColumn: number;
};

function textLike(value: unknown) {
  const text = clean(value);
  return text.length >= 3 && !isNumericText(text);
}

function detectColumns(rows: unknown[][]): Detection {
  const maxColumns = Math.min(12, Math.max(0, ...rows.slice(0, 250).map((row) => row.length)));
  let bestName = -1;
  let bestScore = -1;

  for (let col = 0; col < maxColumns; col += 1) {
    let score = 0;
    for (const row of rows.slice(0, 250)) {
      const value = row?.[col];
      if (textLike(value)) score += 2;
      const text = clean(value).toLocaleLowerCase("ru-RU");
      if (text.includes("номенклатур") || text.includes("материал") || text.includes("наименован")) score += 30;
    }
    if (score > bestScore) {
      bestScore = score;
      bestName = col;
    }
  }

  if (bestName < 0) throw new Error("Не удалось определить колонку с названием материала");

  const numericScore = (col: number) => {
    let score = 0;
    for (const row of rows.slice(0, 300)) {
      if (Number.isFinite(toNumber(row?.[col], Number.NaN))) score += 1;
    }
    return score;
  };

  const candidates = [bestName + 1, bestName + 2, bestName + 3, bestName + 4]
    .filter((col) => col < maxColumns)
    .map((col) => ({ col, score: numericScore(col) }))
    .sort((a, b) => b.score - a.score);

  const ordered = candidates.map((item) => item.col).sort((a, b) => a - b);
  if (!ordered.length) throw new Error("Не удалось определить колонки количества");

  return {
    nameColumn: bestName,
    quantityColumn: ordered[0] ?? bestName + 1,
    reservedColumn: ordered[1] ?? bestName + 2,
    availableColumn: ordered[2] ?? bestName + 3,
  };
}

function parseWorkbook(buffer: ArrayBuffer): { items: ParsedItem[]; detection: Detection } {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: false });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!firstSheet) throw new Error("В Excel нет листов");

  const rows = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, {
    header: 1,
    defval: null,
    raw: true,
  });

  const detection = detectColumns(rows);
  const result: ParsedItem[] = [];
  const seen = new Set<string>();

  rows.forEach((row, index) => {
    const name = clean(row?.[detection.nameColumn]);
    if (!name || isNumericText(name)) return;

    const lower = name.toLocaleLowerCase("ru-RU");
    if (
      lower.includes("номенклатур") ||
      lower.includes("наименован") ||
      lower === "итого" ||
      lower.startsWith("итого ") ||
      lower.includes("всего")
    ) return;

    const quantity1c = toNumber(row?.[detection.quantityColumn], Number.NaN);
    const reserved1c = toNumber(row?.[detection.reservedColumn], 0);
    const availableRaw = toNumber(row?.[detection.availableColumn], Number.NaN);
    const available1c = Number.isFinite(availableRaw)
      ? availableRaw
      : Number.isFinite(quantity1c)
        ? quantity1c - reserved1c
        : Number.NaN;

    if (!Number.isFinite(quantity1c) && !Number.isFinite(available1c)) return;
    const normalized = keyOf(name);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);

    result.push({
      sourceRow: index + 1,
      name,
      quantity1c: Number.isFinite(quantity1c) ? quantity1c : available1c + reserved1c,
      reserved1c,
      available1c,
    });
  });

  if (result.length < 5) {
    throw new Error("Файл не похож на справочник материалов: найдено слишком мало корректных строк");
  }

  const suspicious = result.filter((item) => isNumericText(item.name)).length;
  if (suspicious > 0) {
    throw new Error("Импорт остановлен: в колонке названий обнаружены числовые итоговые строки");
  }

  return { items: result, detection };
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    const mode = clean(form.get("mode")) === "merge" ? "merge" : "replace";
    const operator = clean(form.get("operator")) || "Кладовщик";

    if (!(file instanceof File)) {
      return Response.json({ error: "Выберите Excel-файл" }, { status: 400 });
    }
    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      return Response.json({ error: "Нужен файл .xlsx или .xls" }, { status: 400 });
    }
    if (file.size > 15 * 1024 * 1024) {
      return Response.json({ error: "Файл слишком большой. Максимум 15 МБ" }, { status: 413 });
    }

    const { items, detection } = parseWorkbook(await file.arrayBuffer());
    const db = await getDb();
    await ensureTables(db);

    const existingResult = await db.execute(sql`
      SELECT id, name, linked_product_id AS "linkedProductId", source_row AS "sourceRow"
      FROM onec_materials
    `);
    const existing = rowsOf<{ id: string; name: string; linkedProductId: string | null; sourceRow: number }>(existingResult);
    const existingByName = new Map(existing.map((item) => [keyOf(item.name), item]));

    const linkedProducts = await db.select({ id: products.id, name: products.name, oneCId: products.oneCId }).from(products);
    const productByName = new Map(
      linkedProducts
        .filter((item) => item.oneCId)
        .map((item) => [keyOf(item.name), item.id]),
    );

    let inserted = 0;
    let updated = 0;
    let preservedLinks = 0;

    if (mode === "replace") {
      await db.execute(sql`DELETE FROM onec_materials`);
      for (const item of items) {
        const previous = existingByName.get(keyOf(item.name));
        const linkedProductId = previous?.linkedProductId || productByName.get(keyOf(item.name)) || null;
        if (linkedProductId) preservedLinks += 1;
        await db.execute(sql`
          INSERT INTO onec_materials (
            id, source_row, name, quantity_1c, reserved_1c, available_1c, linked_product_id
          ) VALUES (
            ${crypto.randomUUID()}, ${item.sourceRow}, ${item.name}, ${item.quantity1c}, ${item.reserved1c}, ${item.available1c}, ${linkedProductId}
          )
        `);
        inserted += 1;
      }
    } else {
      for (const item of items) {
        const previous = existingByName.get(keyOf(item.name));
        if (previous) {
          await db.execute(sql`
            UPDATE onec_materials
            SET quantity_1c = ${item.quantity1c},
                reserved_1c = ${item.reserved1c},
                available_1c = ${item.available1c}
            WHERE id = ${previous.id}
          `);
          updated += 1;
        } else {
          const linkedProductId = productByName.get(keyOf(item.name)) || null;
          if (linkedProductId) preservedLinks += 1;
          let sourceRow = item.sourceRow;
          const used = await db.execute(sql`SELECT 1 FROM onec_materials WHERE source_row = ${sourceRow} LIMIT 1`);
          if (rowsOf(used).length) {
            const maxResult = await db.execute(sql`SELECT COALESCE(MAX(source_row), 0)::int AS max FROM onec_materials`);
            sourceRow = Number(rowsOf<{ max: number }>(maxResult)[0]?.max || 0) + 1;
          }
          await db.execute(sql`
            INSERT INTO onec_materials (
              id, source_row, name, quantity_1c, reserved_1c, available_1c, linked_product_id
            ) VALUES (
              ${crypto.randomUUID()}, ${sourceRow}, ${item.name}, ${item.quantity1c}, ${item.reserved1c}, ${item.available1c}, ${linkedProductId}
            )
          `);
          inserted += 1;
        }
      }
    }

    await db.execute(sql`
      INSERT INTO onec_settings (key, value) VALUES ('initialized', '1')
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `);
    await db.execute(sql`
      INSERT INTO onec_imports (id, file_name, mode, row_count, imported_by)
      VALUES (${crypto.randomUUID()}, ${file.name}, ${mode}, ${items.length}, ${operator})
    `);
    await db.insert(activityLogs).values({
      id: crypto.randomUUID(),
      action: mode === "replace" ? "Замена справочника 1С" : "Обновление справочника 1С",
      entityType: "Справочник 1С",
      entityId: "onec-materials",
      entityName: file.name,
      details: `${items.length} строк · добавлено ${inserted} · обновлено ${updated} · связей сохранено ${preservedLinks}`,
      operator,
    });

    return Response.json({
      ok: true,
      fileName: file.name,
      mode,
      totalRows: items.length,
      inserted,
      updated,
      preservedLinks,
      detection,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось импортировать Excel" }, { status: 500 });
  }
}

export async function GET() {
  try {
    const db = await getDb();
    await ensureTables(db);
    const result = await db.execute(sql`
      SELECT id, file_name AS "fileName", mode, row_count AS "rowCount", imported_by AS "importedBy", created_at AS "createdAt"
      FROM onec_imports
      ORDER BY created_at DESC
      LIMIT 20
    `);
    return Response.json({ imports: rowsOf(result) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось загрузить историю импортов" }, { status: 500 });
  }
}
