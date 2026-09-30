import { desc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { cells, movements, products, warehouseDocuments } from "@/db/schema";
import { verifySessionToken } from "@/lib/warehouse-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await verifySessionToken(request.cookies.get("warehouse_session")?.value);
  if (!session) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });

  try {
    const db = await getDb();
    const rows = await db.select({
      id: movements.id,
      createdAt: movements.createdAt,
      documentNumber: warehouseDocuments.number,
      oneCId: warehouseDocuments.oneCId,
      recipient: movements.recipient,
      operator: movements.operator,
      quantity: movements.quantity,
      comment: movements.comment,
      productName: products.name,
      productSku: products.sku,
      productBarcode: products.barcode,
      productUnit: products.unit,
      cellCode: cells.code,
    })
      .from(movements)
      .innerJoin(products, eq(movements.productId, products.id))
      .innerJoin(cells, eq(movements.cellId, cells.id))
      .leftJoin(warehouseDocuments, eq(movements.documentId, warehouseDocuments.id))
      .where(eq(movements.type, "Выдача"))
      .orderBy(desc(movements.createdAt))
      .limit(5000);

    return NextResponse.json({
      ok: true,
      rows: rows.map((row) => ({
        ...row,
        quantity: Math.abs(Number(row.quantity || 0)),
        documentNumber: row.documentNumber || "Без документа",
        oneCId: row.oneCId || "",
      })),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось загрузить выданные материалы" }, { status: 500 });
  }
}
