import { eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { activityLogs, warehouseUsers } from "@/db/schema";
import { hashPassword } from "@/lib/passwords";
import { allWarehouseCodes, isWarehouseCode, warehouseName, type WarehouseCode, type WarehouseRole } from "@/lib/warehouse-auth";

const roles: WarehouseRole[] = ["admin", "manager", "storekeeper", "viewer"];
const limitedAccessAdmin = "mikhail";
const protectedUsernames = new Set(["artashes", "roman"]);

function requireAdmin(request: NextRequest) {
  return request.headers.get("x-warehouse-role") === "admin";
}

function actorUsername(request: NextRequest) {
  return String(request.headers.get("x-warehouse-username") || "").trim().toLowerCase();
}

function parseWarehouses(value: unknown, role: WarehouseRole): WarehouseCode[] {
  if (role === "admin") return allWarehouseCodes;
  const source = Array.isArray(value) ? value : String(value || "hardware").split(",");
  const list = source.map((item) => String(item).trim()).filter(isWarehouseCode);
  return list.length ? Array.from(new Set(list)) : ["hardware"];
}

function storedWarehouses(value: string, role: string): WarehouseCode[] {
  if (role === "admin") return allWarehouseCodes;
  const list = value.split(",").map((item) => item.trim()).filter(isWarehouseCode);
  return list.length ? list : ["hardware"];
}

export async function GET(request: NextRequest) {
  if (!requireAdmin(request)) return NextResponse.json({ error: "Только для администратора" }, { status: 403 });
  const db = await getDb();
  const users = await db.select({
    id: warehouseUsers.id,
    username: warehouseUsers.username,
    name: warehouseUsers.name,
    role: warehouseUsers.role,
    warehouseCode: warehouseUsers.warehouseCode,
    active: warehouseUsers.active,
    createdAt: warehouseUsers.createdAt,
  }).from(warehouseUsers).orderBy(warehouseUsers.name);
  const actor = actorUsername(request);
  return NextResponse.json({
    users: users.map((user) => ({ ...user, warehouses: storedWarehouses(user.warehouseCode, user.role) })),
    permissions: {
      canCreateUsers: actor !== limitedAccessAdmin,
      accessOnly: actor === limitedAccessAdmin,
      protectedUsernames: actor === limitedAccessAdmin ? Array.from(protectedUsernames) : [],
    },
  });
}

export async function POST(request: NextRequest) {
  if (!requireAdmin(request)) return NextResponse.json({ error: "Только для администратора" }, { status: 403 });
  const db = await getDb();
  const body = await request.json() as Record<string, unknown>;
  const action = String(body.action || "create");
  const actor = actorUsername(request);
  const operator = decodeURIComponent(request.headers.get("x-warehouse-user") || "Администратор");
  const accessOnly = actor === limitedAccessAdmin;

  if (action === "create") {
    if (accessOnly) {
      return NextResponse.json({ error: "У вас нет права создавать новых пользователей" }, { status: 403 });
    }
    const username = String(body.username || "").trim().toLowerCase();
    const name = String(body.name || "").trim();
    const password = String(body.password || "");
    const role = String(body.role || "storekeeper") as WarehouseRole;
    if (!username || !name || password.length < 6 || !roles.includes(role)) {
      return NextResponse.json({ error: "Заполните имя, логин, роль и пароль минимум 6 символов" }, { status: 400 });
    }
    const warehouses = parseWarehouses(body.warehouses ?? body.warehouseCode, role);
    const [exists] = await db.select({ id: warehouseUsers.id }).from(warehouseUsers).where(eq(warehouseUsers.username, username)).limit(1);
    if (exists) return NextResponse.json({ error: "Такой логин уже существует" }, { status: 409 });
    const { hash, salt } = await hashPassword(password);
    const id = crypto.randomUUID();
    await db.insert(warehouseUsers).values({ id, username, name, passwordHash: hash, passwordSalt: salt, role, warehouseCode: warehouses.join(","), active: true });
    await db.insert(activityLogs).values({ id: crypto.randomUUID(), action: "Создан пользователь", entityType: "Пользователь", entityId: id, entityName: name, details: `${username} · ${role} · ${warehouses.map(warehouseName).join(" / ")}`, operator });
    return NextResponse.json({ ok: true, id });
  }

  if (action === "update") {
    const id = String(body.id || "");
    if (!id) return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });

    const [current] = await db.select().from(warehouseUsers).where(eq(warehouseUsers.id, id)).limit(1);
    if (!current) return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });

    if (accessOnly) {
      const targetUsername = current.username.trim().toLowerCase();
      if (protectedUsernames.has(targetUsername)) {
        return NextResponse.json({ error: "Доступы Artashes и Roman может изменять только полный администратор" }, { status: 403 });
      }
      if (current.role === "admin") {
        return NextResponse.json({ error: "Администратору доступ ко всем складам назначается автоматически" }, { status: 409 });
      }
      const warehouses = parseWarehouses(body.warehouses ?? body.warehouseCode, current.role as WarehouseRole);
      await db.update(warehouseUsers).set({ warehouseCode: warehouses.join(",") }).where(eq(warehouseUsers.id, id));
      await db.insert(activityLogs).values({
        id: crypto.randomUUID(),
        action: "Изменён доступ к складам",
        entityType: "Пользователь",
        entityId: id,
        entityName: current.name,
        details: `${current.username} · ${warehouses.map(warehouseName).join(" / ")}`,
        operator,
      });
      return NextResponse.json({ ok: true });
    }

    const name = String(body.name || "").trim();
    const role = String(body.role || "storekeeper") as WarehouseRole;
    const active = Boolean(body.active);
    const password = String(body.password || "");
    if (!name || !roles.includes(role)) return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
    const warehouses = parseWarehouses(body.warehouses ?? body.warehouseCode, role);

    if (current.role === "admin" && current.active && (role !== "admin" || !active)) {
      const result = await db.execute(sql`SELECT COUNT(*)::int AS count FROM warehouse_users WHERE role = 'admin' AND active = true`);
      const rows = Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows || [];
      const count = Number((rows[0] as { count?: number } | undefined)?.count || 0);
      if (count <= 1) return NextResponse.json({ error: "Нельзя отключить или понизить последнего администратора" }, { status: 409 });
    }

    const values: { name: string; role: string; warehouseCode: string; active: boolean; passwordHash?: string; passwordSalt?: string } = { name, role, warehouseCode: warehouses.join(","), active };
    if (password) {
      if (password.length < 6) return NextResponse.json({ error: "Новый пароль должен быть минимум 6 символов" }, { status: 400 });
      const { hash, salt } = await hashPassword(password);
      values.passwordHash = hash;
      values.passwordSalt = salt;
    }
    await db.update(warehouseUsers).set(values).where(eq(warehouseUsers.id, id));
    await db.insert(activityLogs).values({ id: crypto.randomUUID(), action: "Изменён пользователь", entityType: "Пользователь", entityId: id, entityName: name, details: `${current.username} · ${role} · ${warehouses.map(warehouseName).join(" / ")} · ${active ? "активен" : "отключён"}`, operator });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Неизвестная операция" }, { status: 400 });
}
