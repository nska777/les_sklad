import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { departmentInventorySnapshots } from "@/db/schema";
import { canAccessWarehouse, isWarehouseCode, verifySessionToken } from "@/lib/warehouse-auth";

export const dynamic = "force-dynamic";

const clean = (value: unknown) => String(value ?? "").trim();
const inventoryEditors = new Set(["roman", "artashes"]);

export async function POST(request: NextRequest) {
  const session = await verifySessionToken(request.cookies.get("warehouse_session")?.value);
  if (!session) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  const code = request.headers.get("x-warehouse-code") || session.warehouse;
  if (!isWarehouseCode(code) || code === "hardware" || !canAccessWarehouse(session, code)) {
    return NextResponse.json({ error: "Нет доступа к складу" }, { status: 403 });
  }

  try {
    const body = await request.json() as Record<string, unknown>;
    const action = clean(body.action);
    if (action !== "delete" && action !== "update") {
      return NextResponse.json({ error: "Неизвестная операция" }, { status: 400 });
    }

    if (!inventoryEditors.has(session.username.toLowerCase())) {
      return NextResponse.json({ error: "Удалять и редактировать инвентаризации могут только roman и artashes" }, { status: 403 });
    }

    const id = clean(body.id);
    if (!id) return NextResponse.json({ error: "Инвентаризация не выбрана" }, { status: 400 });
    const db = await getDb();
    const row = (await db.select().from(departmentInventorySnapshots).where(and(
      eq(departmentInventorySnapshots.id, id),
      eq(departmentInventorySnapshots.warehouseCode, code),
    )).limit(1))[0];
    if (!row) return NextResponse.json({ error: "Инвентаризация не найдена" }, { status: 404 });

    if (action === "delete") {
      await db.delete(departmentInventorySnapshots).where(and(
        eq(departmentInventorySnapshots.id, id),
        eq(departmentInventorySnapshots.warehouseCode, code),
      ));
      return NextResponse.json({ ok: true });
    }

    const rows = Array.isArray(body.rows) ? body.rows : null;
    if (!rows) return NextResponse.json({ error: "Не переданы строки инвентаризации" }, { status: 400 });
    const safeRows = rows.slice(0, 10000).map((value) => {
      const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
      const quantity = Number(item.quantity);
      return {
        productId: clean(item.productId),
        name: clean(item.name),
        sku: clean(item.sku),
        unit: clean(item.unit),
        cellId: clean(item.cellId),
        cellCode: clean(item.cellCode),
        quantity: Number.isFinite(quantity) && quantity >= 0 ? quantity : 0,
      };
    });

    await db.update(departmentInventorySnapshots)
      .set({ snapshotJson: JSON.stringify(safeRows) })
      .where(and(
        eq(departmentInventorySnapshots.id, id),
        eq(departmentInventorySnapshots.warehouseCode, code),
      ));

    return NextResponse.json({ ok: true, updated: safeRows.length });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось изменить инвентаризацию" }, { status: 500 });
  }
}
