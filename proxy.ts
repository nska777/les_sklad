import { NextRequest, NextResponse } from "next/server";
import { canAccessWarehouse, isWarehouseCode, verifySessionToken, warehouseHome } from "@/lib/warehouse-auth";

const authApi = ["/api/auth/login", "/api/auth/logout", "/api/auth/me", "/api/auth/switch-warehouse"];

export async function proxy(request: NextRequest) {
  const token = request.cookies.get("warehouse_session")?.value;
  const session = await verifySessionToken(token);
  const pathname = request.nextUrl.pathname;

  if (pathname === "/login") {
    if (session) {
      const destination = session.warehouses.length > 1 ? "/departments" : warehouseHome(session.warehouse);
      return NextResponse.redirect(new URL(destination, request.url));
    }
    return NextResponse.next();
  }

  if (!session) {
    if (pathname.startsWith("/api/")) {
      if (authApi.some((path) => pathname.startsWith(path))) return NextResponse.next();
      return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
    }
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(pathname)}`, request.url));
  }

  if (pathname === "/") {
    const destination = session.warehouses.length > 1 ? "/departments" : warehouseHome(session.warehouse);
    return NextResponse.redirect(new URL(destination, request.url));
  }

  if (pathname.startsWith("/department/")) {
    const requested = pathname.split("/")[2];
    if (isWarehouseCode(requested)) {
      if (!canAccessWarehouse(session, requested)) return NextResponse.redirect(new URL(warehouseHome(session.warehouse), request.url));
      if (requested !== session.warehouse) return NextResponse.redirect(new URL(`/api/auth/switch-warehouse?warehouse=${requested}`, request.url));
    }
  }

  if (pathname === "/warehouse" && session.warehouse !== "hardware") {
    if (canAccessWarehouse(session, "hardware")) return NextResponse.redirect(new URL("/departments", request.url));
    return NextResponse.redirect(new URL(warehouseHome(session.warehouse), request.url));
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
  headers.set("x-warehouse-access", session.warehouses.join(","));
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.svg|app-icon.svg|manifest.webmanifest|sw.js).*)"],
};
