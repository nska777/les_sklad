import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import {
  apiError,
  clean,
  ensureOnecIntegrationSchema,
  getOnecOrderByDocumentId,
  onecIntegrationOperations,
  onecIntegrationOrderLines,
  onecIntegrationOrders,
  positiveAmount,
  recalculateOnecOrderStatus,
  writeOnecLog,
} from "@/lib/onec-integration-api";
import { canAccessWarehouse, canWrite, isWarehouseCode, verifySessionToken } from "@/lib/warehouse-auth";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ documentId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const session = await verifySessionToken(request.cookies.get("warehouse_session")?.value);
  if (!session || !canWrite(session.role)) return NextResponse.json(apiError("AUTH_FAILED", "Требуется авторизация кладовщика"), { status: 401 });

  const { documentId: rawDocumentId } = await context.params;
  const documentId = decodeURIComponent(rawDocumentId || "").trim();
  if (!documentId) return NextResponse.json(apiError("DOCUMENT_ID_REQUIRED", "Не указан documentId"), { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json(apiError("INVALID_JSON", "Некорректный JSON"), { status: 400 });
  }

  const event = clean(body.event).toLowerCase();
  const operationId = clean(body.operationId);
  const lineId = clean(body.lineId);
  const quantity = positiveAmount(body.quantity);
  if (!operationId) return NextResponse.json(apiError("OPERATION_ID_REQUIRED", "Не указан operationId"), { status: 400 });
  if (!event || !["start", "issue", "waiting_supply", "reserve", "unreserve"].includes(event)) {
    return NextResponse.json(apiError("INVALID_EVENT", "event должен быть start, issue, waiting_supply, reserve или unreserve"), { status: 400 });
  }

  try {
    const current = await getOnecOrderByDocumentId(documentId);
    if (!current) return NextResponse.json(apiError("DOCUMENT_NOT_FOUND", "Документ не найден"), { status: 404 });
    if (!isWarehouseCode(current.order.warehouseCode) || !canAccessWarehouse(session, current.order.warehouseCode)) {
      return NextResponse.json(apiError("WAREHOUSE_ACCESS_DENIED", "Нет доступа к складу этого документа"), { status: 403 });
    }
    if (["completed", "cancelled"].includes(current.order.status)) {
      return NextResponse.json(apiError("DOCUMENT_CLOSED", "Документ уже закрыт"), { status: 409 });
    }

    const db = await ensureOnecIntegrationSchema();
    const duplicate = (await db.select().from(onecIntegrationOperations).where(eq(onecIntegrationOperations.operationId, operationId)).limit(1))[0];
    if (duplicate) {
      return NextResponse.json({ ok: true, duplicate: true, documentId, operationId, status: current.order.status });
    }

    const now = new Date().toISOString();
    if (event === "start") {
      await db.update(onecIntegrationOrders).set({ status: "in_progress", updatedAt: now }).where(eq(onecIntegrationOrders.id, current.order.id));
      await db.insert(onecIntegrationOperations).values({
        id: crypto.randomUUID(), operationId, orderId: current.order.id, lineId: "", type: "start", quantity: 0,
        status: "pending", payloadJson: JSON.stringify({ ...body, operator: session.username }), createdAt: now,
      });
      await writeOnecLog({ direction: "out", event: "wms_started", documentId, operationId, status: "pending", details: session.username });
      return NextResponse.json({ ok: true, documentId, operationId, status: "in_progress" });
    }

    if (!lineId) return NextResponse.json(apiError("LINE_ID_REQUIRED", "Для этого события требуется lineId"), { status: 400 });
    const line = current.lines.find((item) => item.lineId === lineId);
    if (!line) return NextResponse.json(apiError("LINE_NOT_FOUND", "Строка документа не найдена"), { status: 404 });

    let issued = Number(line.issuedQuantity || 0);
    let reserved = Number(line.reservedQuantity || 0);
    const planned = Number(line.plannedQuantity || 0);
    let remaining = Math.max(0, planned - issued);
    let lineStatus = line.status;

    if (event === "issue") {
      if (!quantity) return NextResponse.json(apiError("INVALID_QUANTITY", "Для выдачи quantity должен быть больше 0"), { status: 400 });
      if (quantity > remaining + 1e-9) return NextResponse.json(apiError("QUANTITY_EXCEEDS_REMAINING", `К довыдаче осталось ${remaining} ${line.unit}`), { status: 409 });
      issued += quantity;
      remaining = Math.max(0, planned - issued);
      reserved = Math.min(reserved, remaining);
      lineStatus = remaining <= 0 ? "completed" : "partial";
    }

    if (event === "waiting_supply") {
      if (remaining <= 0) return NextResponse.json(apiError("LINE_COMPLETED", "Строка уже полностью выдана"), { status: 409 });
      lineStatus = "waiting_supply";
    }

    if (event === "reserve") {
      if (!quantity) return NextResponse.json(apiError("INVALID_QUANTITY", "Для резерва quantity должен быть больше 0"), { status: 400 });
      if (quantity > remaining - reserved + 1e-9) return NextResponse.json(apiError("RESERVE_EXCEEDS_REMAINING", `Можно зарезервировать не более ${Math.max(0, remaining - reserved)} ${line.unit}`), { status: 409 });
      reserved += quantity;
      lineStatus = reserved + 1e-9 >= remaining ? "ready_for_completion" : "waiting_supply";
    }

    if (event === "unreserve") {
      if (!quantity) return NextResponse.json(apiError("INVALID_QUANTITY", "Для снятия резерва quantity должен быть больше 0"), { status: 400 });
      reserved = Math.max(0, reserved - quantity);
      lineStatus = remaining > 0 ? "waiting_supply" : "completed";
    }

    await db.update(onecIntegrationOrderLines).set({
      issuedQuantity: issued,
      reservedQuantity: reserved,
      remainingQuantity: remaining,
      status: lineStatus,
      updatedAt: now,
    }).where(and(eq(onecIntegrationOrderLines.orderId, current.order.id), eq(onecIntegrationOrderLines.lineId, lineId)));

    await db.insert(onecIntegrationOperations).values({
      id: crypto.randomUUID(), operationId, orderId: current.order.id, lineId, type: event,
      quantity: event === "waiting_supply" ? 0 : quantity, status: "pending",
      payloadJson: JSON.stringify({ ...body, operator: session.username }), createdAt: now,
    });

    const status = await recalculateOnecOrderStatus(current.order.id);
    await writeOnecLog({ direction: "out", event: `wms_${event}`, documentId, operationId, status: "pending", details: `${lineId}; qty=${quantity}; orderStatus=${status}` });

    return NextResponse.json({
      ok: true,
      documentId,
      operationId,
      status,
      line: { lineId, plannedQuantity: planned, issuedQuantity: issued, reservedQuantity: reserved, remainingQuantity: remaining, status: lineStatus },
    });
  } catch (error) {
    return NextResponse.json(apiError("INTERNAL_ERROR", error instanceof Error ? error.message : "Не удалось обработать событие WMS"), { status: 500 });
  }
}
