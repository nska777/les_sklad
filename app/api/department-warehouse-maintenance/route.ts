import { and, eq, inArray, or, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import {
  departmentCells,
  departmentInventorySnapshots,
  departmentMixLines,
  departmentMixes,
  departmentMovements,
  departmentProducts,
  departmentRacks,
  departmentStocks,
} from "@/db/schema";
import { isWarehouseCode } from "@/lib/warehouse-auth";

export const dynamic = "force-dynamic";

const clean = (value: unknown) => String(value ?? "").trim();
const amount = (value: unknown) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const normalized = String(value ?? "").trim().replace(/\s/g, "").replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
};
const autoBarcode = () => `${Date.now()}${Math.floor(Math.random() * 100000).toString().padStart(5, "0")}`;

function context(request: NextRequest) {
  const code = request.headers.get("x-warehouse-code");
  if (!isWarehouseCode(code) || code === "hardware") return null;
  return { warehouseCode: code, operator: decodeURIComponent(request.headers.get("x-warehouse-user") || "Кладовщик") };
}

async function ensureIncomingCell(db: Awaited<ReturnType<typeof getDb>>, warehouseCode: string) {
  const rackCode = "__1C_INCOMING__";
  let rack = (await db.select().from(departmentRacks).where(and(eq(departmentRacks.warehouseCode, warehouseCode), eq(departmentRacks.code, rackCode))).limit(1))[0];
  if (!rack) {
    const id = crypto.randomUUID();
    await db.insert(departmentRacks).values({
      id,
      warehouseCode,
      name: "Приёмка 1С",
      code: rackCode,
      rows: 1,
      columns: 1,
      storageType: "incoming",
      width: 1,
      depth: 1,
      archived: true,
    });
    rack = (await db.select().from(departmentRacks).where(eq(departmentRacks.id, id)).limit(1))[0];
  }
  let cell = (await db.select().from(departmentCells).where(and(eq(departmentCells.warehouseCode, warehouseCode), eq(departmentCells.rackId, rack.id))).limit(1))[0];
  if (!cell) {
    const id = crypto.randomUUID();
    await db.insert(departmentCells).values({
      id,
      warehouseCode,
      rackId: rack.id,
      code: "ПРИЁМКА-1С",
      label: "Не размещено / остаток 1С",
      rowIndex: 0,
      columnIndex: 0,
      blocked: false,
    });
    cell = (await db.select().from(departmentCells).where(eq(departmentCells.id, id)).limit(1))[0];
  }
  return cell;
}

export async function POST(request: NextRequest) {
  const ctx = context(request);
  if (!ctx) return NextResponse.json({ error: "Недоступное подразделение" }, { status: 403 });

  try {
    const db = await getDb();
    const body = await request.json() as Record<string, unknown>;
    const action = clean(body.action);

    if (action === "hardDeleteRack") {
      const id = clean(body.id);
      const rack = (await db.select().from(departmentRacks).where(and(eq(departmentRacks.id, id), eq(departmentRacks.warehouseCode, ctx.warehouseCode))).limit(1))[0];
      if (!rack) return NextResponse.json({ error: "Место хранения не найдено" }, { status: 404 });
      if (rack.code === "__1C_INCOMING__") return NextResponse.json({ error: "Системную зону приёмки удалить нельзя" }, { status: 409 });

      const rackCells = await db.select({ id: departmentCells.id }).from(departmentCells).where(and(eq(departmentCells.warehouseCode, ctx.warehouseCode), eq(departmentCells.rackId, id)));
      const cellIds = rackCells.map((c) => c.id);
      if (cellIds.length) {
        await db.delete(departmentMixLines).where(inArray(departmentMixLines.cellId, cellIds));
        await db.delete(departmentMovements).where(and(eq(departmentMovements.warehouseCode, ctx.warehouseCode), or(inArray(departmentMovements.fromCellId, cellIds), inArray(departmentMovements.toCellId, cellIds))));
        await db.delete(departmentStocks).where(and(eq(departmentStocks.warehouseCode, ctx.warehouseCode), inArray(departmentStocks.cellId, cellIds)));
        await db.delete(departmentCells).where(and(eq(departmentCells.warehouseCode, ctx.warehouseCode), eq(departmentCells.rackId, id)));
      }
      await db.delete(departmentRacks).where(and(eq(departmentRacks.id, id), eq(departmentRacks.warehouseCode, ctx.warehouseCode)));
      return NextResponse.json({ ok: true, deletedRack: id, deletedCells: cellIds.length });
    }

    if (action === "hardDeleteProducts") {
      const ids = Array.isArray(body.ids) ? body.ids.map(clean).filter(Boolean) : [clean(body.id)].filter(Boolean);
      if (!ids.length) return NextResponse.json({ error: "Материалы не выбраны" }, { status: 400 });
      const owned = await db.select({ id: departmentProducts.id }).from(departmentProducts).where(and(eq(departmentProducts.warehouseCode, ctx.warehouseCode), inArray(departmentProducts.id, ids)));
      const ownedIds = owned.map((x) => x.id);
      if (!ownedIds.length) return NextResponse.json({ ok: true, deleted: 0 });
      await db.delete(departmentMixLines).where(inArray(departmentMixLines.productId, ownedIds));
      await db.delete(departmentMovements).where(and(eq(departmentMovements.warehouseCode, ctx.warehouseCode), inArray(departmentMovements.productId, ownedIds)));
      await db.delete(departmentStocks).where(and(eq(departmentStocks.warehouseCode, ctx.warehouseCode), inArray(departmentStocks.productId, ownedIds)));
      await db.delete(departmentProducts).where(and(eq(departmentProducts.warehouseCode, ctx.warehouseCode), inArray(departmentProducts.id, ownedIds)));
      return NextResponse.json({ ok: true, deleted: ownedIds.length });
    }

    if (action === "purgeArchived") {
      const archived = await db.select({ id: departmentRacks.id }).from(departmentRacks).where(and(eq(departmentRacks.warehouseCode, ctx.warehouseCode), eq(departmentRacks.archived, true)));
      let deleted = 0;
      for (const rack of archived) {
        const row = (await db.select({ code: departmentRacks.code }).from(departmentRacks).where(eq(departmentRacks.id, rack.id)).limit(1))[0];
        if (row?.code === "__1C_INCOMING__") continue;
        const cells = await db.select({ id: departmentCells.id }).from(departmentCells).where(eq(departmentCells.rackId, rack.id));
        const cellIds = cells.map((c) => c.id);
        if (cellIds.length) {
          await db.delete(departmentMixLines).where(inArray(departmentMixLines.cellId, cellIds));
          await db.delete(departmentMovements).where(and(eq(departmentMovements.warehouseCode, ctx.warehouseCode), or(inArray(departmentMovements.fromCellId, cellIds), inArray(departmentMovements.toCellId, cellIds))));
          await db.delete(departmentStocks).where(and(eq(departmentStocks.warehouseCode, ctx.warehouseCode), inArray(departmentStocks.cellId, cellIds)));
          await db.delete(departmentCells).where(eq(departmentCells.rackId, rack.id));
        }
        await db.delete(departmentRacks).where(eq(departmentRacks.id, rack.id));
        deleted += 1;
      }
      return NextResponse.json({ ok: true, deleted });
    }

    if (action === "clearMovements") {
      await db.delete(departmentMixLines).where(sql`${departmentMixLines.mixId} IN (SELECT id FROM department_mixes WHERE warehouse_code = ${ctx.warehouseCode})`);
      await db.delete(departmentMixes).where(eq(departmentMixes.warehouseCode, ctx.warehouseCode));
      await db.delete(departmentMovements).where(eq(departmentMovements.warehouseCode, ctx.warehouseCode));
      await db.delete(departmentInventorySnapshots).where(eq(departmentInventorySnapshots.warehouseCode, ctx.warehouseCode));
      return NextResponse.json({ ok: true });
    }

    if (action === "import1c") {
      const items = Array.isArray(body.items) ? body.items as Array<Record<string, unknown>> : [];
      if (!items.length) return NextResponse.json({ error: "В файле нет строк" }, { status: 400 });
      const incomingCell = await ensureIncomingCell(db, ctx.warehouseCode);
      let created = 0, updated = 0, quantities = 0;

      for (const item of items.slice(0, 5000)) {
        const name = clean(item.name);
        if (!name) continue;
        const skuRaw = clean(item.sku).toUpperCase();
        const oneCId = clean(item.oneCId);
        let existing = skuRaw ? (await db.select().from(departmentProducts).where(and(eq(departmentProducts.warehouseCode, ctx.warehouseCode), eq(departmentProducts.sku, skuRaw))).limit(1))[0] : undefined;
        if (!existing && oneCId) existing = (await db.select().from(departmentProducts).where(and(eq(departmentProducts.warehouseCode, ctx.warehouseCode), eq(departmentProducts.oneCId, oneCId))).limit(1))[0];
        if (!existing) existing = (await db.select().from(departmentProducts).where(and(eq(departmentProducts.warehouseCode, ctx.warehouseCode), eq(departmentProducts.name, name))).limit(1))[0];

        const sku = skuRaw || existing?.sku || `1C-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
        const values = {
          name,
          sku,
          barcode: clean(item.barcode) || existing?.barcode || autoBarcode(),
          category: clean(item.category) || existing?.category || "Краска",
          subcategory: clean(item.subcategory) || existing?.subcategory || "",
          brand: clean(item.brand) || existing?.brand || "",
          color: clean(item.color) || existing?.color || "",
          ral: clean(item.ral) || existing?.ral || "",
          unit: clean(item.unit) || existing?.unit || "кг",
          packType: clean(item.packType) || existing?.packType || "",
          packSize: Math.max(0, amount(item.packSize ?? existing?.packSize ?? 0)),
          imageUrl: clean(item.imageUrl) || existing?.imageUrl || "",
          minStock: Math.max(0, amount(item.minStock ?? existing?.minStock ?? 0)),
          comment: clean(item.comment) || existing?.comment || "",
          oneCId: oneCId || existing?.oneCId || null,
          createdBy: existing?.createdBy || ctx.operator,
          source: "1c",
          archived: false,
        };

        let productId: string;
        if (existing) {
          productId = existing.id;
          await db.update(departmentProducts).set(values).where(eq(departmentProducts.id, existing.id));
          updated += 1;
        } else {
          productId = crypto.randomUUID();
          await db.insert(departmentProducts).values({ id: productId, warehouseCode: ctx.warehouseCode, ...values });
          created += 1;
        }

        if (item.quantity !== undefined && item.quantity !== null && clean(item.quantity) !== "") {
          const qty = Math.max(0, amount(item.quantity));
          const current = (await db.select().from(departmentStocks).where(and(eq(departmentStocks.warehouseCode, ctx.warehouseCode), eq(departmentStocks.productId, productId), eq(departmentStocks.cellId, incomingCell.id))).limit(1))[0];
          if (current) {
            if (qty > 0) await db.update(departmentStocks).set({ quantity: qty, updatedAt: new Date().toISOString() }).where(and(eq(departmentStocks.warehouseCode, ctx.warehouseCode), eq(departmentStocks.productId, productId), eq(departmentStocks.cellId, incomingCell.id)));
            else await db.delete(departmentStocks).where(and(eq(departmentStocks.warehouseCode, ctx.warehouseCode), eq(departmentStocks.productId, productId), eq(departmentStocks.cellId, incomingCell.id)));
          } else if (qty > 0) {
            await db.insert(departmentStocks).values({ warehouseCode: ctx.warehouseCode, productId, cellId: incomingCell.id, quantity: qty, updatedAt: new Date().toISOString() });
          }
          quantities += 1;
        }
      }

      return NextResponse.json({ ok: true, created, updated, quantities });
    }

    return NextResponse.json({ error: "Неизвестная операция" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Операция не выполнена" }, { status: 500 });
  }
}
