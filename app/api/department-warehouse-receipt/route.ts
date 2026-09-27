import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { departmentCells, departmentMovements, departmentProducts, departmentRacks, departmentStocks } from "@/db/schema";
import { isWarehouseCode } from "@/lib/warehouse-auth";

export const dynamic = "force-dynamic";

const clean = (value: unknown) => String(value ?? "").trim();
const num = (value: unknown) => {
  const n = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
const allowedUnits = ["кг", "г", "мг", "л", "мл", "шт."] as const;

type Unit = typeof allowedUnits[number];

function ctx(request: NextRequest) {
  const warehouseCode = request.headers.get("x-warehouse-code");
  if (!isWarehouseCode(warehouseCode) || warehouseCode === "hardware") return null;
  return {
    warehouseCode,
    operator: decodeURIComponent(request.headers.get("x-warehouse-user") || "Кладовщик"),
  };
}

function generatedSku() {
  const now = new Date();
  const stamp = `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  return `PAINT-${stamp}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
}

function generatedBarcode() {
  return `${Date.now()}${Math.floor(Math.random() * 100000).toString().padStart(5, "0")}`;
}

function unitGroup(unit: string) {
  if (["кг", "г", "мг"].includes(unit)) return "mass";
  if (["л", "мл"].includes(unit)) return "volume";
  if (unit === "шт.") return "count";
  return "other";
}

function toBase(value: number, unit: Unit) {
  if (unit === "кг") return value * 1_000_000;
  if (unit === "г") return value * 1_000;
  if (unit === "мг") return value;
  if (unit === "л") return value * 1_000;
  if (unit === "мл") return value;
  return value;
}

function fromBase(value: number, unit: string) {
  if (unit === "кг") return value / 1_000_000;
  if (unit === "г") return value / 1_000;
  if (unit === "мг") return value;
  if (unit === "л") return value / 1_000;
  if (unit === "мл") return value;
  return value;
}

function convertQuantity(value: number, from: Unit, to: string) {
  if (from === to) return value;
  if (unitGroup(from) !== unitGroup(to)) return null;
  return fromBase(toBase(value, from), to);
}

async function getStock(db: Awaited<ReturnType<typeof getDb>>, warehouseCode: string, productId: string, cellId: string) {
  const row = (await db.select().from(departmentStocks).where(and(
    eq(departmentStocks.warehouseCode, warehouseCode),
    eq(departmentStocks.productId, productId),
    eq(departmentStocks.cellId, cellId),
  )).limit(1))[0];
  return Number(row?.quantity || 0);
}

async function setStock(db: Awaited<ReturnType<typeof getDb>>, warehouseCode: string, productId: string, cellId: string, quantity: number) {
  const existing = (await db.select().from(departmentStocks).where(and(
    eq(departmentStocks.warehouseCode, warehouseCode),
    eq(departmentStocks.productId, productId),
    eq(departmentStocks.cellId, cellId),
  )).limit(1))[0];
  if (existing) {
    await db.update(departmentStocks).set({ quantity, updatedAt: new Date().toISOString() }).where(and(
      eq(departmentStocks.warehouseCode, warehouseCode),
      eq(departmentStocks.productId, productId),
      eq(departmentStocks.cellId, cellId),
    ));
  } else {
    await db.insert(departmentStocks).values({ warehouseCode, productId, cellId, quantity, updatedAt: new Date().toISOString() });
  }
}

async function ensureUnplacedCell(db: Awaited<ReturnType<typeof getDb>>, warehouseCode: string) {
  const rackCode = "SYS_UNPLACED";
  let rack = (await db.select().from(departmentRacks).where(and(
    eq(departmentRacks.warehouseCode, warehouseCode),
    eq(departmentRacks.code, rackCode),
  )).limit(1))[0];
  if (!rack) {
    const rackId = crypto.randomUUID();
    await db.insert(departmentRacks).values({
      id: rackId, warehouseCode, name: "Ожидает размещения", code: rackCode,
      rows: 1, columns: 1, storageType: "system", width: 1, depth: 1,
      posX: 0, posZ: 0, rotation: 0, archived: true,
    });
    rack = (await db.select().from(departmentRacks).where(eq(departmentRacks.id, rackId)).limit(1))[0];
  }
  let cell = (await db.select().from(departmentCells).where(and(
    eq(departmentCells.warehouseCode, warehouseCode),
    eq(departmentCells.rackId, rack.id),
  )).limit(1))[0];
  if (!cell) {
    const id = crypto.randomUUID();
    await db.insert(departmentCells).values({
      id, warehouseCode, rackId: rack.id, code: "ОЖИДАЕТ-РАЗМЕЩЕНИЯ", label: "Ожидает размещения",
      rowIndex: 0, columnIndex: 0, blocked: true,
    });
    cell = (await db.select().from(departmentCells).where(eq(departmentCells.id, id)).limit(1))[0];
  }
  return cell;
}

export async function GET(request: NextRequest) {
  const context = ctx(request);
  if (!context) return NextResponse.json({ error: "Недоступное подразделение" }, { status: 403 });
  const db = await getDb();
  const [products, cells, racks] = await Promise.all([
    db.select().from(departmentProducts).where(and(eq(departmentProducts.warehouseCode, context.warehouseCode), eq(departmentProducts.archived, false))),
    db.select().from(departmentCells).where(eq(departmentCells.warehouseCode, context.warehouseCode)),
    db.select().from(departmentRacks).where(and(eq(departmentRacks.warehouseCode, context.warehouseCode), eq(departmentRacks.archived, false))),
  ]);
  const visibleRackIds = new Set(racks.map((r) => r.id));
  return NextResponse.json({
    products: products.map((p) => ({ id: p.id, name: p.name, sku: p.sku, unit: p.unit, category: p.category, brand: p.brand, color: p.color, ral: p.ral, packType: p.packType, packSize: p.packSize, minStock: p.minStock, comment: p.comment, createdAt: p.createdAt, source: p.source })),
    cells: cells.filter((c) => visibleRackIds.has(c.rackId) && !c.blocked).map((c) => ({ id: c.id, code: c.code, label: c.label })),
    units: allowedUnits,
  });
}

export async function POST(request: NextRequest) {
  const context = ctx(request);
  if (!context) return NextResponse.json({ error: "Недоступное подразделение" }, { status: 403 });
  const db = await getDb();
  const body = await request.json() as Record<string, unknown>;
  const action = clean(body.action) || "receive";

  if (action === "editProduct") {
    const id = clean(body.id);
    const product = (await db.select().from(departmentProducts).where(and(eq(departmentProducts.id, id), eq(departmentProducts.warehouseCode, context.warehouseCode))).limit(1))[0];
    if (!product) return NextResponse.json({ error: "Материал не найден" }, { status: 404 });
    const comment = clean(body.comment);
    if (!comment) return NextResponse.json({ error: "Комментарий обязателен" }, { status: 400 });
    const sku = clean(body.sku).toUpperCase() || product.sku;
    const duplicate = (await db.select({ id: departmentProducts.id }).from(departmentProducts).where(and(eq(departmentProducts.warehouseCode, context.warehouseCode), eq(departmentProducts.sku, sku))).limit(1))[0];
    if (duplicate && duplicate.id !== product.id) return NextResponse.json({ error: "Такой артикул уже используется" }, { status: 409 });
    await db.update(departmentProducts).set({
      name: clean(body.name) || product.name,
      sku,
      category: clean(body.category) || product.category,
      brand: clean(body.brand),
      color: clean(body.color),
      ral: clean(body.ral),
      unit: clean(body.unit) || product.unit,
      packType: clean(body.packType),
      packSize: Math.max(0, num(body.packSize)),
      minStock: Math.max(0, num(body.minStock)),
      comment,
    }).where(eq(departmentProducts.id, product.id));
    await db.insert(departmentMovements).values({
      id: crypto.randomUUID(), warehouseCode: context.warehouseCode, type: "Редактирование материала",
      productId: product.id, fromCellId: null, toCellId: null, quantity: 0, recipient: "",
      comment, operator: context.operator, documentNumber: "", sourceName: "", sourceLocation: "", batchId: "",
    });
    return NextResponse.json({ ok: true });
  }

  const documentNumber = clean(body.documentNumber);
  const sourceName = clean(body.sourceName);
  const quantityInput = num(body.quantity);
  const unit = clean(body.unit) as Unit;
  if (!documentNumber) return NextResponse.json({ error: "Укажите документ / накладную" }, { status: 400 });
  if (!(allowedUnits as readonly string[]).includes(unit)) return NextResponse.json({ error: "Выберите единицу измерения" }, { status: 400 });
  if (quantityInput <= 0) return NextResponse.json({ error: "Количество должно быть больше нуля" }, { status: 400 });

  let product = clean(body.productId)
    ? (await db.select().from(departmentProducts).where(and(eq(departmentProducts.id, clean(body.productId)), eq(departmentProducts.warehouseCode, context.warehouseCode), eq(departmentProducts.archived, false))).limit(1))[0]
    : undefined;

  let created = false;
  if (!product) {
    const newName = clean(body.newProductName);
    if (!newName) return NextResponse.json({ error: "Выберите материал или укажите новый" }, { status: 400 });
    const id = crypto.randomUUID();
    const sku = generatedSku();
    await db.insert(departmentProducts).values({
      id, warehouseCode: context.warehouseCode, name: newName, sku, barcode: generatedBarcode(),
      category: "Материалы", subcategory: "", brand: "", color: "", ral: "", unit,
      packType: "", packSize: 0, imageUrl: "", minStock: 0,
      comment: clean(body.comment) || `Создан через приход по документу ${documentNumber}`,
      oneCId: null, createdBy: context.operator, source: "receipt", archived: false,
    });
    product = (await db.select().from(departmentProducts).where(eq(departmentProducts.id, id)).limit(1))[0];
    created = true;
  }

  const storedQuantity = convertQuantity(quantityInput, unit, product.unit);
  if (storedQuantity === null) {
    return NextResponse.json({ error: `Нельзя принять ${unit} для материала с единицей учёта ${product.unit}` }, { status: 400 });
  }

  const requestedCellId = clean(body.cellId);
  let cell = requestedCellId
    ? (await db.select().from(departmentCells).where(and(eq(departmentCells.id, requestedCellId), eq(departmentCells.warehouseCode, context.warehouseCode))).limit(1))[0]
    : undefined;
  if (!cell) cell = await ensureUnplacedCell(db, context.warehouseCode);

  await setStock(db, context.warehouseCode, product.id, cell.id, await getStock(db, context.warehouseCode, product.id, cell.id) + storedQuantity);
  await db.insert(departmentMovements).values({
    id: crypto.randomUUID(), warehouseCode: context.warehouseCode, type: "Приход",
    productId: product.id, fromCellId: null, toCellId: cell.id, quantity: storedQuantity,
    recipient: "", comment: clean(body.comment), operator: context.operator,
    documentNumber, sourceName, sourceLocation: "", batchId: "",
  });

  return NextResponse.json({ ok: true, productId: product.id, created, unplaced: !requestedCellId, storedQuantity, storedUnit: product.unit });
}
