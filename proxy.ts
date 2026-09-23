import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, warehouseHome } from "@/lib/warehouse-auth";

const publicPaths = new Set(["/departments"]);
const authApi = ["/api/auth/login", "/api/auth/logout", "/api/auth/me"];

export async function proxy(request: NextRequest) {
  const token = request.cookies.get("warehouse_session")?.value;
  const session = await verifySessionToken(token);
  const pathname = request.nextUrl.pathname;

  if (pathname === "/") {
    return NextResponse.redirect(new URL("/departments", request.url));
  }

  if (publicPaths.has(pathname)) {
    return NextResponse.next();
  }

  if (pathname === "/login") {
    if (session) return NextResponse.redirect(new URL(warehouseHome(session.warehouse), request.url));
    return NextResponse.next();
  }

  if (session) {
    const expectedHome = warehouseHome(session.warehouse);

    if (pathname === "/warehouse" && session.warehouse !== "hardware") {
      return NextResponse.redirect(new URL(expectedHome, request.url));
    }

    if (pathname.startsWith("/department/")) {
      const requested = pathname.split("/")[2];
      if (requested !== session.warehouse) return NextResponse.redirect(new URL(expectedHome, request.url));
    }

    if (pathname.startsWith("/api/") && !authApi.some((path) => pathname.startsWith(path))) {
      if (session.warehouse !== "hardware" && !pathname.startsWith("/api/department-warehouse")) {
        return NextResponse.json({ error: "Этот раздел недоступен для выбранного склада" }, { status: 403 });
      }
      if (request.method !== "GET" && request.method !== "HEAD" && session.role === "viewer") {
        return NextResponse.json({ error: "Для роли «Просмотр» изменения запрещены" }, { status: 403 });
      }
    }

    const headers = new Headers(request.headers);
    headers.set("x-warehouse-username", session.username);
    headers.set("x-warehouse-user", encodeURIComponent(session.name));
    headers.set("x-warehouse-role", session.role);
    headers.set("x-warehouse-code", session.warehouse);
    return NextResponse.next({ request: { headers } });
  }

  if (pathname.startsWith("/api/")) {
    if (authApi.some((path) => pathname.startsWith(path))) return NextResponse.next();
    return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  }

  return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(pathname)}`, request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.svg|app-icon.svg|manifest.webmanifest|sw.js).*)"],
};
