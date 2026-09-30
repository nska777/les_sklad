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

    const { order, lines, operations } = data;
    const plannedQuantity = lines.reduce((sum, line) => sum + Number(line.plannedQuantity || 0), 0);
    const issuedQuantity = lines.reduce((sum, line) => sum + Number(line.issuedQuantity || 0), 0);
    const remainingQuantity = lines.reduce((sum, line) => sum + Number(line.remainingQuantity || 0), 0);

    return NextResponse.json({
      ok: true,
      documentId: order.documentId,
      documentNumber: order.documentNumber,
      warehouseCode: order.warehouseCode,
      status: order.status,
      summary: { plannedQuantity, issuedQuantity, remainingQuantity },
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
      operations: operations.map((operation) => ({
        operationId: operation.operationId,
        lineId: operation.lineId,
        type: operation.type,
        quantity: Number(operation.quantity),
        status: operation.status,
        createdAt: operation.createdAt,
      })),
      completedAt: order.completedAt,
      updatedAt: order.updatedAt,
    });
  } catch (error) {
    return NextResponse.json(apiError("INTERNAL_ERROR", error instanceof Error ? error.message : "Не удалось получить результат документа"), { status: 500 });
  }
}
