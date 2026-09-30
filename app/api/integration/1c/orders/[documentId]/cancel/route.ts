import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import {
  apiError,
  ensureOnecIntegrationSchema,
  getOnecOrderByDocumentId,
  onecIntegrationOrderLines,
  onecIntegrationOrders,
  requireOnecApiToken,
  writeOnecLog,
} from "@/lib/onec-integration-api";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ documentId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = requireOnecApiToken(request);
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });

  const { documentId: rawDocumentId } = await context.params;
  const documentId = decodeURIComponent(rawDocumentId || "").trim();
  if (!documentId) return NextResponse.json(apiError("DOCUMENT_ID_REQUIRED", "Не указан documentId"), { status: 400 });

  try {
    const current = await getOnecOrderByDocumentId(documentId);
    if (!current) return NextResponse.json(apiError("DOCUMENT_NOT_FOUND", "Документ не найден"), { status: 404 });

    if (current.order.status === "completed") {
      return NextResponse.json(apiError("DOCUMENT_COMPLETED", "Выполненный документ отменить нельзя"), { status: 409 });
    }
    if (current.order.status === "cancelled") {
      return NextResponse.json({ ok: true, duplicate: true, documentId, status: "cancelled" });
    }

    const issued = current.lines.reduce((sum, line) => sum + Number(line.issuedQuantity || 0), 0);
    if (issued > 0) {
      return NextResponse.json(apiError("DOCUMENT_ALREADY_IN_PROGRESS", "Документ уже имеет фактическую выдачу. Требуется ручное согласование отмены", { issuedQuantity: issued }), { status: 409 });
    }

    const db = await ensureOnecIntegrationSchema();
    const now = new Date().toISOString();
    await db.update(onecIntegrationOrders).set({ status: "cancelled", cancelledAt: now, updatedAt: now }).where(eq(onecIntegrationOrders.id, current.order.id));
    await db.update(onecIntegrationOrderLines).set({ status: "cancelled", updatedAt: now }).where(eq(onecIntegrationOrderLines.orderId, current.order.id));
    await writeOnecLog({ direction: "in", event: "order_cancelled", documentId, status: "ok" });

    return NextResponse.json({ ok: true, documentId, status: "cancelled", cancelledAt: now });
  } catch (error) {
    return NextResponse.json(apiError("INTERNAL_ERROR", error instanceof Error ? error.message : "Не удалось отменить документ"), { status: 500 });
  }
}
