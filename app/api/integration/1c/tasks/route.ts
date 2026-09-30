import { and, desc, eq, inArray } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import {
  apiError,
  ensureOnecIntegrationSchema,
  onecIntegrationOrderLines,
  onecIntegrationOrders,
} from "@/lib/onec-integration-api";
import { canAccessWarehouse, isWarehouseCode, verifySessionToken } from "@/lib/warehouse-auth";

export const dynamic = "force-dynamic";

const OPEN_STATUSES = ["received", "in_progress", "partial", "waiting_supply", "ready_for_completion"];

export async function GET(request: NextRequest) {
  const session = await verifySessionToken(request.cookies.get("warehouse_session")?.value);
  if (!session) return NextResponse.json(apiError("AUTH_FAILED", "Требуется авторизация кладовщика"), { status: 401 });

  const requestedWarehouse = request.nextUrl.searchParams.get("warehouse") || session.warehouse;
  if (!isWarehouseCode(requestedWarehouse) || !canAccessWarehouse(session, requestedWarehouse)) {
    return NextResponse.json(apiError("WAREHOUSE_ACCESS_DENIED", "Нет доступа к выбранному складу"), { status: 403 });
  }

  try {
    const db = await ensureOnecIntegrationSchema();
    const orders = await db
      .select()
      .from(onecIntegrationOrders)
      .where(and(
        eq(onecIntegrationOrders.warehouseCode, requestedWarehouse),
        inArray(onecIntegrationOrders.status, OPEN_STATUSES),
      ))
      .orderBy(desc(onecIntegrationOrders.createdAt))
      .limit(100);

    const tasks = await Promise.all(orders.map(async (order) => {
      const lines = await db.select().from(onecIntegrationOrderLines).where(eq(onecIntegrationOrderLines.orderId, order.id));
      const plannedQuantity = lines.reduce((sum, line) => sum + Number(line.plannedQuantity || 0), 0);
      const issuedQuantity = lines.reduce((sum, line) => sum + Number(line.issuedQuantity || 0), 0);
      const remainingQuantity = lines.reduce((sum, line) => sum + Number(line.remainingQuantity || 0), 0);
      return {
        documentId: order.documentId,
        documentNumber: order.documentNumber,
        documentDate: order.documentDate,
        operation: order.operation,
        warehouseCode: order.warehouseCode,
        status: order.status,
        sourceUser: order.sourceUser,
        customerOrderId: order.customerOrderId,
        comment: order.comment,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        summary: { plannedQuantity, issuedQuantity, remainingQuantity },
        items: lines.map((line) => ({
          lineId: line.lineId,
          productId: line.productId,
          sku: line.sku,
          name: line.name,
          unit: line.unit,
          plannedQuantity: Number(line.plannedQuantity || 0),
          issuedQuantity: Number(line.issuedQuantity || 0),
          reservedQuantity: Number(line.reservedQuantity || 0),
          remainingQuantity: Number(line.remainingQuantity || 0),
          status: line.status,
        })),
      };
    }));

    return NextResponse.json({ ok: true, warehouseCode: requestedWarehouse, tasks });
  } catch (error) {
    return NextResponse.json(apiError("INTERNAL_ERROR", error instanceof Error ? error.message : "Не удалось загрузить задания 1С"), { status: 500 });
  }
}
