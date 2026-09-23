import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

let ready: Promise<void> | null = null;
let pgPool: pg.Pool | null = null;

const schemaSql = [
  `CREATE TABLE IF NOT EXISTS racks (id text PRIMARY KEY, name text NOT NULL, code text NOT NULL UNIQUE, rows integer NOT NULL, columns integer NOT NULL, archived boolean NOT NULL DEFAULT false, created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS cells (id text PRIMARY KEY, rack_id text NOT NULL REFERENCES racks(id) ON DELETE CASCADE, code text NOT NULL UNIQUE, label text NOT NULL, row_index integer NOT NULL, column_index integer NOT NULL, side text NOT NULL DEFAULT 'front', blocked boolean NOT NULL DEFAULT false)`,
  `ALTER TABLE cells ADD COLUMN IF NOT EXISTS side text NOT NULL DEFAULT 'front'`,
  `UPDATE cells SET side = 'front' WHERE side IS NULL OR side = ''`,
  `CREATE INDEX IF NOT EXISTS idx_cells_rack_position ON cells(rack_id, row_index, column_index)`,
  `CREATE INDEX IF NOT EXISTS idx_cells_rack_side_position ON cells(rack_id, side, row_index, column_index)`,
  `CREATE TABLE IF NOT EXISTS products (id text PRIMARY KEY, name text NOT NULL, sku text NOT NULL UNIQUE, barcode text NOT NULL UNIQUE, category text NOT NULL DEFAULT 'Фурнитура', unit text NOT NULL DEFAULT 'шт.', pack_qty double precision NOT NULL DEFAULT 1, image_url text NOT NULL DEFAULT '', min_stock double precision NOT NULL DEFAULT 0, one_c_id text, created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS warehouse_documents (id text PRIMARY KEY, number text NOT NULL UNIQUE, type text NOT NULL, status text NOT NULL DEFAULT 'ready', counterparty text NOT NULL DEFAULT '', recipient text NOT NULL DEFAULT '', one_c_id text, sync_status text NOT NULL DEFAULT 'pending', comment text NOT NULL DEFAULT '', created_by text NOT NULL DEFAULT 'Кладовщик', created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at text)`,
  `CREATE INDEX IF NOT EXISTS idx_warehouse_documents_type_status ON warehouse_documents(type, status)`,
  `CREATE INDEX IF NOT EXISTS idx_warehouse_documents_created_at ON warehouse_documents(created_at)`,
  `CREATE TABLE IF NOT EXISTS warehouse_document_lines (id text PRIMARY KEY, document_id text NOT NULL REFERENCES warehouse_documents(id) ON DELETE CASCADE, product_id text NOT NULL REFERENCES products(id), planned_quantity double precision NOT NULL, processed_quantity double precision NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS idx_warehouse_document_lines_document ON warehouse_document_lines(document_id)`,
  `CREATE TABLE IF NOT EXISTS stocks (product_id text NOT NULL REFERENCES products(id) ON DELETE CASCADE, cell_id text NOT NULL REFERENCES cells(id) ON DELETE CASCADE, quantity double precision NOT NULL DEFAULT 0, updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(product_id, cell_id))`,
  `CREATE TABLE IF NOT EXISTS movements (id text PRIMARY KEY, type text NOT NULL, product_id text NOT NULL REFERENCES products(id), cell_id text NOT NULL REFERENCES cells(id), quantity double precision NOT NULL, operator text NOT NULL DEFAULT 'Кладовщик', source text NOT NULL DEFAULT 'web', document_id text REFERENCES warehouse_documents(id), recipient text NOT NULL DEFAULT '', comment text NOT NULL DEFAULT '', created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS idx_movements_created_at ON movements(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_movements_document_id ON movements(document_id)`,
  `CREATE TABLE IF NOT EXISTS activity_logs (id text PRIMARY KEY, action text NOT NULL, entity_type text NOT NULL, entity_id text NOT NULL, entity_name text NOT NULL, details text NOT NULL DEFAULT '', operator text NOT NULL DEFAULT 'Кладовщик', created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at)`,
  `CREATE TABLE IF NOT EXISTS warehouse_users (id text PRIMARY KEY, username text NOT NULL UNIQUE, name text NOT NULL, password_hash text NOT NULL, password_salt text NOT NULL, role text NOT NULL DEFAULT 'storekeeper', warehouse_code text NOT NULL DEFAULT 'hardware', active boolean NOT NULL DEFAULT true, created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `ALTER TABLE warehouse_users ADD COLUMN IF NOT EXISTS warehouse_code text NOT NULL DEFAULT 'hardware'`,
  `CREATE INDEX IF NOT EXISTS idx_warehouse_users_role_active ON warehouse_users(role, active)`,
  `CREATE INDEX IF NOT EXISTS idx_warehouse_users_warehouse ON warehouse_users(warehouse_code)`,

  `CREATE TABLE IF NOT EXISTS department_racks (id text PRIMARY KEY, warehouse_code text NOT NULL, name text NOT NULL, code text NOT NULL, rows integer NOT NULL, columns integer NOT NULL, archived boolean NOT NULL DEFAULT false, created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS idx_department_racks_warehouse ON department_racks(warehouse_code, archived)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_department_racks_code_unique ON department_racks(warehouse_code, code)`,
  `CREATE TABLE IF NOT EXISTS department_cells (id text PRIMARY KEY, warehouse_code text NOT NULL, rack_id text NOT NULL REFERENCES department_racks(id) ON DELETE CASCADE, code text NOT NULL, label text NOT NULL, row_index integer NOT NULL, column_index integer NOT NULL, blocked boolean NOT NULL DEFAULT false)`,
  `CREATE INDEX IF NOT EXISTS idx_department_cells_warehouse_rack ON department_cells(warehouse_code, rack_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_department_cells_code_unique ON department_cells(warehouse_code, code)`,
  `CREATE TABLE IF NOT EXISTS department_products (id text PRIMARY KEY, warehouse_code text NOT NULL, name text NOT NULL, sku text NOT NULL, barcode text NOT NULL DEFAULT '', category text NOT NULL DEFAULT 'Материалы', unit text NOT NULL DEFAULT 'шт.', min_stock double precision NOT NULL DEFAULT 0, one_c_id text, created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS idx_department_products_warehouse ON department_products(warehouse_code, name)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_department_products_sku_unique ON department_products(warehouse_code, sku)`,
  `CREATE TABLE IF NOT EXISTS department_stocks (warehouse_code text NOT NULL, product_id text NOT NULL REFERENCES department_products(id) ON DELETE CASCADE, cell_id text NOT NULL REFERENCES department_cells(id) ON DELETE CASCADE, quantity double precision NOT NULL DEFAULT 0, updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(warehouse_code, product_id, cell_id))`,
  `CREATE INDEX IF NOT EXISTS idx_department_stocks_warehouse ON department_stocks(warehouse_code)`,
  `CREATE TABLE IF NOT EXISTS department_movements (id text PRIMARY KEY, warehouse_code text NOT NULL, type text NOT NULL, product_id text NOT NULL REFERENCES department_products(id), from_cell_id text REFERENCES department_cells(id), to_cell_id text REFERENCES department_cells(id), quantity double precision NOT NULL, recipient text NOT NULL DEFAULT '', comment text NOT NULL DEFAULT '', operator text NOT NULL DEFAULT 'Кладовщик', created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS idx_department_movements_warehouse_created ON department_movements(warehouse_code, created_at)`,
];

async function ensureSchema(run: (statement: string) => Promise<unknown>) {
  ready ??= (async () => {
    for (const statement of schemaSql) await run(statement);
  })().catch((error) => {
    ready = null;
    throw error;
  });
  await ready;
}

function hasDirectPostgresConfig() {
  return Boolean(process.env.DB_HOST && process.env.DB_NAME && process.env.DB_USER);
}

function getPgPool() {
  if (pgPool) return pgPool;

  const sslRootCert = process.env.SSL_ROOT_CERT;
  const ssl = sslRootCert
    ? { ca: readFileSync(sslRootCert, "utf8"), rejectUnauthorized: true }
    : process.env.DB_SSL === "false"
      ? false
      : { rejectUnauthorized: false };

  pgPool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl,
    max: Number(process.env.DB_POOL_MAX || 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  return pgPool;
}

export async function getDb() {
  if (hasDirectPostgresConfig()) {
    const pool = getPgPool();
    await ensureSchema((statement) => pool.query(statement).then(() => undefined));
    return drizzlePg(pool, { schema });
  }

  const url = process.env.DATABASE_URL || process.env.STORAGE_DATABASE_URL || process.env.STORAGE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error("База данных не настроена: укажите DATABASE_URL или DB_HOST/DB_NAME/DB_USER/DB_PASSWORD");

  const client = neon(url);
  await ensureSchema((statement) => client.query(statement).then(() => undefined));
  return drizzleNeon(client, { schema });
}
