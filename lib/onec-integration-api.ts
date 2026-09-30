import { and, eq, sql } from "drizzle-orm";
import { doublePrecision, pgTable, text } from "drizzle-orm/pg-core";
import type { NextRequest } from "next/server";
import { getDb } from "@/db";

export const ONEC_API_VERSION = "v1";
export const ONEC_WAREHOUSES = ["hardware", "paint", "ldsp"] as const;
export type OnecWarehouseCode = (typeof ONEC_WAREHOUSES)[number];

export const onecIntegrationOrders = pgTable("onec_integration_orders", {
  id: text("id").primaryKey(),
  documentId: text("document_id").notNull(),
  documentNumber: text("document_number").notNull(),
  documentDate: text("document_date").notNull().default(""),
  operation: text("operation").notNull(),
  warehouseCode: text("warehouse_code").notNull(),
  fromWarehouseCode: text("from_warehouse_code").notNull().default(""),
  toWarehouseCode: text("to_warehouse_code").notNull().default(""),
  fromWarehouseId: text("from_warehouse_id").notNull().default(""),
  toWarehouseId: text("to_warehouse_id").notNull().default(""),
  sourceUser: text("source_user").notNull().default(""),
  customerOrderId: text("customer_order_id").notNull().default(""),
  comment: text("comment").notNull().default(""),
  status: text("status").notNull().default("received"),
  payloadJson: text("payload_json").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  completedAt: text("completed_at"),
  cancelledAt: text("cancelled_at"),
});

export const onecIntegrationOrderLines = pgTable("onec_integration_order_lines", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull(),
  lineId: text("line_id").notNull(),
  productId: text("product_id").notNull(),
  sku: text("sku").notNull().default(""),
  name: text("name").notNull(),
  unit: text("unit").notNull(),
  plannedQuantity: doublePrecision("planned_quantity").notNull(),
  issuedQuantity: doublePrecision("issued_quantity").notNull().default(0),
  reservedQuantity: doublePrecision("reserved_quantity").notNull().default(0),
  remainingQuantity: doublePrecision("remaining_quantity").notNull(),
  status: text("status").notNull().default("received"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const onecIntegrationOperations = pgTable("onec_integration_operations", {
  id: text("id").primaryKey(),
  operationId: text("operation_id").notNull(),
  orderId: text("order_id").notNull(),
  lineId: text("line_id").notNull().default(""),
  type: text("type").notNull(),
  quantity: doublePrecision("quantity").notNull().default(0),
  status: text("status").notNull().default("pending"),
  payloadJson: text("payload_json").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const onecIntegrationLogs = pgTable("onec_integration_logs", {
  id: text("id").primaryKey(),
  direction: text("direction").notNull(),
  event: text("event").notNull(),
  documentId: text("document_id").notNull().default(""),
  operationId: text("operation_id").notNull().default(""),
  status: text("status").notNull().default("ok"),
  details: text("details").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export type OnecOrderItemInput = {
  lineId: string;
  productId: string;
  sku: string;
  name: string;
  unit: string;
  quantity: number;
};

export function clean(value: unknown) {
  return String(value ?? "").trim();
}

export function positiveAmount(value: unknown) {
  const n = Number(String(value ?? "").trim().replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function isOnecWarehouseCode(value: unknown): value is OnecWarehouseCode {
  return ONEC_WAREHOUSES.includes(clean(value) as OnecWarehouseCode);
}

export function apiError(code: string, message: string, details?: unknown) {
  return { ok: false, error: { code, message, ...(details === undefined ? {} : { details }) } };
}

export function requireOnecApiToken(request: NextRequest) {
  const expected = clean(process.env.ONEC_API_TOKEN);
  if (!expected) return { ok: false as const, status: 503, body: apiError("API_NOT_CONFIGURED", "ONEC_API_TOKEN не настроен на сервере WMS") };
  const auth = clean(request.headers.get("authorization"));
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token || token !== expected) return { ok: false as const, status: 401, body: apiError("AUTH_FAILED", "Неверный или отсутствующий API token") };
  return { ok: true as const };
}

export async function ensureOnecIntegrationSchema() {
  const db = await getDb();
  await db.execute(sql`CREATE TABLE IF NOT EXISTS onec_integration_orders (
    id text PRIMARY KEY,
    document_id text NOT NULL UNIQUE,
    document_number text NOT NULL,
    document_date text NOT NULL DEFAULT '',
    operation text NOT NULL,
    warehouse_code text NOT NULL,
    from_warehouse_code text NOT NULL DEFAULT '',
    to_warehouse_code text NOT NULL DEFAULT '',
    from_warehouse_id text NOT NULL DEFAULT '',
    to_warehouse_id text NOT NULL DEFAULT '',
    source_user text NOT NULL DEFAULT '',
    customer_order_id text NOT NULL DEFAULT '',
    comment text NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'received',
    payload_json text NOT NULL DEFAULT '{}',
    created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at text,
    cancelled_at text
  )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_onec_orders_status_wh ON onec_integration_orders(warehouse_code, status)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_onec_orders_number ON onec_integration_orders(document_number)`);

  await db.execute(sql`CREATE TABLE IF NOT EXISTS onec_integration_order_lines (
    id text PRIMARY KEY,
    order_id text NOT NULL,
    line_id text NOT NULL,
    product_id text NOT NULL,
    sku text NOT NULL DEFAULT '',
    name text NOT NULL,
    unit text NOT NULL,
    planned_quantity double precision NOT NULL,
    issued_quantity double precision NOT NULL DEFAULT 0,
    reserved_quantity double precision NOT NULL DEFAULT 0,
    remaining_quantity double precision NOT NULL,
    status text NOT NULL DEFAULT 'received',
    created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(order_id, line_id)
  )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_onec_lines_order ON onec_integration_order_lines(order_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_onec_lines_product ON onec_integration_order_lines(product_id)`);

  await db.execute(sql`CREATE TABLE IF NOT EXISTS onec_integration_operations (
    id text PRIMARY KEY,
    operation_id text NOT NULL UNIQUE,
    order_id text NOT NULL,
    line_id text NOT NULL DEFAULT '',
    type text NOT NULL,
    quantity double precision NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'pending',
    payload_json text NOT NULL DEFAULT '{}',
    created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_onec_operations_order ON onec_integration_operations(order_id)`);

  await db.execute(sql`CREATE TABLE IF NOT EXISTS onec_integration_logs (
    id text PRIMARY KEY,
    direction text NOT NULL,
    event text NOT NULL,
    document_id text NOT NULL DEFAULT '',
    operation_id text NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'ok',
    details text NOT NULL DEFAULT '',
    created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_onec_logs_document ON onec_integration_logs(document_id, created_at)`);
  return db;
}

export async function writeOnecLog(input: { direction: string; event: string; documentId?: string; operationId?: string; status?: string; details?: string }) {
  const db = await ensureOnecIntegrationSchema();
  await db.insert(onecIntegrationLogs).values({
    id: crypto.randomUUID(),
    direction: input.direction,
    event: input.event,
    documentId: input.documentId || "",
    operationId: input.operationId || "",
    status: input.status || "ok",
    details: input.details || "",
  });
}

export async function getOnecOrderByDocumentId(documentId: string) {
  const db = await ensureOnecIntegrationSchema();
  const order = (await db.select().from(onecIntegrationOrders).where(eq(onecIntegrationOrders.documentId, documentId)).limit(1))[0];
  if (!order) return null;
  const lines = await db.select().from(onecIntegrationOrderLines).where(eq(onecIntegrationOrderLines.orderId, order.id));
  const operations = await db.select().from(onecIntegrationOperations).where(eq(onecIntegrationOperations.orderId, order.id));
  return { order, lines, operations };
}

export async function recalculateOnecOrderStatus(orderId: string) {
  const db = await ensureOnecIntegrationSchema();
  const order = (await db.select().from(onecIntegrationOrders).where(eq(onecIntegrationOrders.id, orderId)).limit(1))[0];
  if (!order || order.status === "cancelled") return order?.status || null;
  const lines = await db.select().from(onecIntegrationOrderLines).where(eq(onecIntegrationOrderLines.orderId, orderId));
  const allDone = lines.length > 0 && lines.every((x) => Number(x.remainingQuantity) <= 0);
  const anyIssued = lines.some((x) => Number(x.issuedQuantity) > 0);
  const waitingSupply = lines.some((x) => x.status === "waiting_supply");
  const readyCompletion = lines.some((x) => x.status === "ready_for_completion");
  let status = "received";
  if (allDone) status = "completed";
  else if (readyCompletion) status = "ready_for_completion";
  else if (waitingSupply) status = "waiting_supply";
  else if (anyIssued) status = "partial";
  else if (order.status === "in_progress") status = "in_progress";
  await db.update(onecIntegrationOrders).set({
    status,
    updatedAt: new Date().toISOString(),
    completedAt: status === "completed" ? new Date().toISOString() : null,
  }).where(and(eq(onecIntegrationOrders.id, orderId), eq(onecIntegrationOrders.documentId, order.documentId)));
  return status;
}
