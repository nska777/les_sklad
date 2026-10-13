-- Semi-finished goods warehouse: explicit, reviewable PostgreSQL migration.
-- Apply only after staging verification. Does not alter existing warehouses.
BEGIN;

CREATE TABLE IF NOT EXISTS semi_documents (
  id text PRIMARY KEY,
  warehouse_code text NOT NULL DEFAULT 'semi' CHECK (warehouse_code = 'semi'),
  number text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('production_receipt', 'assembly_issue', 'rework_return')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'cancelled')),
  purpose text NOT NULL CHECK (purpose IN ('order', 'free')),
  order_number text NOT NULL DEFAULT '',
  master_name text NOT NULL DEFAULT '',
  recipient text NOT NULL DEFAULT '',
  comment text NOT NULL DEFAULT '',
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  posted_at timestamptz,
  cancelled_at timestamptz,
  CONSTRAINT semi_document_order_required CHECK (purpose <> 'order' OR length(trim(order_number)) > 0),
  CONSTRAINT semi_document_master_required CHECK (kind <> 'production_receipt' OR length(trim(master_name)) > 0),
  CONSTRAINT semi_document_recipient_required CHECK (kind <> 'assembly_issue' OR length(trim(recipient)) > 0),
  CONSTRAINT semi_document_unique_number UNIQUE (warehouse_code, number)
);

CREATE TABLE IF NOT EXISTS semi_document_lines (
  id text PRIMARY KEY,
  document_id text NOT NULL REFERENCES semi_documents(id) ON DELETE RESTRICT,
  product_id text NOT NULL REFERENCES department_products(id) ON DELETE RESTRICT,
  cell_id text NOT NULL REFERENCES department_cells(id) ON DELETE RESTRICT,
  quantity double precision NOT NULL CHECK (quantity > 0 AND quantity <= 1000000),
  CONSTRAINT semi_document_line_unique UNIQUE (document_id, product_id, cell_id)
);

-- Purpose/order is part of the stock identity. A part reserved for an order
-- cannot be silently issued from free stock, or from another order.
CREATE TABLE IF NOT EXISTS semi_balances (
  product_id text NOT NULL REFERENCES department_products(id) ON DELETE RESTRICT,
  cell_id text NOT NULL REFERENCES department_cells(id) ON DELETE RESTRICT,
  purpose text NOT NULL CHECK (purpose IN ('order', 'free')),
  order_number text NOT NULL DEFAULT '',
  quantity double precision NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, cell_id, purpose, order_number),
  CONSTRAINT semi_balance_order_required CHECK (
    (purpose = 'order' AND length(trim(order_number)) > 0)
    OR (purpose = 'free' AND order_number = '')
  )
);

CREATE TABLE IF NOT EXISTS semi_stock_events (
  id text PRIMARY KEY,
  document_id text NOT NULL REFERENCES semi_documents(id) ON DELETE RESTRICT,
  line_id text NOT NULL REFERENCES semi_document_lines(id) ON DELETE RESTRICT,
  product_id text NOT NULL REFERENCES department_products(id) ON DELETE RESTRICT,
  cell_id text NOT NULL REFERENCES department_cells(id) ON DELETE RESTRICT,
  delta double precision NOT NULL CHECK (delta <> 0),
  purpose text NOT NULL CHECK (purpose IN ('order', 'free')),
  order_number text NOT NULL DEFAULT '',
  operator text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT semi_stock_event_unique_line UNIQUE (line_id)
);

CREATE INDEX IF NOT EXISTS idx_semi_documents_created ON semi_documents(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_semi_documents_order ON semi_documents(order_number, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_semi_balances_cell ON semi_balances(cell_id);
CREATE INDEX IF NOT EXISTS idx_semi_events_product ON semi_stock_events(product_id, created_at DESC);

COMMIT;
