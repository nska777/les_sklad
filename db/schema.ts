import { sql } from "drizzle-orm";
import { boolean, doublePrecision, index, integer, pgTable, primaryKey, text } from "drizzle-orm/pg-core";

export const racks = pgTable("racks", {
  id: text("id").primaryKey(), name: text("name").notNull(), code: text("code").notNull().unique(),
  rows: integer("rows").notNull(), columns: integer("columns").notNull(),
  archived: boolean("archived").notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const cells = pgTable("cells", {
  id: text("id").primaryKey(), rackId: text("rack_id").notNull().references(() => racks.id, { onDelete: "cascade" }),
  code: text("code").notNull().unique(), label: text("label").notNull(), rowIndex: integer("row_index").notNull(),
  columnIndex: integer("column_index").notNull(), side: text("side").notNull().default("front"),
  blocked: boolean("blocked").notNull().default(false),
}, (table) => [
  index("idx_cells_rack_position").on(table.rackId, table.rowIndex, table.columnIndex),
  index("idx_cells_rack_side_position").on(table.rackId, table.side, table.rowIndex, table.columnIndex),
]);

export const products = pgTable("products", {
  id: text("id").primaryKey(), name: text("name").notNull(), sku: text("sku").notNull().unique(),
  barcode: text("barcode").notNull().unique(), category: text("category").notNull().default("Фурнитура"),
  unit: text("unit").notNull().default("шт."), packQty: doublePrecision("pack_qty").notNull().default(1),
  imageUrl: text("image_url").notNull().default(""), minStock: doublePrecision("min_stock").notNull().default(0),
  oneCId: text("one_c_id"), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const warehouseDocuments = pgTable("warehouse_documents", {
  id: text("id").primaryKey(),
  number: text("number").notNull().unique(),
  type: text("type").notNull(),
  status: text("status").notNull().default("ready"),
  counterparty: text("counterparty").notNull().default(""),
  recipient: text("recipient").notNull().default(""),
  oneCId: text("one_c_id"),
  syncStatus: text("sync_status").notNull().default("pending"),
  comment: text("comment").notNull().default(""),
  createdBy: text("created_by").notNull().default("Кладовщик"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  completedAt: text("completed_at"),
}, (table) => [
  index("idx_warehouse_documents_type_status").on(table.type, table.status),
  index("idx_warehouse_documents_created_at").on(table.createdAt),
]);

export const warehouseDocumentLines = pgTable("warehouse_document_lines", {
  id: text("id").primaryKey(),
  documentId: text("document_id").notNull().references(() => warehouseDocuments.id, { onDelete: "cascade" }),
  productId: text("product_id").notNull().references(() => products.id),
  plannedQuantity: doublePrecision("planned_quantity").notNull(),
  processedQuantity: doublePrecision("processed_quantity").notNull().default(0),
}, (table) => [index("idx_warehouse_document_lines_document").on(table.documentId)]);

export const stocks = pgTable("stocks", {
  productId: text("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  cellId: text("cell_id").notNull().references(() => cells.id, { onDelete: "cascade" }),
  quantity: doublePrecision("quantity").notNull().default(0), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [primaryKey({ columns: [table.productId, table.cellId] })]);

export const movements = pgTable("movements", {
  id: text("id").primaryKey(), type: text("type").notNull(),
  productId: text("product_id").notNull().references(() => products.id),
  cellId: text("cell_id").notNull().references(() => cells.id), quantity: doublePrecision("quantity").notNull(),
  operator: text("operator").notNull().default("Кладовщик"), source: text("source").notNull().default("web"),
  documentId: text("document_id").references(() => warehouseDocuments.id),
  recipient: text("recipient").notNull().default(""),
  comment: text("comment").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_movements_created_at").on(table.createdAt),
  index("idx_movements_document_id").on(table.documentId),
]);

export const issueLiveSessions = pgTable("issue_live_sessions", {
  documentNumber: text("document_number").primaryKey(),
  productCode: text("product_code").notNull().default(""),
  productName: text("product_name").notNull().default(""),
  cellCode: text("cell_code").notNull().default(""),
  quantity: doublePrecision("quantity").notNull().default(0),
  operator: text("operator").notNull().default("Кладовщик"),
  stage: text("stage").notNull().default("document"),
  progress: integer("progress").notNull().default(0),
  status: text("status").notNull().default("active"),
  message: text("message").notNull().default(""),
  version: integer("version").notNull().default(1),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_issue_live_updated_at").on(table.updatedAt)]);

export const issueHistory = pgTable("issue_history", {
  id: text("id").primaryKey(),
  movementId: text("movement_id").notNull().unique(),
  documentId: text("document_id").notNull(),
  documentNumber: text("document_number").notNull(),
  recipient: text("recipient").notNull().default(""),
  productId: text("product_id").notNull(),
  productName: text("product_name").notNull(),
  sku: text("sku").notNull().default(""),
  barcode: text("barcode").notNull().default(""),
  cellCode: text("cell_code").notNull().default(""),
  quantity: doublePrecision("quantity").notNull(),
  unit: text("unit").notNull().default("шт."),
  operator: text("operator").notNull().default("Кладовщик"),
  balanceAfter: doublePrecision("balance_after").notNull().default(0),
  cellBalanceAfter: doublePrecision("cell_balance_after").notNull().default(0),
  issuedAt: text("issued_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_issue_history_issued_at").on(table.issuedAt),
  index("idx_issue_history_document").on(table.documentNumber),
  index("idx_issue_history_product").on(table.productId),
]);

export const activityLogs = pgTable("activity_logs", {
  id: text("id").primaryKey(), action: text("action").notNull(), entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(), entityName: text("entity_name").notNull(), details: text("details").notNull().default(""),
  operator: text("operator").notNull().default("Кладовщик"), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_activity_logs_created_at").on(table.createdAt)]);

export const warehouseUsers = pgTable("warehouse_users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  role: text("role").notNull().default("storekeeper"),
  warehouseCode: text("warehouse_code").notNull().default("hardware"),
  active: boolean("active").notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_warehouse_users_role_active").on(table.role, table.active), index("idx_warehouse_users_warehouse").on(table.warehouseCode)]);

export const departmentRacks = pgTable("department_racks", {
  id: text("id").primaryKey(),
  warehouseCode: text("warehouse_code").notNull(),
  name: text("name").notNull(),
  code: text("code").notNull(),
  rows: integer("rows").notNull(),
  columns: integer("columns").notNull(),
  archived: boolean("archived").notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_department_racks_warehouse").on(table.warehouseCode, table.archived)]);

export const departmentCells = pgTable("department_cells", {
  id: text("id").primaryKey(),
  warehouseCode: text("warehouse_code").notNull(),
  rackId: text("rack_id").notNull().references(() => departmentRacks.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  label: text("label").notNull(),
  rowIndex: integer("row_index").notNull(),
  columnIndex: integer("column_index").notNull(),
  blocked: boolean("blocked").notNull().default(false),
}, (table) => [index("idx_department_cells_warehouse_rack").on(table.warehouseCode, table.rackId)]);

export const departmentProducts = pgTable("department_products", {
  id: text("id").primaryKey(),
  warehouseCode: text("warehouse_code").notNull(),
  name: text("name").notNull(),
  sku: text("sku").notNull(),
  barcode: text("barcode").notNull().default(""),
  category: text("category").notNull().default("Материалы"),
  unit: text("unit").notNull().default("шт."),
  minStock: doublePrecision("min_stock").notNull().default(0),
  oneCId: text("one_c_id"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_department_products_warehouse").on(table.warehouseCode, table.name)]);

export const departmentStocks = pgTable("department_stocks", {
  warehouseCode: text("warehouse_code").notNull(),
  productId: text("product_id").notNull().references(() => departmentProducts.id, { onDelete: "cascade" }),
  cellId: text("cell_id").notNull().references(() => departmentCells.id, { onDelete: "cascade" }),
  quantity: doublePrecision("quantity").notNull().default(0),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [primaryKey({ columns: [table.warehouseCode, table.productId, table.cellId] }), index("idx_department_stocks_warehouse").on(table.warehouseCode)]);

export const departmentMovements = pgTable("department_movements", {
  id: text("id").primaryKey(),
  warehouseCode: text("warehouse_code").notNull(),
  type: text("type").notNull(),
  productId: text("product_id").notNull().references(() => departmentProducts.id),
  fromCellId: text("from_cell_id").references(() => departmentCells.id),
  toCellId: text("to_cell_id").references(() => departmentCells.id),
  quantity: doublePrecision("quantity").notNull(),
  recipient: text("recipient").notNull().default(""),
  comment: text("comment").notNull().default(""),
  operator: text("operator").notNull().default("Кладовщик"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_department_movements_warehouse_created").on(table.warehouseCode, table.createdAt)]);
