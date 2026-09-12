import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { activityLogs, cells, movements, products, racks, stocks, warehouseDocumentLines, warehouseDocuments } from "@/db/schema";

export const dynamic = "force-dynamic";
const clean = (value: unknown) => String(value ?? "").trim();
const number = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const cellAddress = (rackCode: string, shelfIndex: number, cellIndex: number) =>
  `${rackCode}${shelfIndex + 1}${String.fromCharCode(65 + cellIndex)}`;

async function createUniqueSku(db: Awaited<ReturnType<typeof getDb>>) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const date = new Date().toISOString().slice(2, 10).replaceAll("-", "");
    const suffix = crypto.randomUUID().slice(0, 4).toUpperCase();
    const sku = `MAT-${date}-${suffix}`;
    const [duplicate] = await db.select({ id: products.id }).from(products).where(eq(products.sku, sku)).limit(1);
    if (!duplicate) return sku;
  }
  return `MAT-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
}

function errorDetails(error: unknown) {
  const messages: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (current instanceof Error) {
      if (current.message && !messages.includes(current.message)) messages.push(current.message);
      current = current.cause;
    } else {
      const text = String(current);
      if (text && !messages.includes(text)) messages.push(text);
      break;
    }
  }
  return messages.join(" — ");
}

export async function GET() {
  try {
    const db = await getDb();
    const [rackRows, allCellRows, productRows, stockRows, movementRows, activityRows, documentRows] = await Promise.all([
      db.select().from(racks).where(eq(racks.archived, false)).orderBy(asc(racks.code)),
      db.select().from(cells).orderBy(asc(cells.rackId), asc(cells.rowIndex), asc(cells.columnIndex)),
      db.select().from(products).orderBy(asc(products.name)),
      db.select().from(stocks).where(sql`${stocks.quantity} > 0`),
      db.select({ id: movements.id, type: movements.type, quantity: movements.quantity, operator: movements.operator,
        source: movements.source, createdAt: movements.createdAt, productName: products.name,
        productUnit: products.unit, cellCode: cells.code, recipient: movements.recipient,
        comment: movements.comment, documentNumber: warehouseDocuments.number })
        .from(movements).innerJoin(products, eq(movements.productId, products.id))
        .innerJoin(cells, eq(movements.cellId, cells.id))
        .leftJoin(warehouseDocuments, eq(movements.documentId, warehouseDocuments.id))
        .orderBy(desc(movements.createdAt)).limit(200),
      db.select().from(activityLogs).orderBy(desc(activityLogs.createdAt)).limit(100),
      db.select({ id: warehouseDocuments.id, number: warehouseDocuments.number, type: warehouseDocuments.type,
        status: warehouseDocuments.status, counterparty: warehouseDocuments.counterparty,
        recipient: warehouseDocuments.recipient, oneCId: warehouseDocuments.oneCId,
        syncStatus: warehouseDocuments.syncStatus, comment: warehouseDocuments.comment,
        createdBy: warehouseDocuments.createdBy, createdAt: warehouseDocuments.createdAt,
        completedAt: warehouseDocuments.completedAt, lineId: warehouseDocumentLines.id,
        productId: warehouseDocumentLines.productId, productName: products.name, productSku: products.sku,
        productUnit: products.unit, plannedQuantity: warehouseDocumentLines.plannedQuantity,
        processedQuantity: warehouseDocumentLines.processedQuantity })
        .from(warehouseDocuments)
        .innerJoin(warehouseDocumentLines, eq(warehouseDocumentLines.documentId, warehouseDocuments.id))
        .innerJoin(products, eq(warehouseDocumentLines.productId, products.id))
        .orderBy(desc(warehouseDocuments.createdAt)).limit(200),
    ]);
    const rackById = new Map(rackRows.map((rack) => [rack.id, rack]));
    const activeRackIds = new Set(rackRows.map((rack) => rack.id));
    const cellRows = allCellRows.filter((cell) => activeRackIds.has(cell.rackId)).map((cell) => {
      const rack = rackById.get(cell.rackId);
      const address = rack ? cellAddress(rack.code, cell.rowIndex, cell.columnIndex) : cell.code;
      return { ...cell, code: address, label: address };
    });
    return Response.json({ racks: rackRows, cells: cellRows, products: productRows, stocks: stockRows, movements: movementRows, activities: activityRows, documents: documentRows });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось загрузить склад" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = clean(body.action);
    const db = await getDb();
    const operator = clean(body.operator) || "Кладовщик";
    const logActivity = (entry: { action: string; entityType: string; entityId: string; entityName: string; details?: string }) =>
      db.insert(activityLogs).values({ id: crypto.randomUUID(), operator, details: "", ...entry });

    if (action === "createRack") {
      const name = clean(body.name);
      const code = clean(body.code).toUpperCase();
      const rowCount = Math.min(12, Math.max(1, Math.floor(number(body.rows, 4))));
      const columnCount = Math.min(12, Math.max(1, Math.floor(number(body.columns, 4))));
      if (!name || !code) return Response.json({ error: "Укажите название и код стеллажа" }, { status: 400 });
      const [existingRack] = await db.select().from(racks).where(eq(racks.code, code)).limit(1);
      if (existingRack?.archived) return Response.json({ error: "Этот код использовался у ранее удалённого стеллажа. Укажите другой код" }, { status: 409 });
      const rackId = existingRack?.id ?? crypto.randomUUID();
      if (existingRack) {
        const existingCells = await db.select({ id: cells.id }).from(cells).where(eq(cells.rackId, rackId));
        if (existingCells.length === rowCount * columnCount) {
          return Response.json({ ok: true, reused: true });
        }
        await db.delete(cells).where(eq(cells.rackId, rackId));
        await db.update(racks).set({ name, rows: rowCount, columns: columnCount }).where(eq(racks.id, rackId));
      } else {
        await db.insert(racks).values({ id: rackId, name, code, rows: rowCount, columns: columnCount });
      }
      const values = Array.from({ length: rowCount * columnCount }, (_, index) => {
        const rowIndex = Math.floor(index / columnCount);
        const columnIndex = index % columnCount;
        const address = cellAddress(code, rowIndex, columnIndex);
        return { id: crypto.randomUUID(), rackId, code: address,
          label: address, rowIndex, columnIndex };
      });
      try {
        for (let index = 0; index < values.length; index += 8) {
          await db.insert(cells).values(values.slice(index, index + 8));
        }
      } catch (error) {
        await db.delete(cells).where(eq(cells.rackId, rackId));
        await db.delete(racks).where(eq(racks.id, rackId));
        throw error;
      }
      await logActivity({ action: "Создание", entityType: "Стеллаж", entityId: rackId, entityName: `${name} (${code})`, details: `${rowCount} полок × ${columnCount} ячеек` });
      return Response.json({ ok: true }, { status: 201 });
    }

    if (action === "updateRack") {
      const rackId = clean(body.rackId);
      const name = clean(body.name);
      const code = clean(body.code).toUpperCase();
      const rowCount = Math.min(12, Math.max(1, Math.floor(number(body.rows, 4))));
      const columnCount = Math.min(12, Math.max(1, Math.floor(number(body.columns, 4))));
      if (!rackId || !name || !code) return Response.json({ error: "Укажите название и код стеллажа" }, { status: 400 });
      const [rack] = await db.select().from(racks).where(and(eq(racks.id, rackId), eq(racks.archived, false))).limit(1);
      if (!rack) return Response.json({ error: "Стеллаж не найден" }, { status: 404 });
      const [duplicate] = await db.select({ id: racks.id }).from(racks).where(and(eq(racks.code, code), ne(racks.id, rackId))).limit(1);
      if (duplicate) return Response.json({ error: "Такой код стеллажа уже существует" }, { status: 409 });
      const rackStocks = await db.select({ quantity: stocks.quantity }).from(stocks)
        .innerJoin(cells, eq(stocks.cellId, cells.id)).where(eq(cells.rackId, rackId));
      const layoutChanged = rack.rows !== rowCount || rack.columns !== columnCount;
      if (layoutChanged && rackStocks.some((stock) => stock.quantity > 0)) {
        return Response.json({ error: "Нельзя менять количество полок и ячеек, пока в стеллаже есть материал" }, { status: 409 });
      }
      const oldCells = await db.select().from(cells).where(eq(cells.rackId, rackId));
      if (layoutChanged) {
        await db.delete(cells).where(eq(cells.rackId, rackId));
        const values = Array.from({ length: rowCount * columnCount }, (_, index) => {
          const rowIndex = Math.floor(index / columnCount);
          const columnIndex = index % columnCount;
          const address = cellAddress(code, rowIndex, columnIndex);
          return { id: crypto.randomUUID(), rackId, code: address,
            label: address, rowIndex, columnIndex };
        });
        for (let index = 0; index < values.length; index += 8) await db.insert(cells).values(values.slice(index, index + 8));
      } else if (rack.code !== code) {
        for (const cell of oldCells) {
          const address = cellAddress(code, cell.rowIndex, cell.columnIndex);
          await db.update(cells).set({ code: address, label: address }).where(eq(cells.id, cell.id));
        }
      }
      await db.update(racks).set({ name, code, rows: rowCount, columns: columnCount }).where(eq(racks.id, rackId));
      await logActivity({ action: "Редактирование", entityType: "Стеллаж", entityId: rackId, entityName: `${name} (${code})`,
        details: `${rack.name} (${rack.code}), ${rack.rows}×${rack.columns} → ${name} (${code}), ${rowCount}×${columnCount}` });
      return Response.json({ ok: true });
    }

    if (action === "deleteRack") {
      const rackId = clean(body.rackId);
      const [rack] = await db.select().from(racks).where(and(eq(racks.id, rackId), eq(racks.archived, false))).limit(1);
      if (!rack) return Response.json({ error: "Стеллаж не найден" }, { status: 404 });
      const rackStocks = await db.select({ quantity: stocks.quantity }).from(stocks)
        .innerJoin(cells, eq(stocks.cellId, cells.id)).where(eq(cells.rackId, rackId));
      if (rackStocks.some((stock) => stock.quantity > 0)) {
        return Response.json({ error: "Сначала переместите или спишите весь материал из этого стеллажа" }, { status: 409 });
      }
      await db.update(racks).set({ archived: true }).where(eq(racks.id, rackId));
      await logActivity({ action: "Удаление", entityType: "Стеллаж", entityId: rackId, entityName: `${rack.name} (${rack.code})`, details: "Стеллаж удалён из рабочего списка" });
      return Response.json({ ok: true });
    }

    if (action === "generateSku") {
      return Response.json({ sku: await createUniqueSku(db) });
    }

    if (action === "createProduct") {
      const name = clean(body.name);
      const sku = clean(body.sku).toUpperCase() || await createUniqueSku(db);
      const barcode = clean(body.barcode) || `RL-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const initialQuantity = number(body.initialQuantity);
      const cellId = clean(body.cellId);
      if (!name) return Response.json({ error: "Название материала обязательно" }, { status: 400 });
      if (initialQuantity <= 0 || !cellId) {
        return Response.json({ error: "Укажите начальное количество и ячейку хранения" }, { status: 400 });
      }
      const [cell] = await db.select().from(cells).where(eq(cells.id, cellId)).limit(1);
      if (!cell || cell.blocked) return Response.json({ error: "Выбранная ячейка недоступна" }, { status: 409 });
      const productId = crypto.randomUUID();
      const unit = clean(body.unit) || "шт.";
      try {
        await db.insert(products).values({ id: productId, name, sku, barcode,
          category: clean(body.category) || "Фурнитура", unit,
          packQty: Math.max(0.001, number(body.packQty, 1)), imageUrl: clean(body.imageUrl),
          minStock: Math.max(0, number(body.minStock, 0)) });
        await db.insert(stocks).values({ productId, cellId, quantity: initialQuantity });
        await db.insert(movements).values({ id: crypto.randomUUID(), type: "Первичный учёт", productId,
          cellId, quantity: initialQuantity, operator, source: "product-create",
          comment: "Начальный остаток при создании материала" });
      } catch (error) {
        await db.delete(products).where(eq(products.id, productId)).catch(() => undefined);
        throw error;
      }
      await logActivity({ action: "Создание и размещение", entityType: "Материал", entityId: productId,
        entityName: `${name} (${sku})`, details: `${initialQuantity} ${unit} → ${cell.code} · штрихкод: ${barcode}` });
      return Response.json({ ok: true, barcode }, { status: 201 });
    }

    if (action === "updateProduct") {
      const productId = clean(body.productId);
      const [product] = await db.select().from(products).where(eq(products.id, productId)).limit(1);
      if (!product) return Response.json({ error: "Материал не найден" }, { status: 404 });
      const name = clean(body.name);
      const sku = clean(body.sku).toUpperCase() || product.sku;
      const barcode = clean(body.barcode) || product.barcode;
      if (!name) return Response.json({ error: "Название материала обязательно" }, { status: 400 });
      const next = {
        name, sku, barcode, category: clean(body.category) || "Прочее", unit: clean(body.unit) || "шт.",
        packQty: Math.max(0.001, number(body.packQty, 1)), imageUrl: clean(body.imageUrl),
        minStock: Math.max(0, number(body.minStock, 0)),
      };
      await db.update(products).set(next).where(eq(products.id, productId));
      const changes = [
        product.name !== next.name && `название: «${product.name}» → «${next.name}»`,
        product.sku !== next.sku && `артикул: ${product.sku} → ${next.sku}`,
        product.barcode !== next.barcode && `штрихкод: ${product.barcode} → ${next.barcode}`,
        product.category !== next.category && `категория: ${product.category} → ${next.category}`,
        product.unit !== next.unit && `единица: ${product.unit} → ${next.unit}`,
        product.packQty !== next.packQty && `в упаковке: ${product.packQty} → ${next.packQty}`,
        product.minStock !== next.minStock && `минимальный остаток: ${product.minStock} → ${next.minStock}`,
        product.imageUrl !== next.imageUrl && "изменена фотография",
      ].filter(Boolean).join("; ");
      await logActivity({ action: "Редактирование", entityType: "Материал", entityId: productId,
        entityName: `${next.name} (${next.sku})`, details: changes || "Данные сохранены без изменений" });
      return Response.json({ ok: true });
    }

    if (action === "receiveStock") {
      const productId = clean(body.productId);
      const cellId = clean(body.cellId);
      const quantity = number(body.quantity);
      const documentNumber = clean(body.documentNumber).toUpperCase();
      const supplier = clean(body.supplier);
      const comment = clean(body.comment);
      const oneCId = clean(body.oneCId) || null;
      if (!productId || !cellId || quantity <= 0 || !documentNumber) {
        return Response.json({ error: "Укажите документ, материал, ячейку и фактическое количество" }, { status: 400 });
      }
      const [[product], [cell]] = await Promise.all([
        db.select().from(products).where(eq(products.id, productId)).limit(1),
        db.select().from(cells).where(eq(cells.id, cellId)).limit(1),
      ]);
      if (!product) return Response.json({ error: "Материал не найден" }, { status: 404 });
      if (!cell || cell.blocked) return Response.json({ error: "Ячейка недоступна" }, { status: 409 });
      const documentId = crypto.randomUUID();
      await db.insert(warehouseDocuments).values({ id: documentId, number: documentNumber, type: "receipt",
        status: "completed", counterparty: supplier, oneCId, syncStatus: oneCId ? "linked" : "pending",
        comment, createdBy: operator, completedAt: new Date().toISOString() });
      await db.insert(warehouseDocumentLines).values({ id: crypto.randomUUID(), documentId, productId,
        plannedQuantity: quantity, processedQuantity: quantity });
      await db.insert(stocks).values({ productId, cellId, quantity }).onConflictDoUpdate({
        target: [stocks.productId, stocks.cellId], set: { quantity: sql`${stocks.quantity} + ${quantity}`, updatedAt: sql`CURRENT_TIMESTAMP` },
      });
      await db.insert(movements).values({ id: crypto.randomUUID(), type: "Приход", productId, cellId, quantity,
        operator, source: "receipt", documentId, recipient: supplier, comment });
      await logActivity({ action: "Приёмка", entityType: "Документ", entityId: documentId,
        entityName: documentNumber, details: `${product.name}: ${quantity} ${product.unit} → ${cell.code}${supplier ? ` · ${supplier}` : ""}` });
      return Response.json({ ok: true, documentId }, { status: 201 });
    }

    if (action === "createIssue") {
      const productId = clean(body.productId);
      const plannedQuantity = number(body.quantity);
      const documentNumber = clean(body.documentNumber).toUpperCase();
      const recipient = clean(body.recipient);
      const comment = clean(body.comment);
      const oneCId = clean(body.oneCId) || null;
      if (!productId || plannedQuantity <= 0 || !documentNumber || !recipient) {
        return Response.json({ error: "Укажите номер документа, получателя, материал и количество" }, { status: 400 });
      }
      const [product] = await db.select().from(products).where(eq(products.id, productId)).limit(1);
      if (!product) return Response.json({ error: "Материал не найден" }, { status: 404 });
      const [availableRows, reservationRows] = await Promise.all([
        db.select({ quantity: stocks.quantity }).from(stocks).where(eq(stocks.productId, productId)),
        db.select({ planned: warehouseDocumentLines.plannedQuantity, processed: warehouseDocumentLines.processedQuantity })
          .from(warehouseDocumentLines).innerJoin(warehouseDocuments, eq(warehouseDocumentLines.documentId, warehouseDocuments.id))
          .where(and(eq(warehouseDocumentLines.productId, productId), eq(warehouseDocuments.type, "issue"), ne(warehouseDocuments.status, "completed"))),
      ]);
      const available = availableRows.reduce((sum, row) => sum + row.quantity, 0);
      const reserved = reservationRows.reduce((sum, row) => sum + row.planned - row.processed, 0);
      const free = available - reserved;
      if (free < plannedQuantity) {
        return Response.json({ error: `Недостаточно свободного материала. Доступно ${free} ${product.unit}, ещё ${reserved} зарезервировано` }, { status: 409 });
      }
      const documentId = crypto.randomUUID();
      await db.insert(warehouseDocuments).values({ id: documentId, number: documentNumber, type: "issue",
        status: "ready", recipient, oneCId, syncStatus: oneCId ? "linked" : "pending", comment, createdBy: operator });
      await db.insert(warehouseDocumentLines).values({ id: crypto.randomUUID(), documentId, productId,
        plannedQuantity, processedQuantity: 0 });
      await logActivity({ action: "Задание на выдачу", entityType: "Документ", entityId: documentId,
        entityName: documentNumber, details: `${product.name}: ${plannedQuantity} ${product.unit} → ${recipient}` });
      return Response.json({ ok: true, documentId }, { status: 201 });
    }

    if (action === "issueStock") {
      const documentId = clean(body.documentId);
      const cellId = clean(body.cellId);
      const quantity = number(body.quantity);
      if (!documentId || !cellId || quantity <= 0) {
        return Response.json({ error: "Выберите задание, ячейку и количество" }, { status: 400 });
      }
      const [document] = await db.select().from(warehouseDocuments).where(eq(warehouseDocuments.id, documentId)).limit(1);
      const [line] = await db.select().from(warehouseDocumentLines).where(eq(warehouseDocumentLines.documentId, documentId)).limit(1);
      if (!document || document.type !== "issue" || !line) return Response.json({ error: "Задание на выдачу не найдено" }, { status: 404 });
      if (document.status === "completed") return Response.json({ error: "Это задание уже выполнено" }, { status: 409 });
      const remaining = line.plannedQuantity - line.processedQuantity;
      if (quantity > remaining) return Response.json({ error: `По заданию осталось выдать ${remaining}` }, { status: 409 });
      const [[cell], [stock], [product]] = await Promise.all([
        db.select().from(cells).where(eq(cells.id, cellId)).limit(1),
        db.select().from(stocks).where(and(eq(stocks.productId, line.productId), eq(stocks.cellId, cellId))).limit(1),
        db.select().from(products).where(eq(products.id, line.productId)).limit(1),
      ]);
      if (!cell || cell.blocked) return Response.json({ error: "Ячейка недоступна" }, { status: 409 });
      if (!stock || stock.quantity < quantity) {
        return Response.json({ error: `В этой ячейке недостаточно материала. Доступно ${stock?.quantity || 0}` }, { status: 409 });
      }
      const processedQuantity = line.processedQuantity + quantity;
      const completed = Math.abs(processedQuantity - line.plannedQuantity) < 0.000001;
      await db.update(stocks).set({ quantity: stock.quantity - quantity, updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(and(eq(stocks.productId, line.productId), eq(stocks.cellId, cellId)));
      await db.update(warehouseDocumentLines).set({ processedQuantity }).where(eq(warehouseDocumentLines.id, line.id));
      await db.update(warehouseDocuments).set({ status: completed ? "completed" : "partial",
        completedAt: completed ? new Date().toISOString() : null }).where(eq(warehouseDocuments.id, documentId));
      await db.insert(movements).values({ id: crypto.randomUUID(), type: "Выдача", productId: line.productId,
        cellId, quantity: -quantity, operator, source: "issue", documentId, recipient: document.recipient,
        comment: clean(body.comment) || document.comment });
      await logActivity({ action: "Выдача", entityType: "Документ", entityId: documentId,
        entityName: document.number, details: `${product?.name || "Материал"}: ${quantity} ${product?.unit || "ед."} · ${cell.code} → ${document.recipient}` });
      return Response.json({ ok: true, completed });
    }

    if (action === "placeStock") {
      const productId = clean(body.productId);
      const cellId = clean(body.cellId);
      const quantity = number(body.quantity);
      const source = clean(body.source) || "web";
      const movementType = clean(body.movementType) === "Первичный учёт" ? "Первичный учёт" : "Приход";
      if (!productId || !cellId || quantity <= 0) return Response.json({ error: "Выберите товар, ячейку и количество" }, { status: 400 });
      const [cell] = await db.select().from(cells).where(eq(cells.id, cellId)).limit(1);
      if (!cell || cell.blocked) return Response.json({ error: "Ячейка недоступна" }, { status: 409 });
      await db.insert(stocks).values({ productId, cellId, quantity }).onConflictDoUpdate({
        target: [stocks.productId, stocks.cellId], set: { quantity: sql`${stocks.quantity} + ${quantity}`, updatedAt: sql`CURRENT_TIMESTAMP` },
      });
      await db.insert(movements).values({ id: crypto.randomUUID(), type: movementType, productId, cellId, quantity, operator, source });
      const [product] = await db.select().from(products).where(eq(products.id, productId)).limit(1);
      await logActivity({ action: movementType, entityType: "Материал", entityId: productId, entityName: product?.name || "Материал", details: `${quantity} ${product?.unit || "ед."} → ${cell.code}` });
      return Response.json({ ok: true }, { status: 201 });
    }

    if (action === "transferStock") {
      const productId = clean(body.productId);
      const fromCellId = clean(body.fromCellId);
      const toCellId = clean(body.toCellId);
      const quantity = number(body.quantity);
      const comment = clean(body.comment);
      if (!productId || !fromCellId || !toCellId || quantity <= 0) {
        return Response.json({ error: "Выберите материал, исходную ячейку, новую ячейку и количество" }, { status: 400 });
      }
      if (fromCellId === toCellId) {
        return Response.json({ error: "Исходная и новая ячейка должны отличаться" }, { status: 400 });
      }
      const [[product], [fromCell], [toCell], [sourceStock]] = await Promise.all([
        db.select().from(products).where(eq(products.id, productId)).limit(1),
        db.select().from(cells).where(eq(cells.id, fromCellId)).limit(1),
        db.select().from(cells).where(eq(cells.id, toCellId)).limit(1),
        db.select().from(stocks).where(and(eq(stocks.productId, productId), eq(stocks.cellId, fromCellId))).limit(1),
      ]);
      if (!product) return Response.json({ error: "Материал не найден" }, { status: 404 });
      if (!fromCell) return Response.json({ error: "Исходная ячейка не найдена" }, { status: 404 });
      if (!toCell || toCell.blocked) return Response.json({ error: "Новая ячейка недоступна" }, { status: 409 });
      if (!sourceStock || sourceStock.quantity < quantity) {
        return Response.json({ error: `В ячейке ${fromCell.code} доступно только ${sourceStock?.quantity || 0} ${product.unit}` }, { status: 409 });
      }
      const deducted = await db.update(stocks)
        .set({ quantity: sql`${stocks.quantity} - ${quantity}`, updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(and(eq(stocks.productId, productId), eq(stocks.cellId, fromCellId), sql`${stocks.quantity} >= ${quantity}`))
        .returning();
      if (!deducted.length) return Response.json({ error: "Остаток изменился. Обновите данные и повторите перемещение" }, { status: 409 });
      try {
        await db.insert(stocks).values({ productId, cellId: toCellId, quantity }).onConflictDoUpdate({
          target: [stocks.productId, stocks.cellId],
          set: { quantity: sql`${stocks.quantity} + ${quantity}`, updatedAt: sql`CURRENT_TIMESTAMP` },
        });
      } catch (error) {
        await db.update(stocks).set({ quantity: sql`${stocks.quantity} + ${quantity}`, updatedAt: sql`CURRENT_TIMESTAMP` })
          .where(and(eq(stocks.productId, productId), eq(stocks.cellId, fromCellId)));
        throw error;
      }
      const moveId = crypto.randomUUID();
      await db.insert(movements).values([
        { id: `${moveId}-out`, type: "Перемещение · откуда", productId, cellId: fromCellId, quantity: -quantity,
          operator, source: "transfer", comment: `${fromCell.code} → ${toCell.code}${comment ? ` · ${comment}` : ""}` },
        { id: `${moveId}-in`, type: "Перемещение · куда", productId, cellId: toCellId, quantity,
          operator, source: "transfer", comment: `${fromCell.code} → ${toCell.code}${comment ? ` · ${comment}` : ""}` },
      ]);
      await logActivity({ action: "Перемещение", entityType: "Материал", entityId: productId,
        entityName: `${product.name} (${product.sku})`, details: `${quantity} ${product.unit}: ${fromCell.code} → ${toCell.code}${comment ? ` · ${comment}` : ""}` });
      return Response.json({ ok: true }, { status: 201 });
    }

    if (action === "setBlocked") {
      const cellId = clean(body.cellId);
      const blocked = Boolean(body.blocked);
      const [cell] = await db.select().from(cells).where(eq(cells.id, cellId)).limit(1);
      if (!cell) return Response.json({ error: "Ячейка не найдена" }, { status: 404 });
      await db.update(cells).set({ blocked }).where(eq(cells.id, cellId));
      await logActivity({ action: blocked ? "Блокировка" : "Разблокировка", entityType: "Ячейка", entityId: cellId, entityName: cell.code });
      return Response.json({ ok: true });
    }
    return Response.json({ error: "Неизвестная операция" }, { status: 400 });
  } catch (error) {
    const message = errorDetails(error) || "Операция не выполнена";
    const duplicate = /UNIQUE|constraint failed/i.test(message);
    return Response.json({ error: duplicate ? "Такой код или артикул уже существует" : message }, { status: duplicate ? 409 : 500 });
  }
}
