import { loadLocalSnapshot, saveLocalSnapshot } from "@/lib/local-resilience";

type Row = Record<string, unknown>;
type DepartmentSnapshot = {
  warehouse?: { code?: string; name?: string };
  racks?: Row[];
  cells?: Row[];
  products?: Row[];
  stocks?: Row[];
  movements?: Row[];
  mixes?: Row[];
  inventories?: Row[];
  [key: string]: unknown;
};

const text = (value: unknown) => String(value ?? "").trim();
const number = (value: unknown) => { const n = Number(value); return Number.isFinite(n) ? n : 0; };

function stockQuantity(snapshot: DepartmentSnapshot, productId: string, cellId: string) {
  const row = (snapshot.stocks || []).find((x) => text(x.productId) === productId && text(x.cellId) === cellId);
  return number(row?.quantity);
}

function setStock(snapshot: DepartmentSnapshot, warehouseCode: string, productId: string, cellId: string, quantity: number) {
  const stocks = snapshot.stocks ||= [];
  const index = stocks.findIndex((x) => text(x.productId) === productId && text(x.cellId) === cellId);
  const safe = Math.max(0, quantity);
  if (safe <= 0) {
    if (index >= 0) stocks.splice(index, 1);
    return;
  }
  const row = { warehouseCode, productId, cellId, quantity: safe, updatedAt: new Date().toISOString() };
  if (index >= 0) stocks[index] = { ...stocks[index], ...row };
  else stocks.push(row);
}

function product(snapshot: DepartmentSnapshot, id: string) {
  return (snapshot.products || []).find((x) => text(x.id) === id);
}

function cell(snapshot: DepartmentSnapshot, id: string) {
  return (snapshot.cells || []).find((x) => text(x.id) === id);
}

function movement(snapshot: DepartmentSnapshot, warehouseCode: string, operator: string, values: Row) {
  const p = product(snapshot, text(values.productId));
  const from = values.fromCellId ? cell(snapshot, text(values.fromCellId)) : undefined;
  const to = values.toCellId ? cell(snapshot, text(values.toCellId)) : undefined;
  const row = {
    id: crypto.randomUUID(),
    warehouseCode,
    type: text(values.type),
    productId: text(values.productId),
    fromCellId: values.fromCellId ? text(values.fromCellId) : null,
    toCellId: values.toCellId ? text(values.toCellId) : null,
    quantity: number(values.quantity),
    recipient: text(values.recipient),
    comment: text(values.comment),
    operator,
    documentNumber: text(values.documentNumber),
    sourceName: text(values.sourceName),
    sourceLocation: text(values.sourceLocation),
    batchId: text(values.batchId),
    createdAt: new Date().toISOString(),
    productName: text(p?.name) || "Материал",
    productSku: text(p?.sku),
    productUnit: text(p?.unit),
    fromCellCode: text(from?.code),
    toCellCode: text(to?.code),
    offline: true,
  };
  const rows = snapshot.movements ||= [];
  rows.unshift(row);
  if (rows.length > 700) rows.length = 700;
  return row;
}

export function applyDepartmentOfflineOperation(scope: string, warehouseCode: string, operator: string, body: Row) {
  const cached = loadLocalSnapshot<DepartmentSnapshot>(scope);
  if (!cached) throw new Error("Нет локального снимка склада. Откройте склад хотя бы один раз при доступной базе данных.");
  const snapshot = cached.payload;
  const action = text(body.action);

  if (action === "receive") {
    const productId = text(body.productId), cellId = text(body.cellId), quantity = number(body.quantity);
    if (!product(snapshot, productId) || !cell(snapshot, cellId) || quantity <= 0) throw new Error("Проверьте материал, место хранения и количество");
    setStock(snapshot, warehouseCode, productId, cellId, stockQuantity(snapshot, productId, cellId) + quantity);
    movement(snapshot, warehouseCode, operator, { type: "Приход", productId, toCellId: cellId, quantity, comment: body.comment, documentNumber: body.documentNumber, sourceName: body.sourceName, sourceLocation: body.sourceLocation });
  } else if (action === "transfer") {
    const productId = text(body.productId), fromCellId = text(body.fromCellId), toCellId = text(body.toCellId), quantity = number(body.quantity);
    if (!product(snapshot, productId) || !cell(snapshot, fromCellId) || !cell(snapshot, toCellId) || fromCellId === toCellId || quantity <= 0) throw new Error("Проверьте материал, ячейки и количество");
    const available = stockQuantity(snapshot, productId, fromCellId);
    if (available < quantity) throw new Error(`Недостаточно остатка: ${available}`);
    setStock(snapshot, warehouseCode, productId, fromCellId, available - quantity);
    setStock(snapshot, warehouseCode, productId, toCellId, stockQuantity(snapshot, productId, toCellId) + quantity);
    movement(snapshot, warehouseCode, operator, { type: "Перемещение", productId, fromCellId, toCellId, quantity, comment: body.comment });
  } else if (action === "issue") {
    const productId = text(body.productId), cellId = text(body.cellId), quantity = number(body.quantity);
    const available = stockQuantity(snapshot, productId, cellId);
    if (!product(snapshot, productId) || !cell(snapshot, cellId) || quantity <= 0 || available < quantity) throw new Error(`Недостаточно остатка. Доступно: ${available}`);
    setStock(snapshot, warehouseCode, productId, cellId, available - quantity);
    movement(snapshot, warehouseCode, operator, { type: "Выдача", productId, fromCellId: cellId, quantity, recipient: body.recipient, comment: body.comment, documentNumber: body.documentNumber });
  } else if (action === "issueMix") {
    const lines = Array.isArray(body.lines) ? body.lines as Row[] : [];
    if (!lines.length) throw new Error("Добавьте компоненты смеси");
    for (const line of lines) {
      const productId = text(line.productId), cellId = text(line.cellId), quantity = number(line.quantity);
      const available = stockQuantity(snapshot, productId, cellId);
      if (!product(snapshot, productId) || !cell(snapshot, cellId) || quantity <= 0 || available < quantity) throw new Error(`Недостаточно материала. Доступно: ${available}`);
    }
    const mixId = crypto.randomUUID();
    for (const line of lines) {
      const productId = text(line.productId), cellId = text(line.cellId), quantity = number(line.quantity);
      setStock(snapshot, warehouseCode, productId, cellId, stockQuantity(snapshot, productId, cellId) - quantity);
      movement(snapshot, warehouseCode, operator, { type: "Смешивание/Выдача", productId, fromCellId: cellId, quantity, recipient: body.recipient, comment: body.comment, documentNumber: body.documentNumber, batchId: mixId });
    }
    const mixes = snapshot.mixes ||= [];
    mixes.unshift({ id: mixId, warehouseCode, name: text(body.name) || "Смешанный продукт", recipient: text(body.recipient), documentNumber: text(body.documentNumber), resultQuantity: Math.max(0, number(body.resultQuantity)), resultUnit: text(body.resultUnit) || "кг", comment: text(body.comment), operator, createdAt: new Date().toISOString(), lines: lines.map((line) => { const p = product(snapshot, text(line.productId)); const c = cell(snapshot, text(line.cellId)); return { id: crypto.randomUUID(), productId: text(line.productId), cellId: text(line.cellId), quantity: number(line.quantity), unit: text(line.unit) || text(p?.unit), productName: text(p?.name), cellCode: text(c?.code) }; }) });
  } else if (action === "inventorySnapshot") {
    const products = new Map((snapshot.products || []).map((x) => [text(x.id), x]));
    const cells = new Map((snapshot.cells || []).map((x) => [text(x.id), x]));
    const rows = (snapshot.stocks || []).filter((x) => number(x.quantity) > 0).map((x) => ({ productId: text(x.productId), name: text(products.get(text(x.productId))?.name), sku: text(products.get(text(x.productId))?.sku), unit: text(products.get(text(x.productId))?.unit), cellId: text(x.cellId), cellCode: text(cells.get(text(x.cellId))?.code), quantity: number(x.quantity) }));
    const inventories = snapshot.inventories ||= [];
    inventories.unshift({ id: crypto.randomUUID(), warehouseCode, snapshotJson: JSON.stringify(rows), createdBy: operator, createdAt: new Date().toISOString(), offline: true });
  } else {
    throw new Error("Эта операция пока требует подключения к центральной базе");
  }

  saveLocalSnapshot(scope, snapshot);
  return { ok: true, offline: true, pendingSync: true, action };
}
