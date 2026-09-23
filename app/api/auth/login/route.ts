import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { warehouseUsers } from "@/db/schema";
import { authenticateUser, createSessionToken, isWarehouseCode, warehouseHome, type WarehouseSession } from "@/lib/warehouse-auth";
import { verifyPassword } from "@/lib/passwords";

export async function POST(request: Request) {
  const { username, password, warehouse } = await request.json() as { username?: string; password?: string; warehouse?: string };
  const login = String(username || "admin").trim().toLowerCase();
  const pass = String(password || "");
  const requestedWarehouse = isWarehouseCode(warehouse) ? warehouse : "hardware";
  let session: WarehouseSession | null = null;
  let persistentUserFound = false;
  let databaseAvailable = false;

  try {
    const db = await getDb();
    databaseAvailable = true;
    const [user] = await db.select().from(warehouseUsers).where(eq(warehouseUsers.username, login)).limit(1);
    persistentUserFound = Boolean(user);
    if (user && user.active && await verifyPassword(pass, user.passwordSalt, user.passwordHash)) {
      const assignedWarehouse = isWarehouseCode(user.warehouseCode) ? user.warehouseCode : "hardware";
      if (user.role === "admin" || assignedWarehouse === requestedWarehouse) {
        session = {
          username: user.username,
          name: user.name,
          role: user.role as WarehouseSession["role"],
          warehouse: user.role === "admin" ? requestedWarehouse : assignedWarehouse,
        };
      }
    }
  } catch {
    // При недоступной БД остаётся аварийный env-вход.
  }

  if (!persistentUserFound && (!databaseAvailable || login === "admin")) {
    session ??= authenticateUser(login, pass, requestedWarehouse);
  }
  if (!session) {
    return NextResponse.json({ error: "Неверный логин, пароль или подразделение" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true, user: session, redirect: warehouseHome(session.warehouse) });
  response.cookies.set("warehouse_session", await createSessionToken(session), {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  return response;
}
