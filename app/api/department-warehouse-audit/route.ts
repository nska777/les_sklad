import { and, eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { departmentCells, departmentMovements, departmentProducts, departmentStocks } from "@/db/schema";
import { isWarehouseCode } from "@/lib/warehouse-auth";

export const dynamic = "force-dynamic";

const clean = (value: unknown) => String(value ?? "").trim();

function context(request: NextRequest) {
  const warehouseCode = request.headers.get("x-warehouse-code");
  if (!isWarehouseCode(warehouseCode) || warehouseCode === "hardware") return null;
  return {
    warehouseCode,
    operator: decodeURIComponent(request.headers.get("x-warehouse-user") || "Кладовщик"),
  };
}

export async function POST(request: NextRequest) {
  const ctx = context(request);
  if (!ctx) return NextResponse.json({ error: "Недоступное подразделение" }, { status: 403 });

  try {
    const db = await getDb();
    const body = await request.json() as Record<string, unknown>;
    const action = clean(body.action);

    if (action === "productCreated") {
      const productId = clean(body.productId);
      const product = (await db.select().from(departmentProducts).where(and(
        eq(departmentProducts.id, productId),
        eq(departmentProducts.warehouseCode, ctx.warehouseCode),
      )).limit(1))[0];
      if (!product) return NextResponse.json({ error: "Материал не найден" }, { status: 404 });

      await db.insert(departmentMovements).values({
        id: crypto.randomUUID(),
        warehouseCode: ctx.warehouseCode,
        type: "Создание материала",
        productId: product.id,
        fromCellId: null,
        toCellId: null,
        quantity: 0,
        recipient: "",
        comment: clean(body.comment) || product.comment || "Материал добавлен вручную",
        operator: ctx.operator,
        documentNumber: "",
        sourceName: "Ручное добавление",
        sourceLocation: "Материалы",
        batchId: "",
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "inventoryCreated") {
      const stocks = await db.select().from(departmentStocks).where(and(
        eq(departmentStocks.warehouseCode, ctx.warehouseCode),
        sql`${departmentStocks.quantity} > 0`,
      ));
      const cells = await db.select({ id: departmentCells.id }).from(departmentCells).where(eq(departmentCells.warehouseCode, ctx.warehouseCode));
      const validCells = new Set(cells.map((cell) => cell.id));
      let logged = 0;

      for (const stock of stocks) {
        if (!validCells.has(stock.cellId)) continue;
        await db.insert(departmentMovements).values({
          id: crypto.randomUUID(),
          warehouseCode: ctx.warehouseCode,
          type: "Инвентаризация",
          productId: stock.productId,
          fromCellId: stock.cellId,
          toCellId: stock.cellId,
          quantity: Number(stock.quantity),
          recipient: "",
          comment: clean(body.comment) || "Зафиксирован остаток инвентаризации",
          operator: ctx.operator,
          documentNumber: clean(body.inventoryId),
          sourceName: "Инвентаризация",
          sourceLocation: "Склад",
          batchId: clean(body.inventoryId),
        });
        logged += 1;
      }
      return NextResponse.json({ ok: true, logged });
    }

    return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось записать действие" }, { status: 500 });
  }
}
