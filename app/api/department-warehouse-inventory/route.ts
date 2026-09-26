import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { departmentInventorySnapshots } from "@/db/schema";
import { canAccessWarehouse, isWarehouseCode, verifySessionToken } from "@/lib/warehouse-auth";

export const dynamic = "force-dynamic";

const clean = (value: unknown) => String(value ?? "").trim();

export async function POST(request: NextRequest) {
  const session = await verifySessionToken(request.cookies.get("warehouse_session")?.value);
  if (!session) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  const code = request.headers.get("x-warehouse-code") || session.warehouse;
  if (!isWarehouseCode(code) || code === "hardware" || !canAccessWarehouse(session, code)) {
    return NextResponse.json({ error: "Нет доступа к складу" }, { status: 403 });
  }
  if (session.role === "viewer") return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });

  try {
    const body = await request.json() as Record<string, unknown>;
    if (clean(body.action) !== "delete") return NextResponse.json({ error: "Неизвестная операция" }, { status: 400 });
    const id = clean(body.id);
    if (!id) return NextResponse.json({ error: "Инвентаризация не выбрана" }, { status: 400 });
    const db = await getDb();
    const row = (await db.select({ id: departmentInventorySnapshots.id }).from(departmentInventorySnapshots).where(and(
      eq(departmentInventorySnapshots.id, id),
      eq(departmentInventorySnapshots.warehouseCode, code),
    )).limit(1))[0];
    if (!row) return NextResponse.json({ error: "Инвентаризация не найдена" }, { status: 404 });
    await db.delete(departmentInventorySnapshots).where(and(
      eq(departmentInventorySnapshots.id, id),
      eq(departmentInventorySnapshots.warehouseCode, code),
    ));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось удалить инвентаризацию" }, { status: 500 });
  }
}
