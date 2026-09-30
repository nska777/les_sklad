import { and, eq, or, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import {
  cells,
  departmentCells,
  departmentMovements,
  departmentProducts,
  departmentStocks,
  movements,
  products,
  stocks,
} from "@/db/schema";
import {
  apiError,
  clean,
  ensureOnecIntegrationSchema,
  getOnecOrderByDocumentId,
  onecIntegrationOperations,
  onecIntegrationOrderLines,
  positiveAmount,
  recalculateOnecOrderStatus,
  writeOnecLog,
} from "@/lib/onec-integration-api";
import { canAccessWarehouse, canWrite, isWarehouseCode, verifySessionToken } from "@/lib/warehouse-auth";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ documentId: string }> };

type StockSlice = { cellId: string; quantity: number; cellCode: string };

type ProductMatch = {
  id: string;
  name: string;
  sku: string;
  unit: string;
  stock: StockSlice[];
};

async function findProduct(warehouseCode: string, oneCProductId: string, sku: string): Promise<ProductMatch | null> {
  const db = await getDb();

  if (warehouseCode === "hardware") {
    const rows = await db.select().from(products).where(or(
      eq(products.oneCId, oneCProductId),
      ...(sku ? [eq(products.sku, sku)] : []),
    )).limit(1);
    const product = rows[0];
    if (!product) return null;
    const stockRows = await db.select({ cellId: stocks.cellId, quantity: stocks.quantity, cellCode: cells.code })
      .from(stocks)
      .innerJoin(cells, eq(cells.id, stocks.cellId))
      .where(and(eq(stocks.productId, product.id), sql`${stocks.quantity} > 0`));
    return {
      id: product.id,
      name: product.name,
      sku: product.sku,
      unit: product.unit,
      stock: stockRows.map((row) => ({ cellId: row.cellId, quantity: Number(row.quantity || 0), cellCode: row.cellCode })),
    };
  }

  const rows = await db.select().from(departmentProducts).where(and(
    eq(departmentProducts.warehouseCode, warehouseCode),
    or(
      eq(departmentProducts.oneCId, oneCProductId),
      ...(sku ? [eq(departmentProducts.sku, sku)] : []),
    ),
  )).limit(1);
  const product = rows[0];
  if (!product) return null;
  const stockRows = await db.select({ cellId: departmentStocks.cellId, quantity: departmentStocks.quantity, cellCode: departmentCells.code })
    .from(departmentStocks)
    .innerJoin(departmentCells, eq(departmentCells.id, departmentStocks.cellId))
    .where(and(
      eq(departmentStocks.warehouseCode, warehouseCode),
      eq(departmentStocks.productId, product.id),
      sql`${departmentStocks.quantity} > 0`,
    ));
  return {
    id: product.id,
    name: product.name,
    sku: product.sku,
    unit: product.unit,
    stock: stockRows.map((row) => ({ cellId: row.cellId, quantity: Number(row.quantity || 0), cellCode: row.cellCode })),
  };
}

async function deductRealStock(input: {
  warehouseCode: string;
  product: ProductMatch;
  quantity: number;
  documentNumber: string;
  documentId: string;
  recipient: string;
  operator: string;
}) {
  const db = await getDb();
  let left = input.quantity;
  const deductions: Array<{ cellId: string; cellCode: string; quantity: number }> = [];

  for (const slice of input.product.stock) {
    if (left <= 1e-9) break;
    const take = Math.min(left, slice.quantity);
    if (take <= 0) continue;
    const next = Math.max(0, slice.quantity - take);

    if (input.warehouseCode === "hardware") {
      if (next <= 1e-9) {
        await db.delete(stocks).where(and(eq(stocks.productId, input.product.id), eq(stocks.cellId, slice.cellId)));
      } else {
        await db.update(stocks).set({ quantity: next, updatedAt: new Date().toISOString() }).where(and(eq(stocks.productId, input.product.id), eq(stocks.cellId, slice.cellId)));
      }
      await db.insert(movements).values({
        id: crypto.randomUUID(),
        type: "Выдача",
        productId: input.product.id,
        cellId: slice.cellId,
        quantity: take,
        operator: input.operator,
        source: "1c-integration",
        documentId: null,
        recipient: input.recipient,
        comment: `1С ${input.documentNumber}; documentId=${input.documentId}`,
      });
    } else {
      if (next <= 1e-9) {
        await db.delete(departmentStocks).where(and(
          eq(departmentStocks.warehouseCode, input.warehouseCode),
          eq(departmentStocks.productId, input.product.id),
          eq(departmentStocks.cellId, slice.cellId),
        ));
      } else {
        await db.update(departmentStocks).set({ quantity: next, updatedAt: new Date().toISOString() }).where(and(
          eq(departmentStocks.warehouseCode, input.warehouseCode),
          eq(departmentStocks.productId, input.product.id),
          eq(departmentStocks.cellId, slice.cellId),
        ));
      }
      await db.insert(departmentMovements).values({
        id: crypto.randomUUID(),
        warehouseCode: input.warehouseCode,
        type: "Выдача",
        productId: input.product.id,
        fromCellId: slice.cellId,
        toCellId: null,
        quantity: take,
        recipient: input.recipient,
        comment: `Выдача по заданию 1С ${input.documentNumber}`,
        operator: input.operator,
        documentNumber: input.documentNumber,
        sourceName: "1С",
        sourceLocation: "",
        batchId: input.documentId,
      });
    }

    deductions.push({ cellId: slice.cellId, cellCode: slice.cellCode, quantity: take });
    left -= take;
  }

  return { issued: Math.max(0, input.quantity - left), deductions };
}

export async function POST(request: NextRequest, context: RouteContext) {
  const session = await verifySessionToken(request.cookies.get("warehouse_session")?.value);
  if (!session || !canWrite(session.role)) {
    return NextResponse.json(apiError("AUTH_FAILED", "Требуется авторизация кладовщика с правом выдачи"), { status: 401 });
  }

  const { documentId: rawDocumentId } = await context.params;
  const documentId = decodeURIComponent(rawDocumentId || "").trim();
  if (!documentId) return NextResponse.json(apiError("DOCUMENT_ID_REQUIRED", "Не указан documentId"), { status: 400 });

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const lineId = clean(body.lineId);
  const requestedQuantity = positiveAmount(body.quantity);
  const operationId = clean(body.operationId) || crypto.randomUUID();
  if (!lineId) return NextResponse.json(apiError("LINE_ID_REQUIRED", "Не указан lineId"), { status: 400 });
  if (!requestedQuantity) return NextResponse.json(apiError("INVALID_QUANTITY", "Количество должно быть больше 0"), { status: 400 });

  try {
    const current = await getOnecOrderByDocumentId(documentId);
    if (!current) return NextResponse.json(apiError("DOCUMENT_NOT_FOUND", "Документ 1С не найден"), { status: 404 });
    if (!isWarehouseCode(current.order.warehouseCode) || !canAccessWarehouse(session, current.order.warehouseCode)) {
      return NextResponse.json(apiError("WAREHOUSE_ACCESS_DENIED", "Нет доступа к складу этого задания"), { status: 403 });
    }
    if (current.order.operation !== "issue") return NextResponse.json(apiError("INVALID_OPERATION", "Это задание не является выдачей"), { status: 409 });
    if (["completed", "cancelled"].includes(current.order.status)) return NextResponse.json(apiError("DOCUMENT_CLOSED", "Документ уже закрыт"), { status: 409 });

    const line = current.lines.find((row) => row.lineId === lineId);
    if (!line) return NextResponse.json(apiError("LINE_NOT_FOUND", "Строка задания не найдена"), { status: 404 });

    const integrationDb = await ensureOnecIntegrationSchema();
    const duplicate = (await integrationDb.select().from(onecIntegrationOperations).where(eq(onecIntegrationOperations.operationId, operationId)).limit(1))[0];
    if (duplicate) return NextResponse.json({ ok: true, duplicate: true, operationId, documentId, status: current.order.status });

    const remaining = Number(line.remainingQuantity || 0);
    if (remaining <= 1e-9) return NextResponse.json(apiError("LINE_COMPLETED", "Строка уже полностью выдана"), { status: 409 });
    const wanted = Math.min(requestedQuantity, remaining);

    const product = await findProduct(current.order.warehouseCode, line.productId, line.sku);
    if (!product) {
      const now = new Date().toISOString();
      await integrationDb.update(onecIntegrationOrderLines).set({ status: "waiting_supply", updatedAt: now }).where(and(eq(onecIntegrationOrderLines.orderId, current.order.id), eq(onecIntegrationOrderLines.lineId, lineId)));
      await integrationDb.insert(onecIntegrationOperations).values({ id: crypto.randomUUID(), operationId, orderId: current.order.id, lineId, type: "shortage", quantity: wanted, status: "pending", payloadJson: JSON.stringify({ reason: "product_not_mapped", operator: session.username }), createdAt: now });
      const status = await recalculateOnecOrderStatus(current.order.id);
      await writeOnecLog({ direction: "out", event: "purchase_required", documentId, operationId, status: "pending", details: `${line.name}; ${wanted} ${line.unit}; product_not_mapped` });
      return NextResponse.json({ ok: true, documentId, operationId, status, shortage: true, issuedQuantity: 0, remainingQuantity: remaining, reason: "Материал 1С не сопоставлен с номенклатурой WMS" });
    }

    const available = product.stock.reduce((sum, row) => sum + row.quantity, 0);
    const toIssue = Math.min(wanted, available);
    const issueResult = toIssue > 0 ? await deductRealStock({
      warehouseCode: current.order.warehouseCode,
      product,
      quantity: toIssue,
      documentNumber: current.order.documentNumber,
      documentId,
      recipient: current.order.sourceUser || current.order.customerOrderId || "Получатель 1С",
      operator: session.name || session.username,
    }) : { issued: 0, deductions: [] as Array<{ cellId: string; cellCode: string; quantity: number }> };

    const issuedBefore = Number(line.issuedQuantity || 0);
    const issuedAfter = issuedBefore + issueResult.issued;
    const remainingAfter = Math.max(0, Number(line.plannedQuantity || 0) - issuedAfter);
    const shortage = remainingAfter > 1e-9;
    const lineStatus = remainingAfter <= 1e-9 ? "completed" : shortage ? "waiting_supply" : "partial";
    const now = new Date().toISOString();

    await integrationDb.update(onecIntegrationOrderLines).set({
      issuedQuantity: issuedAfter,
      reservedQuantity: Math.min(Number(line.reservedQuantity || 0), remainingAfter),
      remainingQuantity: remainingAfter,
      status: lineStatus,
      updatedAt: now,
    }).where(and(eq(onecIntegrationOrderLines.orderId, current.order.id), eq(onecIntegrationOrderLines.lineId, lineId)));

    await integrationDb.insert(onecIntegrationOperations).values({
      id: crypto.randomUUID(), operationId, orderId: current.order.id, lineId, type: shortage ? "issue_partial" : "issue",
      quantity: issueResult.issued, status: "done",
      payloadJson: JSON.stringify({ requestedQuantity, availableBefore: available, deductions: issueResult.deductions, operator: session.username }), createdAt: now,
    });

    const status = await recalculateOnecOrderStatus(current.order.id);
    await writeOnecLog({ direction: "out", event: shortage ? "wms_partial_issue" : "wms_issue", documentId, operationId, status: "pending", details: `${lineId}; issued=${issueResult.issued}; remaining=${remainingAfter}` });
    if (shortage) {
      await writeOnecLog({ direction: "out", event: "purchase_required", documentId, operationId, status: "pending", details: `${line.name}; shortage=${remainingAfter} ${line.unit}; warehouse=${current.order.warehouseCode}` });
    }

    return NextResponse.json({
      ok: true,
      documentId,
      operationId,
      status,
      shortage,
      availableBefore: available,
      line: {
        lineId,
        productId: line.productId,
        wmsProductId: product.id,
        name: line.name,
        plannedQuantity: Number(line.plannedQuantity || 0),
        issuedQuantity: issuedAfter,
        remainingQuantity: remainingAfter,
        unit: line.unit,
        status: lineStatus,
      },
      deductions: issueResult.deductions,
    });
  } catch (error) {
    return NextResponse.json(apiError("INTERNAL_ERROR", error instanceof Error ? error.message : "Не удалось выполнить выдачу"), { status: 500 });
  }
}
