import { sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { verifySessionToken } from "@/lib/warehouse-auth";

export const dynamic = "force-dynamic";

const clean = (value: unknown) => String(value ?? "").trim();
const num = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

type ProgressRow = {
  document_id: string;
  line_id: string;
  product_verified: boolean;
  cell_id: string;
  cell_code: string;
  quantity: number;
  quantity_verified: boolean;
  updated_by: string;
  updated_at: string;
};

async function ensureTable(db: Awaited<ReturnType<typeof getDb>>) {
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS warehouse_issue_live_progress (
      document_id text NOT NULL,
      line_id text NOT NULL,
      product_verified boolean NOT NULL DEFAULT false,
      cell_id text NOT NULL DEFAULT '',
      cell_code text NOT NULL DEFAULT '',
      quantity double precision NOT NULL DEFAULT 0,
      quantity_verified boolean NOT NULL DEFAULT false,
      updated_by text NOT NULL DEFAULT '',
      updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (document_id, line_id)
    )
  `));
}

function rowsOf(result: unknown): ProgressRow[] {
  if (Array.isArray(result)) return result as ProgressRow[];
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    return Array.isArray(rows) ? rows as ProgressRow[] : [];
  }
  return [];
}

export async function GET(request: NextRequest) {
  const session = await verifySessionToken(request.cookies.get("warehouse_session")?.value);
  if (!session) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });

  try {
    const db = await getDb();
    await ensureTable(db);
    const documentId = clean(request.nextUrl.searchParams.get("documentId"));
    const result = documentId
      ? await db.execute(sql`SELECT document_id, line_id, product_verified, cell_id, cell_code, quantity, quantity_verified, updated_by, updated_at FROM warehouse_issue_live_progress WHERE document_id = ${documentId} ORDER BY updated_at DESC`)
      : await db.execute(sql`SELECT document_id, line_id, product_verified, cell_id, cell_code, quantity, quantity_verified, updated_by, updated_at FROM warehouse_issue_live_progress ORDER BY updated_at DESC LIMIT 100`);

    return NextResponse.json({ ok: true, progress: rowsOf(result).map((row) => ({
      documentId: row.document_id,
      lineId: row.line_id,
      productVerified: Boolean(row.product_verified),
      cellId: row.cell_id || "",
      cellCode: row.cell_code || "",
      quantity: Number(row.quantity || 0),
      quantityVerified: Boolean(row.quantity_verified),
      updatedBy: row.updated_by || "",
      updatedAt: row.updated_at,
    })) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось получить прогресс выдачи" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await verifySessionToken(request.cookies.get("warehouse_session")?.value);
  if (!session) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });

  try {
    const body = await request.json() as Record<string, unknown>;
    const documentId = clean(body.documentId);
    const lineId = clean(body.lineId);
    if (!documentId || !lineId) return NextResponse.json({ error: "Не указан документ или позиция" }, { status: 400 });

    const productVerified = Boolean(body.productVerified);
    const cellId = clean(body.cellId);
    const cellCode = clean(body.cellCode);
    const quantity = Math.max(0, num(body.quantity));
    const quantityVerified = Boolean(body.quantityVerified);
    const updatedBy = session.name || session.username;

    const db = await getDb();
    await ensureTable(db);
    await db.execute(sql`
      INSERT INTO warehouse_issue_live_progress
        (document_id, line_id, product_verified, cell_id, cell_code, quantity, quantity_verified, updated_by, updated_at)
      VALUES
        (${documentId}, ${lineId}, ${productVerified}, ${cellId}, ${cellCode}, ${quantity}, ${quantityVerified}, ${updatedBy}, CURRENT_TIMESTAMP)
      ON CONFLICT (document_id, line_id) DO UPDATE SET
        product_verified = EXCLUDED.product_verified,
        cell_id = EXCLUDED.cell_id,
        cell_code = EXCLUDED.cell_code,
        quantity = EXCLUDED.quantity,
        quantity_verified = EXCLUDED.quantity_verified,
        updated_by = EXCLUDED.updated_by,
        updated_at = CURRENT_TIMESTAMP
    `);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось сохранить прогресс выдачи" }, { status: 500 });
  }
}
