const DEFAULT_PASSWORD = "RL-7K4M-926P";
const DEFAULT_SECRET = "russian-forest-warehouse-v05-2026";

export type WarehouseRole = "admin" | "manager" | "storekeeper" | "viewer";
export type WarehouseCode = "hardware" | "paint" | "ldsp";
export type WarehouseUser = { username: string; name: string; password: string; role: WarehouseRole; warehouse?: WarehouseCode };
export type WarehouseSession = { username: string; name: string; role: WarehouseRole; warehouse: WarehouseCode };

export const warehouseDivisions: Array<{ code: WarehouseCode; name: string; short: string }> = [
  { code: "hardware", name: "Склад фурнитуры", short: "Фурнитура" },
  { code: "paint", name: "Склад краски", short: "Краска" },
  { code: "ldsp", name: "Склад ЛДСП", short: "ЛДСП" },
];

export function isWarehouseCode(value: unknown): value is WarehouseCode {
  return value === "hardware" || value === "paint" || value === "ldsp";
}

export function warehouseName(code: WarehouseCode) {
  return warehouseDivisions.find((item) => item.code === code)?.name || code;
}

export function warehouseHome(code: WarehouseCode) {
  return code === "hardware" ? "/warehouse" : `/department/${code}`;
}

export function accessPassword() {
  return process.env.APP_PASSWORD || DEFAULT_PASSWORD;
}

function secret() {
  return process.env.AUTH_SECRET || DEFAULT_SECRET;
}

export function warehouseUsers(): WarehouseUser[] {
  const raw = process.env.WAREHOUSE_USERS?.trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as WarehouseUser[];
      const valid = parsed.filter((user) => user?.username && user?.name && user?.password && ["admin", "manager", "storekeeper", "viewer"].includes(user.role));
      if (valid.length) return valid;
    } catch {
      // Неверный JSON не должен блокировать аварийный вход через APP_PASSWORD.
    }
  }
  return [{ username: "admin", name: "Администратор", password: accessPassword(), role: "admin", warehouse: "hardware" }];
}

export function authenticateUser(username: string, password: string, requestedWarehouse: WarehouseCode = "hardware"): WarehouseSession | null {
  const normalized = username.trim().toLowerCase();
  const user = warehouseUsers().find((item) => item.username.toLowerCase() === normalized && item.password === password);
  if (!user) return null;
  const assigned = isWarehouseCode(user.warehouse) ? user.warehouse : "hardware";
  if (user.role !== "admin" && assigned !== requestedWarehouse) return null;
  return { username: user.username, name: user.name, role: user.role, warehouse: user.role === "admin" ? requestedWarehouse : assigned };
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function signature(payload: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${payload}:${secret()}`));
  return bytesToHex(new Uint8Array(digest));
}

function encodePayload(session: WarehouseSession) {
  const json = JSON.stringify(session);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function decodePayload(value: string): WarehouseSession | null {
  try {
    const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<WarehouseSession>;
    if (!parsed.username || !parsed.name || !["admin", "manager", "storekeeper", "viewer"].includes(String(parsed.role))) return null;
    const warehouse = isWarehouseCode(parsed.warehouse) ? parsed.warehouse : "hardware";
    return { username: parsed.username, name: parsed.name, role: parsed.role as WarehouseRole, warehouse };
  } catch { return null; }
}

export async function createSessionToken(session: WarehouseSession) {
  const payload = encodePayload(session);
  return `${payload}.${await signature(payload)}`;
}

export async function verifySessionToken(token?: string | null): Promise<WarehouseSession | null> {
  if (!token) return null;
  const [payload, provided] = token.split(".");
  if (!payload || !provided || provided !== await signature(payload)) return null;
  return decodePayload(payload);
}

// Совместимость для старых импортов. Новые маршруты используют createSessionToken/verifySessionToken.
export async function sessionToken() {
  return createSessionToken({ username: "admin", name: "Администратор", role: "admin", warehouse: "hardware" });
}

export function canWrite(role: WarehouseRole) {
  return role === "admin" || role === "manager" || role === "storekeeper";
}

export function canAdmin(role: WarehouseRole) {
  return role === "admin";
}
