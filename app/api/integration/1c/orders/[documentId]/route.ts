import { NextRequest, NextResponse } from "next/server";
import { apiError, getOnecOrderByDocumentId, requireOnecApiToken } from "@/lib/onec-integration-api";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ documentId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = requireOnecApiToken(request);
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });

  const { documentId: rawDocumentId } = await context.params;
  const documentId = decodeURIComponent(rawDocumentId || "").trim();
  if (!documentId) return NextResponse.json(apiError("DOCUMENT_ID_REQUIRED", "Не указан documentId"), { status: 400 });

  try {
    const data = await getOnecOrderByDocumentId(documentId);
    if (!data) return NextResponse.json(apiError("DOCUMENT_NOT_FOUND", "Документ не найден"), { status: 404 });

    const { order, lines } = data;
    return NextResponse.json({
      ok: true,
      documentId: order.documentId,
      documentNumber: order.documentNumber,
      documentDate: order.documentDate,
      operation: order.operation,
      warehouseCode: order.warehouseCode,
      fromWarehouseCode: order.fromWarehouseCode,
      toWarehouseCode: order.toWarehouseCode,
      status: order.status,
      comment: order.comment,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      completedAt: order.completedAt,
      cancelledAt: order.cancelledAt,
      items: lines.map((line) => ({
        lineId: line.lineId,
        productId: line.productId,
        sku: line.sku,
        name: line.name,
        unit: line.unit,
        plannedQuantity: Number(line.plannedQuantity),
        issuedQuantity: Number(line.issuedQuantity),
        reservedQuantity: Number(line.reservedQuantity),
        remainingQuantity: Number(line.remainingQuantity),
        status: line.status,
      })),
    });
  } catch (error) {
    return NextResponse.json(apiError("INTERNAL_ERROR", error instanceof Error ? error.message : "Не удалось получить статус документа"), { status: 500 });
  }
}
