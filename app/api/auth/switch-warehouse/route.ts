import { NextRequest, NextResponse } from "next/server";
import { canAccessWarehouse, createSessionToken, isWarehouseCode, verifySessionToken, warehouseHome } from "@/lib/warehouse-auth";

export async function POST(request: NextRequest) {
  const session = await verifySessionToken(request.cookies.get("warehouse_session")?.value);
  if (!session) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });

  const body = await request.json() as { warehouse?: string };
  if (!isWarehouseCode(body.warehouse)) return NextResponse.json({ error: "Неизвестный склад" }, { status: 400 });
  if (!canAccessWarehouse(session, body.warehouse)) return NextResponse.json({ error: "Нет доступа к этому складу" }, { status: 403 });

  const nextSession = { ...session, warehouse: body.warehouse };
  const response = NextResponse.json({ ok: true, redirect: warehouseHome(body.warehouse), user: nextSession });
  response.cookies.set("warehouse_session", await createSessionToken(nextSession), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  return response;
}
