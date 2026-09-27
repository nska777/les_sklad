import { NextRequest, NextResponse } from "next/server";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { isWarehouseCode } from "@/lib/warehouse-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DraftLine = {
  id: string;
  cellId: string;
  cellCode: string;
  productId: string;
  productName: string;
  barcode: string;
  quantity: number;
  unit: string;
  enteredQuantity: number;
  enteredUnit: string;
};

type IssueDraft = {
  id: string;
  warehouseCode: string;
  operator: string;
  status: "collecting" | "ready";
  recipient: string;
  documentNumber: string;
  resultName: string;
  resultQuantity: number;
  resultUnit: string;
  comment: string;
  lines: DraftLine[];
  updatedAt: string;
};

type DraftStore = Record<string, IssueDraft>;

const dataDir = path.join(process.cwd(), "data");
const storePath = path.join(dataDir, "issue-drafts.json");

function context(request: NextRequest) {
  const warehouseCode = request.headers.get("x-warehouse-code");
  if (!isWarehouseCode(warehouseCode) || warehouseCode === "hardware") return null;
  const operator = decodeURIComponent(request.headers.get("x-warehouse-user") || "Кладовщик");
  return { warehouseCode, operator };
}

function keyOf(warehouseCode: string, operator: string) {
  return `${warehouseCode}::${operator.toLowerCase()}`;
}

async function readStore(): Promise<DraftStore> {
  try {
    const raw = await readFile(storePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? parsed as DraftStore : {};
  } catch {
    return {};
  }
}

async function writeStore(store: DraftStore) {
  await mkdir(dataDir, { recursive: true });
  const tmp = `${storePath}.tmp`;
  await writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
  await rename(tmp, storePath);
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function number(value: unknown) {
  const n = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function sanitizeDraft(input: unknown, warehouseCode: string, operator: string): IssueDraft {
  const raw = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const linesRaw = Array.isArray(raw.lines) ? raw.lines : [];
  const lines: DraftLine[] = linesRaw.slice(0, 200).map((item) => {
    const line = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      id: clean(line.id) || crypto.randomUUID(),
      cellId: clean(line.cellId),
      cellCode: clean(line.cellCode),
      productId: clean(line.productId),
      productName: clean(line.productName),
      barcode: clean(line.barcode),
      quantity: Math.max(0, number(line.quantity)),
      unit: clean(line.unit),
      enteredQuantity: Math.max(0, number(line.enteredQuantity)),
      enteredUnit: clean(line.enteredUnit),
    };
  }).filter((line) => line.cellId && line.productId && line.quantity > 0);

  return {
    id: clean(raw.id) || crypto.randomUUID(),
    warehouseCode,
    operator,
    status: raw.status === "ready" ? "ready" : "collecting",
    recipient: clean(raw.recipient),
    documentNumber: clean(raw.documentNumber),
    resultName: clean(raw.resultName),
    resultQuantity: Math.max(0, number(raw.resultQuantity)),
    resultUnit: clean(raw.resultUnit) || "кг",
    comment: clean(raw.comment),
    lines,
    updatedAt: new Date().toISOString(),
  };
}

export async function GET(request: NextRequest) {
  const ctx = context(request);
  if (!ctx) return NextResponse.json({ error: "Недоступное подразделение" }, { status: 403 });
  const store = await readStore();
  return NextResponse.json({ draft: store[keyOf(ctx.warehouseCode, ctx.operator)] || null });
}

export async function POST(request: NextRequest) {
  const ctx = context(request);
  if (!ctx) return NextResponse.json({ error: "Недоступное подразделение" }, { status: 403 });
  const body = await request.json() as Record<string, unknown>;
  const action = clean(body.action);
  const store = await readStore();
  const key = keyOf(ctx.warehouseCode, ctx.operator);

  if (action === "clear") {
    delete store[key];
    await writeStore(store);
    return NextResponse.json({ ok: true });
  }

  if (action !== "save") return NextResponse.json({ error: "Неизвестная операция" }, { status: 400 });
  const draft = sanitizeDraft(body.draft, ctx.warehouseCode, ctx.operator);
  store[key] = draft;
  await writeStore(store);
  return NextResponse.json({ ok: true, draft });
}
