import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { warehouseUsers } from "@/db/schema";
import { authenticateUser, createSessionToken, type WarehouseSession } from "@/lib/warehouse-auth";
import { verifyPassword } from "@/lib/passwords";

export async function POST(request: Request) {
  const { username, password } = await request.json() as { username?: string; password?: string };
  const login = String(username || "admin").trim().toLowerCase();
  const pass = String(password || "");
  let session: WarehouseSession | null = null;
  let persistentUserFound = false;
  let databaseAvailable = false;

  try {
    const db = await getDb();
    databaseAvailable = true;
    const [user] = await db.select().from(warehouseUsers).where(eq(warehouseUsers.username, login)).limit(1);
    persistentUserFound = Boolean(user);
    if (user && user.active && await verifyPassword(pass, user.passwordSalt, user.passwordHash)) {
      session = { username: user.username, name: user.name, role: user.role as WarehouseSession["role"] };
    }
  } catch {
    // При недоступной БД остаётся аварийный env-вход.
  }

  if (!persistentUserFound && (!databaseAvailable || login === "admin")) {
    session ??= authenticateUser(login, pass);
  }
  if (!session) {
    return NextResponse.json({ error: "Неверный логин или пароль" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true, user: session });
  response.cookies.set("warehouse_session", await createSessionToken(session), {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  return response;
}
