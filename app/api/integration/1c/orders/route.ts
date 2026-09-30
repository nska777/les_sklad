import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import {
  apiError,
  clean,
  ensureOnecIntegrationSchema,
  isOnecWarehouseCode,
  onecIntegrationOrderLines,
  onecIntegrationOrders,
  positiveAmount,
  requireOnecApiToken,
  writeOnecLog,
  type OnecOrderItemInput,
} from "@/lib/onec-integration-api";

export const dynamic = "force-dynamic";

function normalizeItems(value: unknown): { ok: true; items: OnecOrderItemInput[] } | { ok: false; error: ReturnType<typeof apiError> } {
  if (!Array.isArray(value) || !value.length) {
    return { ok: false, error: apiError("INVALID_ITEMS", "Документ должен содержать хотя бы одну строку") };
  }

  const items: OnecOrderItemInput[] = [];
  const lineIds = new Set<string>();

  for (let i = 0; i < value.length; i += 1) {
    const raw = value[i];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, error: apiError("INVALID_LINE", `Строка ${i + 1} имеет неверный формат`) };
    }
    const row = raw as Record<string, unknown>;
    const lineId = clean(row.lineId) || `line-${i + 1}`;
    const productId = clean(row.productId || row.oneCId);
    const sku = clean(row.sku);
    const name = clean(row.name);
    const unit = clean(row.unit);
    const quantity = positiveAmount(row.quantity);

    if (!productId) return { ok: false, error: apiError("PRODUCT_ID_REQUIRED", `В строке ${i + 1} отсутствует productId номенклатуры 1С`) };
    if (!name) return { ok: false, error: apiError("PRODUCT_NAME_REQUIRED", `В строке ${i + 1} отсутствует наименование`) };
    if (!unit) return { ok: false, error: apiError("UNIT_REQUIRED", `В строке ${i + 1} отсутствует единица измерения`) };
    if (!quantity) return { ok: false, error: apiError("INVALID_QUANTITY", `В строке ${i + 1} количество должно быть больше 0`) };
    if (lineIds.has(lineId)) return { ok: false, error: apiError("DUPLICATE_LINE_ID", `Повторяется lineId: ${lineId}`) };
    lineIds.add(lineId);
    items.push({ lineId, productId, sku, name, unit, quantity });
  }

  return { ok: true, items };
}

export async function POST(request: NextRequest) {
  const auth = requireOnecApiToken(request);
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json(apiError("INVALID_JSON", "Тело запроса должно содержать корректный JSON"), { status: 400 });
  }

  const documentId = clean(body.documentId);
  const documentNumber = clean(body.documentNumber);
  const documentDate = clean(body.documentDate);
  const operation = clean(body.operation).toLowerCase();
  const warehouseCode = clean(body.warehouseCode);
  const fromWarehouseCode = clean(body.fromWarehouseCode);
  const toWarehouseCode = clean(body.toWarehouseCode);

  if (!documentId) return NextResponse.json(apiError("DOCUMENT_ID_REQUIRED", "Не указан documentId"), { status: 400 });
  if (!documentNumber) return NextResponse.json(apiError("DOCUMENT_NUMBER_REQUIRED", "Не указан documentNumber"), { status: 400 });
  if (!operation || !["issue", "transfer"].includes(operation)) {
    return NextResponse.json(apiError("INVALID_OPERATION", "operation должен быть issue или transfer"), { status: 400 });
  }
  if (!isOnecWarehouseCode(warehouseCode)) {
    return NextResponse.json(apiError("INVALID_WAREHOUSE", "warehouseCode должен быть hardware, paint или ldsp"), { status: 400 });
  }
  if (fromWarehouseCode && !isOnecWarehouseCode(fromWarehouseCode)) {
    return NextResponse.json(apiError("INVALID_FROM_WAREHOUSE", "Некорректный fromWarehouseCode"), { status: 400 });
  }
  if (toWarehouseCode && !isOnecWarehouseCode(toWarehouseCode)) {
    return NextResponse.json(apiError("INVALID_TO_WAREHOUSE", "Некорректный toWarehouseCode"), { status: 400 });
  }

  const normalized = normalizeItems(body.items);
  if (!normalized.ok) return NextResponse.json(normalized.error, { status: 400 });

  try {
    const db = await ensureOnecIntegrationSchema();
    const existing = (await db.select().from(onecIntegrationOrders).where(eq(onecIntegrationOrders.documentId, documentId)).limit(1))[0];
    if (existing) {
      const sameIdentity = existing.documentNumber === documentNumber && existing.warehouseCode === warehouseCode && existing.operation === operation;
      if (!sameIdentity) {
        await writeOnecLog({ direction: "in", event: "order_duplicate_conflict", documentId, status: "error", details: `Existing=${existing.documentNumber}/${existing.warehouseCode}/${existing.operation}; incoming=${documentNumber}/${warehouseCode}/${operation}` });
        return NextResponse.json(apiError("DOCUMENT_ALREADY_EXISTS", "Документ с таким documentId уже существует с другими реквизитами"), { status: 409 });
      }
      const lines = await db.select().from(onecIntegrationOrderLines).where(eq(onecIntegrationOrderLines.orderId, existing.id));
      return NextResponse.json({
        ok: true,
        duplicate: true,
        documentId: existing.documentId,
        documentNumber: existing.documentNumber,
        status: existing.status,
        warehouseCode: existing.warehouseCode,
        lines: lines.map((line) => ({
          lineId: line.lineId,
          productId: line.productId,
          plannedQuantity: Number(line.plannedQuantity),
          issuedQuantity: Number(line.issuedQuantity),
          remainingQuantity: Number(line.remainingQuantity),
          status: line.status,
        })),
      });
    }

    const orderId = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.insert(onecIntegrationOrders).values({
      id: orderId,
      documentId,
      documentNumber,
      documentDate,
      operation,
      warehouseCode,
      fromWarehouseCode,
      toWarehouseCode,
      fromWarehouseId: clean(body.fromWarehouseId),
      toWarehouseId: clean(body.toWarehouseId),
      sourceUser: clean(body.user || body.sourceUser),
      customerOrderId: clean(body.customerOrderId),
      comment: clean(body.comment),
      status: "received",
      payloadJson: JSON.stringify(body),
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      cancelledAt: null,
    });

    for (const item of normalized.items) {
      await db.insert(onecIntegrationOrderLines).values({
        id: crypto.randomUUID(),
        orderId,
        lineId: item.lineId,
        productId: item.productId,
        sku: item.sku,
        name: item.name,
        unit: item.unit,
        plannedQuantity: item.quantity,
        issuedQuantity: 0,
        reservedQuantity: 0,
        remainingQuantity: item.quantity,
        status: "received",
        createdAt: now,
        updatedAt: now,
      });
    }

    await writeOnecLog({ direction: "in", event: "order_received", documentId, status: "ok", details: `${documentNumber}; ${warehouseCode}; ${normalized.items.length} lines` });

    return NextResponse.json({
      ok: true,
      duplicate: false,
      documentId,
      documentNumber,
      status: "received",
      warehouseCode,
      receivedLines: normalized.items.length,
      receivedAt: now,
    }, { status: 201 });
  } catch (error) {
    await writeOnecLog({ direction: "in", event: "order_receive_failed", documentId, status: "error", details: error instanceof Error ? error.message : "Unknown error" }).catch(() => undefined);
    return NextResponse.json(apiError("INTERNAL_ERROR", error instanceof Error ? error.message : "Не удалось принять документ"), { status: 500 });
  }
}
