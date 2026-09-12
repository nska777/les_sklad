import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

let ready: Promise<void> | null = null;

async function ensureSchema(client: NeonQueryFunction<false, false>) {
  ready ??= (async () => {
    await client`CREATE TABLE IF NOT EXISTS racks (id text PRIMARY KEY, name text NOT NULL, code text NOT NULL UNIQUE, rows integer NOT NULL, columns integer NOT NULL, archived boolean NOT NULL DEFAULT false, created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP)`;
    await client`CREATE TABLE IF NOT EXISTS cells (id text PRIMARY KEY, rack_id text NOT NULL REFERENCES racks(id) ON DELETE CASCADE, code text NOT NULL UNIQUE, label text NOT NULL, row_index integer NOT NULL, column_index integer NOT NULL, side text NOT NULL DEFAULT 'front', blocked boolean NOT NULL DEFAULT false)`;
    await client`ALTER TABLE cells ADD COLUMN IF NOT EXISTS side text NOT NULL DEFAULT 'front'`;
    await client`UPDATE cells SET side = 'front' WHERE side IS NULL OR side = ''`;
    await client`CREATE INDEX IF NOT EXISTS idx_cells_rack_position ON cells(rack_id, row_index, column_index)`;
    await client`CREATE INDEX IF NOT EXISTS idx_cells_rack_side_position ON cells(rack_id, side, row_index, column_index)`;
    await client`CREATE TABLE IF NOT EXISTS products (id text PRIMARY KEY, name text NOT NULL, sku text NOT NULL UNIQUE, barcode text NOT NULL UNIQUE, category text NOT NULL DEFAULT 'Фурнитура', unit text NOT NULL DEFAULT 'шт.', pack_qty double precision NOT NULL DEFAULT 1, image_url text NOT NULL DEFAULT '', min_stock double precision NOT NULL DEFAULT 0, one_c_id text, created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP)`;
    await client`CREATE TABLE IF NOT EXISTS warehouse_documents (id text PRIMARY KEY, number text NOT NULL UNIQUE, type text NOT NULL, status text NOT NULL DEFAULT 'ready', counterparty text NOT NULL DEFAULT '', recipient text NOT NULL DEFAULT '', one_c_id text, sync_status text NOT NULL DEFAULT 'pending', comment text NOT NULL DEFAULT '', created_by text NOT NULL DEFAULT 'Кладовщик', created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at text)`;
    await client`CREATE INDEX IF NOT EXISTS idx_warehouse_documents_type_status ON warehouse_documents(type, status)`;
    await client`CREATE INDEX IF NOT EXISTS idx_warehouse_documents_created_at ON warehouse_documents(created_at)`;
    await client`CREATE TABLE IF NOT EXISTS warehouse_document_lines (id text PRIMARY KEY, document_id text NOT NULL REFERENCES warehouse_documents(id) ON DELETE CASCADE, product_id text NOT NULL REFERENCES products(id), planned_quantity double precision NOT NULL, processed_quantity double precision NOT NULL DEFAULT 0)`;
    await client`CREATE INDEX IF NOT EXISTS idx_warehouse_document_lines_document ON warehouse_document_lines(document_id)`;
    await client`CREATE TABLE IF NOT EXISTS stocks (product_id text NOT NULL REFERENCES products(id) ON DELETE CASCADE, cell_id text NOT NULL REFERENCES cells(id) ON DELETE CASCADE, quantity double precision NOT NULL DEFAULT 0, updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(product_id, cell_id))`;
    await client`CREATE TABLE IF NOT EXISTS movements (id text PRIMARY KEY, type text NOT NULL, product_id text NOT NULL REFERENCES products(id), cell_id text NOT NULL REFERENCES cells(id), quantity double precision NOT NULL, operator text NOT NULL DEFAULT 'Кладовщик', source text NOT NULL DEFAULT 'web', document_id text REFERENCES warehouse_documents(id), recipient text NOT NULL DEFAULT '', comment text NOT NULL DEFAULT '', created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP)`;
    await client`CREATE INDEX IF NOT EXISTS idx_movements_created_at ON movements(created_at)`;
    await client`CREATE INDEX IF NOT EXISTS idx_movements_document_id ON movements(document_id)`;
    await client`CREATE TABLE IF NOT EXISTS activity_logs (id text PRIMARY KEY, action text NOT NULL, entity_type text NOT NULL, entity_id text NOT NULL, entity_name text NOT NULL, details text NOT NULL DEFAULT '', operator text NOT NULL DEFAULT 'Кладовщик', created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP)`;
    await client`CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at)`;
    await client`CREATE TABLE IF NOT EXISTS warehouse_users (id text PRIMARY KEY, username text NOT NULL UNIQUE, name text NOT NULL, password_hash text NOT NULL, password_salt text NOT NULL, role text NOT NULL DEFAULT 'storekeeper', active boolean NOT NULL DEFAULT true, created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP)`;
    await client`CREATE INDEX IF NOT EXISTS idx_warehouse_users_role_active ON warehouse_users(role, active)`;
  })().catch((error) => { ready = null; throw error; });
  await ready;
}

export async function getDb() {
  const url = process.env.DATABASE_URL || process.env.STORAGE_DATABASE_URL || process.env.STORAGE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error("Облачная база ещё не подключена к проекту Vercel");
  const client = neon(url);
  await ensureSchema(client);
  return drizzle(client, { schema });
}
