import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/warehouse-auth";

export async function GET(request: NextRequest) {
  const session = await verifySessionToken(request.cookies.get("warehouse_session")?.value);
  if (!session) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  return NextResponse.json({ user: session });
}
