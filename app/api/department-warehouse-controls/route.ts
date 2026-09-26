import { and, eq, inArray, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import {
  departmentCells,
  departmentMixLines,
  departmentMovements,
  departmentProducts,
  departmentStocks,
} from "@/db/schema";
import { canAccessWarehouse, isWarehouseCode, verifySessionToken } from "@/lib/warehouse-auth";

export const dynamic = "force-dynamic";

const clean = (value: unknown) => String(value ?? "").trim();
const amount = (value: unknown) => {
  const n = Number(String(value ?? "").trim().replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

async function setStock(db: Awaited<ReturnType<typeof getDb>>, warehouseCode: string, productId: string, cellId: string, quantity: number) {
  const safe = Math.max(0, quantity);
  const existing = (await db.select().from(departmentStocks).where(and(
    eq(departmentStocks.warehouseCode, warehouseCode),
    eq(departmentStocks.productId, productId),
    eq(departmentStocks.cellId, cellId),
  )).limit(1))[0];

  if (existing) {
    if (safe <= 0) {
      await db.delete(departmentStocks).where(and(
        eq(departmentStocks.warehouseCode, warehouseCode),
        eq(departmentStocks.productId, productId),
        eq(departmentStocks.cellId, cellId),
      ));
    } else {
      await db.update(departmentStocks).set({ quantity: safe, updatedAt: new Date().toISOString() }).where(and(
        eq(departmentStocks.warehouseCode, warehouseCode),
        eq(departmentStocks.productId, productId),
        eq(departmentStocks.cellId, cellId),
      ));
    }
  } else if (safe > 0) {
    await db.insert(departmentStocks).values({ warehouseCode, productId, cellId, quantity: safe, updatedAt: new Date().toISOString() });
  }
}

async function ensureCellCapacity(db: Awaited<ReturnType<typeof getDb>>, warehouseCode: string, cellId: string, productId: string) {
  const rows = await db.select({ productId: departmentStocks.productId }).from(departmentStocks).where(and(
    eq(departmentStocks.warehouseCode, warehouseCode),
    eq(departmentStocks.cellId, cellId),
    sql`${departmentStocks.quantity} > 0`,
  ));
  const unique = new Set(rows.map((x) => x.productId));
  if (!unique.has(productId) && unique.size >= 5) {
    throw new Error("В одной ячейке можно хранить не более 5 разных материалов");
  }
}

export async function POST(request: NextRequest) {
  const session = await verifySessionToken(request.cookies.get("warehouse_session")?.value);
  if (!session) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });

  const code = request.headers.get("x-warehouse-code") || session.warehouse;
  if (!isWarehouseCode(code) || code === "hardware" || !canAccessWarehouse(session, code)) {
    return NextResponse.json({ error: "Нет доступа к складу" }, { status: 403 });
  }

  try {
    const db = await getDb();
    const body = await request.json() as Record<string, unknown>;
    const action = clean(body.action);

    if (action === "deleteProductAdmin") {
      if (session.role !== "admin") return NextResponse.json({ error: "Удаление доступно только администратору" }, { status: 403 });
      const productId = clean(body.productId);
      if (!productId) return NextResponse.json({ error: "Материал не выбран" }, { status: 400 });
      const product = (await db.select({ id: departmentProducts.id }).from(departmentProducts).where(and(
        eq(departmentProducts.id, productId),
        eq(departmentProducts.warehouseCode, code),
      )).limit(1))[0];
      if (!product) return NextResponse.json({ error: "Материал не найден" }, { status: 404 });

      await db.delete(departmentMixLines).where(eq(departmentMixLines.productId, productId));
      await db.delete(departmentMovements).where(and(eq(departmentMovements.warehouseCode, code), eq(departmentMovements.productId, productId)));
      await db.delete(departmentStocks).where(and(eq(departmentStocks.warehouseCode, code), eq(departmentStocks.productId, productId)));
      await db.delete(departmentProducts).where(and(eq(departmentProducts.warehouseCode, code), eq(departmentProducts.id, productId)));
      return NextResponse.json({ ok: true });
    }

    if (action === "placeProduct") {
      const productId = clean(body.productId), cellId = clean(body.cellId), quantity = amount(body.quantity);
      if (!productId || !cellId || quantity <= 0) return NextResponse.json({ error: "Проверьте материал, ячейку и количество" }, { status: 400 });
      const [product, cell] = await Promise.all([
        db.select().from(departmentProducts).where(and(eq(departmentProducts.id, productId), eq(departmentProducts.warehouseCode, code))).limit(1),
        db.select().from(departmentCells).where(and(eq(departmentCells.id, cellId), eq(departmentCells.warehouseCode, code))).limit(1),
      ]);
      if (!product[0] || !cell[0]) return NextResponse.json({ error: "Материал или ячейка не найдены" }, { status: 404 });
      await ensureCellCapacity(db, code, cellId, productId);
      const current = (await db.select({ quantity: departmentStocks.quantity }).from(departmentStocks).where(and(eq(departmentStocks.warehouseCode, code), eq(departmentStocks.productId, productId), eq(departmentStocks.cellId, cellId))).limit(1))[0];
      await setStock(db, code, productId, cellId, Number(current?.quantity || 0) + quantity);
      await db.insert(departmentMovements).values({
        id: crypto.randomUUID(), warehouseCode: code, type: "Размещение", productId,
        fromCellId: null, toCellId: cellId, quantity, recipient: "", comment: clean(body.comment) || "Размещение материала",
        operator: session.name || session.username, documentNumber: clean(body.documentNumber) || "РАЗМЕЩЕНИЕ",
        sourceName: "Материалы", sourceLocation: "Склад краски", batchId: "",
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "moveProduct") {
      const productId = clean(body.productId), fromCellId = clean(body.fromCellId), toCellId = clean(body.toCellId), quantity = amount(body.quantity);
      if (!productId || !fromCellId || !toCellId || quantity <= 0) return NextResponse.json({ error: "Проверьте материал, ячейки и количество" }, { status: 400 });
      if (fromCellId === toCellId) return NextResponse.json({ error: "Выберите другую ячейку назначения" }, { status: 400 });
      const [product, fromCell, toCell, source] = await Promise.all([
        db.select().from(departmentProducts).where(and(eq(departmentProducts.id, productId), eq(departmentProducts.warehouseCode, code))).limit(1),
        db.select().from(departmentCells).where(and(eq(departmentCells.id, fromCellId), eq(departmentCells.warehouseCode, code))).limit(1),
        db.select().from(departmentCells).where(and(eq(departmentCells.id, toCellId), eq(departmentCells.warehouseCode, code))).limit(1),
        db.select().from(departmentStocks).where(and(eq(departmentStocks.warehouseCode, code), eq(departmentStocks.productId, productId), eq(departmentStocks.cellId, fromCellId))).limit(1),
      ]);
      if (!product[0] || !fromCell[0] || !toCell[0]) return NextResponse.json({ error: "Материал или ячейка не найдены" }, { status: 404 });
      const available = Number(source[0]?.quantity || 0);
      if (available < quantity) return NextResponse.json({ error: `В исходной ячейке доступно ${available}` }, { status: 409 });
      await ensureCellCapacity(db, code, toCellId, productId);
      const target = (await db.select({ quantity: departmentStocks.quantity }).from(departmentStocks).where(and(eq(departmentStocks.warehouseCode, code), eq(departmentStocks.productId, productId), eq(departmentStocks.cellId, toCellId))).limit(1))[0];
      await setStock(db, code, productId, fromCellId, available - quantity);
      await setStock(db, code, productId, toCellId, Number(target?.quantity || 0) + quantity);
      await db.insert(departmentMovements).values({
        id: crypto.randomUUID(), warehouseCode: code, type: "Перемещение", productId,
        fromCellId, toCellId, quantity, recipient: "", comment: clean(body.comment), operator: session.name || session.username,
        documentNumber: clean(body.documentNumber), sourceName: "", sourceLocation: "", batchId: "",
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Неизвестная операция" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Операция не выполнена";
    const status = message.includes("не более 5") ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
