import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/warehouse-auth";

export async function proxy(request: NextRequest) {
  const token = request.cookies.get("warehouse_session")?.value;
  const session = await verifySessionToken(token);

  if (request.nextUrl.pathname === "/") {
    return NextResponse.redirect(new URL(session ? "/warehouse" : "/login", request.url));
  }

  if (session) {
    if (request.nextUrl.pathname.startsWith("/api/") && request.method !== "GET" && request.method !== "HEAD" && session.role === "viewer") {
      return NextResponse.json({ error: "Для роли «Просмотр» изменения запрещены" }, { status: 403 });
    }

    const headers = new Headers(request.headers);
    headers.set("x-warehouse-username", session.username);
    headers.set("x-warehouse-user", encodeURIComponent(session.name));
    headers.set("x-warehouse-role", session.role);
    return NextResponse.next({ request: { headers } });
  }

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: ["/((?!login|api/auth/login|_next/static|_next/image|favicon.svg|app-icon.svg|manifest.webmanifest|sw.js).*)"],
};
