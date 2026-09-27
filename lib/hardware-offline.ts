import { loadLocalSnapshot, saveLocalSnapshot } from "@/lib/local-resilience";

type Row = Record<string, unknown>;
type HardwareSnapshot = {
  racks?: Row[];
  cells?: Row[];
  products?: Row[];
  stocks?: Row[];
  movements?: Row[];
  activities?: Row[];
  documents?: Row[];
  [key: string]: unknown;
};

const text = (value: unknown) => String(value ?? "").trim();
const num = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const id = () => crypto.randomUUID();

function stockIndex(stocks: Row[], productId: string, cellId: string) {
  return stocks.findIndex((row) => text(row.productId) === productId && text(row.cellId) === cellId);
}

function changeStock(stocks: Row[], productId: string, cellId: string, delta: number) {
  const index = stockIndex(stocks, productId, cellId);
  const now = new Date().toISOString();
  if (index >= 0) {
    const next = num(stocks[index].quantity) + delta;
    if (next < -1e-9) throw new Error("Недостаточно остатка");
    if (next <= 1e-9) stocks.splice(index, 1);
    else stocks[index] = { ...stocks[index], quantity: next, updatedAt: now };
  } else {
    if (delta < 0) throw new Error("Недостаточно остатка");
    if (delta > 0) stocks.push({ productId, cellId, quantity: delta, updatedAt: now });
  }
}

function findProduct(products: Row[], productId: string) {
  const product = products.find((row) => text(row.id) === productId);
  if (!product) throw new Error("Материал не найден в локальном снимке");
  return product;
}

function findCell(cells: Row[], cellId: string) {
  const cell = cells.find((row) => text(row.id) === cellId);
  if (!cell) throw new Error("Ячейка не найдена в локальном снимке");
  if (Boolean(cell.blocked)) throw new Error("Ячейка заблокирована");
  return cell;
}

function movement(snapshot: HardwareSnapshot, row: Row) {
  const movements = snapshot.movements ?? (snapshot.movements = []);
  movements.unshift({ id: id(), createdAt: new Date().toISOString(), ...row });
  if (movements.length > 300) movements.length = 300;
}

function activity(snapshot: HardwareSnapshot, operator: string, action: string, entityType: string, entityId: string, entityName: string, details: string) {
  const activities = snapshot.activities ?? (snapshot.activities = []);
  activities.unshift({ id: id(), operator, action, entityType, entityId, entityName, details, createdAt: new Date().toISOString() });
  if (activities.length > 150) activities.length = 150;
}

export function applyHardwareOfflineOperation(scope: string, operator: string, body: Record<string, unknown>) {
  const cached = loadLocalSnapshot<HardwareSnapshot>(scope);
  if (!cached) throw new Error("Нет локального снимка склада. Сначала откройте склад при доступной базе.");

  const snapshot = structuredClone(cached.payload);
  const products = snapshot.products ?? (snapshot.products = []);
  const cells = snapshot.cells ?? (snapshot.cells = []);
  const stocks = snapshot.stocks ?? (snapshot.stocks = []);
  const documents = snapshot.documents ?? (snapshot.documents = []);
  const action = text(body.action);

  if (action === "receiveStock" || action === "placeStock") {
    const productId = text(body.productId);
    const cellId = text(body.cellId);
    const quantity = num(body.quantity);
    if (!productId || !cellId || quantity <= 0) throw new Error("Проверьте материал, ячейку и количество");
    const product = findProduct(products, productId);
    const cell = findCell(cells, cellId);
    changeStock(stocks, productId, cellId, quantity);
    const type = action === "receiveStock" ? "Приход" : (text(body.movementType) || "Приход");
    movement(snapshot, { type, quantity, operator, source: "offline", productName: product.name, productUnit: product.unit, cellCode: cell.code, recipient: text(body.supplier), comment: text(body.comment), documentNumber: text(body.documentNumber) });
    activity(snapshot, operator, type, "Материал", productId, text(product.name), `${quantity} ${text(product.unit)} → ${text(cell.code)}`);
    saveLocalSnapshot(scope, snapshot);
    return { ok: true, offline: true };
  }

  if (action === "transferStock") {
    const productId = text(body.productId);
    const fromCellId = text(body.fromCellId);
    const toCellId = text(body.toCellId);
    const quantity = num(body.quantity);
    if (!productId || !fromCellId || !toCellId || fromCellId === toCellId || quantity <= 0) throw new Error("Проверьте материал, ячейки и количество");
    const product = findProduct(products, productId);
    const fromCell = findCell(cells, fromCellId);
    const toCell = findCell(cells, toCellId);
    changeStock(stocks, productId, fromCellId, -quantity);
    changeStock(stocks, productId, toCellId, quantity);
    movement(snapshot, { type: "Перемещение · откуда", quantity: -quantity, operator, source: "offline", productName: product.name, productUnit: product.unit, cellCode: fromCell.code, comment: `${text(fromCell.code)} → ${text(toCell.code)}` });
    movement(snapshot, { type: "Перемещение · куда", quantity, operator, source: "offline", productName: product.name, productUnit: product.unit, cellCode: toCell.code, comment: `${text(fromCell.code)} → ${text(toCell.code)}` });
    activity(snapshot, operator, "Перемещение", "Материал", productId, text(product.name), `${quantity} ${text(product.unit)}: ${text(fromCell.code)} → ${text(toCell.code)}`);
    saveLocalSnapshot(scope, snapshot);
    return { ok: true, offline: true };
  }

  if (action === "createIssue") {
    const productId = text(body.productId);
    const quantity = num(body.quantity);
    const documentNumber = text(body.documentNumber).toUpperCase();
    const recipient = text(body.recipient);
    if (!productId || quantity <= 0 || !documentNumber || !recipient) throw new Error("Проверьте документ, получателя, материал и количество");
    const product = findProduct(products, productId);
    const total = stocks.filter((row) => text(row.productId) === productId).reduce((sum, row) => sum + num(row.quantity), 0);
    if (total < quantity) throw new Error(`Недостаточно материала. Доступно ${total} ${text(product.unit)}`);
    const documentId = id();
    documents.unshift({ id: documentId, number: documentNumber, type: "issue", status: "ready", recipient, productId, productName: product.name, productSku: product.sku, productUnit: product.unit, plannedQuantity: quantity, processedQuantity: 0, comment: text(body.comment), createdBy: operator, createdAt: new Date().toISOString(), syncStatus: "offline" });
    activity(snapshot, operator, "Задание на выдачу", "Документ", documentId, documentNumber, `${text(product.name)}: ${quantity} ${text(product.unit)} → ${recipient}`);
    saveLocalSnapshot(scope, snapshot);
    return { ok: true, offline: true, documentId };
  }

  if (action === "issueStock") {
    const documentId = text(body.documentId);
    const cellId = text(body.cellId);
    const quantity = num(body.quantity);
    const rows = documents.filter((row) => text(row.id) === documentId);
    const doc = rows[0];
    if (!doc) throw new Error("Задание на выдачу не найдено в локальном снимке");
    const productId = text(doc.productId);
    const product = findProduct(products, productId);
    const cell = findCell(cells, cellId);
    const planned = num(doc.plannedQuantity);
    const processed = num(doc.processedQuantity);
    if (quantity <= 0 || processed + quantity > planned + 1e-9) throw new Error("Количество превышает остаток по заданию");
    changeStock(stocks, productId, cellId, -quantity);
    const nextProcessed = processed + quantity;
    for (const row of rows) {
      row.processedQuantity = nextProcessed;
      row.status = Math.abs(nextProcessed - planned) < 1e-9 ? "completed" : "partial";
      if (row.status === "completed") row.completedAt = new Date().toISOString();
    }
    movement(snapshot, { type: "Выдача", quantity: -quantity, operator, source: "offline", productName: product.name, productUnit: product.unit, cellCode: cell.code, recipient: doc.recipient, comment: text(body.comment) || text(doc.comment), documentNumber: doc.number });
    activity(snapshot, operator, "Выдача", "Документ", documentId, text(doc.number), `${text(product.name)}: ${quantity} ${text(product.unit)} · ${text(cell.code)} → ${text(doc.recipient)}`);
    saveLocalSnapshot(scope, snapshot);
    return { ok: true, offline: true, completed: Math.abs(nextProcessed - planned) < 1e-9 };
  }

  if (action === "setBlocked") {
    const cellId = text(body.cellId);
    const cell = cells.find((row) => text(row.id) === cellId);
    if (!cell) throw new Error("Ячейка не найдена");
    cell.blocked = Boolean(body.blocked);
    activity(snapshot, operator, cell.blocked ? "Блокировка" : "Разблокировка", "Ячейка", cellId, text(cell.code), "");
    saveLocalSnapshot(scope, snapshot);
    return { ok: true, offline: true };
  }

  throw new Error(`Операция «${action || "неизвестная"}» пока недоступна без центральной базы`);
}
