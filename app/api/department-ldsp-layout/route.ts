import { and, eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { departmentCells, departmentRacks, departmentStocks } from "@/db/schema";
import { canAccessWarehouse, verifySessionToken } from "@/lib/warehouse-auth";

export const dynamic = "force-dynamic";

const clean = (value: unknown) => String(value ?? "").trim();
const num = (value: unknown, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

async function requireLdsp(request: NextRequest) {
  const session = await verifySessionToken(request.cookies.get("warehouse_session")?.value);
  if (!session) return { error: NextResponse.json({ error: "Требуется вход" }, { status: 401 }) };
  if (!canAccessWarehouse(session, "ldsp")) return { error: NextResponse.json({ error: "Нет доступа к складу ЛДСП" }, { status: 403 }) };
  return { session };
}

export async function POST(request: NextRequest) {
  const auth = await requireLdsp(request);
  if ("error" in auth) return auth.error;

  try {
    const db = await getDb();
    const body = await request.json() as Record<string, unknown>;
    const action = clean(body.action);

    if (action === "createSector") {
      const code = clean(body.code).toUpperCase().replace(/[^A-ZА-Я0-9_-]/gi, "");
      const name = clean(body.name);
      const pallets = Math.max(1, Math.min(50, Math.floor(num(body.pallets, 4))));
      if (!code || !name) return NextResponse.json({ error: "Укажите код и название сектора" }, { status: 400 });

      const exists = (await db.select({ id: departmentRacks.id }).from(departmentRacks).where(and(
        eq(departmentRacks.warehouseCode, "ldsp"),
        eq(departmentRacks.code, code),
        eq(departmentRacks.archived, false),
      )).limit(1))[0];
      if (exists) return NextResponse.json({ error: "Сектор с таким кодом уже существует" }, { status: 409 });

      const id = crypto.randomUUID();
      await db.insert(departmentRacks).values({
        id,
        warehouseCode: "ldsp",
        name,
        code,
        rows: 1,
        columns: pallets,
        storageType: "ldsp-sector",
        width: Math.max(2.5, num(body.width, 5.4)),
        depth: Math.max(2.5, num(body.depth, 5.2)),
        posX: num(body.posX, 0),
        posZ: num(body.posZ, 0),
        rotation: 0,
        archived: false,
      });

      await db.insert(departmentCells).values(Array.from({ length: pallets }, (_, index) => ({
        id: crypto.randomUUID(),
        warehouseCode: "ldsp",
        rackId: id,
        code: `${code}-P${String(index + 1).padStart(2, "0")}`,
        label: `Паллета ${index + 1}`,
        rowIndex: 0,
        columnIndex: index,
        blocked: false,
      })));

      return NextResponse.json({ ok: true, sectorId: id });
    }

    if (action === "updateSector") {
      const id = clean(body.id);
      const sector = (await db.select().from(departmentRacks).where(and(
        eq(departmentRacks.id, id),
        eq(departmentRacks.warehouseCode, "ldsp"),
        eq(departmentRacks.storageType, "ldsp-sector"),
      )).limit(1))[0];
      if (!sector) return NextResponse.json({ error: "Сектор не найден" }, { status: 404 });

      await db.update(departmentRacks).set({
        name: clean(body.name) || sector.name,
        width: Math.max(2.5, num(body.width, sector.width)),
        depth: Math.max(2.5, num(body.depth, sector.depth)),
        posX: num(body.posX, sector.posX),
        posZ: num(body.posZ, sector.posZ),
      }).where(eq(departmentRacks.id, id));
      return NextResponse.json({ ok: true });
    }

    if (action === "addPallet") {
      const sectorId = clean(body.sectorId);
      const sector = (await db.select().from(departmentRacks).where(and(
        eq(departmentRacks.id, sectorId),
        eq(departmentRacks.warehouseCode, "ldsp"),
        eq(departmentRacks.storageType, "ldsp-sector"),
      )).limit(1))[0];
      if (!sector) return NextResponse.json({ error: "Сектор не найден" }, { status: 404 });

      const cells = await db.select().from(departmentCells).where(and(
        eq(departmentCells.warehouseCode, "ldsp"),
        eq(departmentCells.rackId, sectorId),
      ));
      const next = cells.length + 1;
      await db.insert(departmentCells).values({
        id: crypto.randomUUID(),
        warehouseCode: "ldsp",
        rackId: sectorId,
        code: `${sector.code}-P${String(next).padStart(2, "0")}`,
        label: clean(body.label) || `Паллета ${next}`,
        rowIndex: 0,
        columnIndex: next - 1,
        blocked: false,
      });
      await db.update(departmentRacks).set({ columns: next }).where(eq(departmentRacks.id, sectorId));
      return NextResponse.json({ ok: true });
    }

    if (action === "deletePallet") {
      const palletId = clean(body.palletId);
      const pallet = (await db.select().from(departmentCells).where(and(
        eq(departmentCells.id, palletId),
        eq(departmentCells.warehouseCode, "ldsp"),
      )).limit(1))[0];
      if (!pallet) return NextResponse.json({ error: "Паллета не найдена" }, { status: 404 });

      const stock = (await db.select({ quantity: departmentStocks.quantity }).from(departmentStocks).where(and(
        eq(departmentStocks.warehouseCode, "ldsp"),
        eq(departmentStocks.cellId, palletId),
        sql`${departmentStocks.quantity} > 0`,
      )).limit(1))[0];
      if (stock) return NextResponse.json({ error: "На паллете есть материал. Сначала переместите остатки." }, { status: 409 });

      await db.delete(departmentCells).where(eq(departmentCells.id, palletId));
      const left = await db.select({ id: departmentCells.id }).from(departmentCells).where(and(
        eq(departmentCells.warehouseCode, "ldsp"),
        eq(departmentCells.rackId, pallet.rackId),
      ));
      await db.update(departmentRacks).set({ columns: Math.max(1, left.length) }).where(eq(departmentRacks.id, pallet.rackId));
      return NextResponse.json({ ok: true });
    }

    if (action === "deleteSector") {
      const sectorId = clean(body.sectorId);
      const cells = await db.select({ id: departmentCells.id }).from(departmentCells).where(and(
        eq(departmentCells.warehouseCode, "ldsp"),
        eq(departmentCells.rackId, sectorId),
      ));
      const stockRows = await db.select().from(departmentStocks).where(eq(departmentStocks.warehouseCode, "ldsp"));
      const cellIds = new Set(cells.map((c) => c.id));
      if (stockRows.some((s) => cellIds.has(s.cellId) && Number(s.quantity) > 0)) {
        return NextResponse.json({ error: "В секторе есть материалы. Сначала переместите остатки." }, { status: 409 });
      }
      await db.update(departmentRacks).set({ archived: true }).where(and(eq(departmentRacks.id, sectorId), eq(departmentRacks.warehouseCode, "ldsp")));
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Неизвестная операция" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Операция не выполнена" }, { status: 500 });
  }
}
