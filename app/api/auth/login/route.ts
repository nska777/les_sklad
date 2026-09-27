import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { warehouseUsers } from "@/db/schema";
import {
  canUseCentralDatabase,
  recordCentralDatabaseFailure,
  recordCentralDatabaseSuccess,
} from "@/lib/db-circuit-breaker";
import { loadLocalSnapshot, saveLocalSnapshot, setCentralDatabaseState } from "@/lib/local-resilience";
import { allWarehouseCodes, authenticateUser, createSessionToken, isWarehouseCode, normalizeWarehouses, warehouseHome, type WarehouseCode, type WarehouseSession } from "@/lib/warehouse-auth";
import { verifyPassword } from "@/lib/passwords";

type CachedUser = {
  username: string;
  name: string;
  passwordHash: string;
  passwordSalt: string;
  role: WarehouseSession["role"];
  warehouseCode: string;
  active: boolean;
};

function storedWarehouses(value: string | null | undefined): WarehouseCode[] {
  const parsed = String(value || "hardware").split(",").map((item) => item.trim()).filter(isWarehouseCode);
  return normalizeWarehouses(parsed, "hardware");
}

function sessionFromUser(user: CachedUser): WarehouseSession {
  const warehouses = user.role === "admin" ? allWarehouseCodes : storedWarehouses(user.warehouseCode);
  return {
    username: user.username,
    name: user.name,
    role: user.role,
    warehouse: warehouses[0],
    warehouses,
  };
}

async function authenticateCachedUser(login: string, pass: string) {
  const cached = loadLocalSnapshot<CachedUser>(`auth:user:${login}`)?.payload;
  if (!cached?.active) return null;
  if (!await verifyPassword(pass, cached.passwordSalt, cached.passwordHash)) return null;
  return sessionFromUser(cached);
}

export async function POST(request: Request) {
  const { username, password } = await request.json() as { username?: string; password?: string };
  const login = String(username || "admin").trim().toLowerCase();
  const pass = String(password || "");
  let session: WarehouseSession | null = null;
  let persistentUserFound = false;
  let databaseAvailable = false;

  if (canUseCentralDatabase()) {
    try {
      const db = await getDb();
      const [user] = await db.select().from(warehouseUsers).where(eq(warehouseUsers.username, login)).limit(1);
      databaseAvailable = true;
      recordCentralDatabaseSuccess();
      setCentralDatabaseState(true);
      persistentUserFound = Boolean(user);

      if (user) {
        const cachedUser: CachedUser = {
          username: user.username,
          name: user.name,
          passwordHash: user.passwordHash,
          passwordSalt: user.passwordSalt,
          role: user.role as WarehouseSession["role"],
          warehouseCode: user.warehouseCode,
          active: user.active,
        };
        saveLocalSnapshot(`auth:user:${login}`, cachedUser);
        if (user.active && await verifyPassword(pass, user.passwordSalt, user.passwordHash)) {
          session = sessionFromUser(cachedUser);
        }
      }
    } catch (error) {
      recordCentralDatabaseFailure(error);
      setCentralDatabaseState(false, error instanceof Error ? error.message : String(error));
    }
  }

  if (!session && (!databaseAvailable || !canUseCentralDatabase())) {
    session = await authenticateCachedUser(login, pass);
  }

  if (!persistentUserFound && (!databaseAvailable || login === "admin")) {
    session ??= authenticateUser(login, pass);
  }
  if (!session) return NextResponse.json({ error: "Неверный логин или пароль" }, { status: 401 });

  const redirect = session.warehouses.length > 1 ? "/departments" : warehouseHome(session.warehouse);
  const response = NextResponse.json({ ok: true, user: session, redirect });
  response.cookies.set("warehouse_session", await createSessionToken(session), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  return response;
}
