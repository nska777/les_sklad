import { sql } from "drizzle-orm";
import { getDb } from "@/db";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const db = await getDb();

    // Старые записи были сохранены в text через CURRENT_TIMESTAMP и могли иметь
    // вид `2026-09-12 13:00:00.123456+00`. Safari/JS не обязан понимать +00,
    // поэтому приводим все обычные timestamp-строки к одному UTC-формату.
    await db.execute(sql`
      UPDATE movements
      SET created_at = substring(replace(created_at, 'T', ' ') from 1 for 19)
      WHERE created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[ T][0-9]{2}:[0-9]{2}:[0-9]{2}'
        AND created_at <> substring(replace(created_at, 'T', ' ') from 1 for 19)
    `);

    // Нормализуем и все будущие движения независимо от того, какой API их создаёт.
    await db.execute(sql`
      CREATE OR REPLACE FUNCTION normalize_movement_created_at_text()
      RETURNS trigger AS $$
      BEGIN
        IF NEW.created_at IS NULL OR btrim(NEW.created_at) = '' THEN
          NEW.created_at := to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS');
        ELSE
          BEGIN
            NEW.created_at := to_char(NEW.created_at::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS');
          EXCEPTION WHEN others THEN
            NEW.created_at := substring(replace(NEW.created_at, 'T', ' ') from 1 for 19);
          END;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    await db.execute(sql`DROP TRIGGER IF EXISTS trg_normalize_movement_created_at ON movements`);
    await db.execute(sql`
      CREATE TRIGGER trg_normalize_movement_created_at
      BEFORE INSERT OR UPDATE OF created_at ON movements
      FOR EACH ROW
      EXECUTE FUNCTION normalize_movement_created_at_text()
    `);

    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось исправить даты движений" },
      { status: 500 },
    );
  }
}
