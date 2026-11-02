CREATE TABLE IF NOT EXISTS "department_unplaced_stocks" (
  "warehouse_code" text NOT NULL,
  "product_id" text NOT NULL REFERENCES "department_products"("id") ON DELETE CASCADE,
  "quantity" double precision NOT NULL DEFAULT 0,
  "updated_at" text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "department_unplaced_stocks_pk" PRIMARY KEY ("warehouse_code", "product_id"),
  CONSTRAINT "department_unplaced_nonnegative" CHECK ("quantity" >= 0)
);
