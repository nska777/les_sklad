import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle",
  schema: "./db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL || process.env.STORAGE_DATABASE_URL || "postgresql://localhost/russian_forest_sklad",
  },
});
