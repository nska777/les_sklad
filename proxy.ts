import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/warehouse-auth";

export async function proxy(request: NextRequest) {
  const token = request.cookies.get("warehouse_session")?.value;
  if (await verifySessionToken(token)) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: ["/((?!login|api/auth/login|_next/static|_next/image|favicon.svg|app-icon.svg|manifest.webmanifest|sw.js).*)"],
};
