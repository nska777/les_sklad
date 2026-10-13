/**
 * Domain rules for semi-finished production goods.
 *
 * The warehouse distinguishes manufactured-to-order parts from free stock.
 * A document is the unit of acceptance/issue: all lines must succeed or none.
 * Database mutations are intentionally delegated to a transactional service.
 */
export type SemiDocumentKind = "production_receipt" | "assembly_issue" | "rework_return";
export type SemiStockPurpose = "order" | "free";
export type SemiDocumentStatus = "draft" | "posted" | "cancelled";

export interface SemiDocumentLineInput {
  productId: string;
  cellId: string;
  quantity: number;
}

export interface SemiDocumentInput {
  kind: SemiDocumentKind;
  number: string;
  purpose: SemiStockPurpose;
  orderNumber?: string;
  masterName?: string;
  recipient?: string;
  comment?: string;
  lines: SemiDocumentLineInput[];
}

export class SemiValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SemiValidationError";
  }
}

const text = (value: unknown, max = 160) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

export function validateSemiDocument(value: unknown): SemiDocumentInput {
  if (!value || typeof value !== "object") throw new SemiValidationError("Не указан документ");
  const input = value as Record<string, unknown>;
  const kind = input.kind;
  if (kind !== "production_receipt" && kind !== "assembly_issue" && kind !== "rework_return")
    throw new SemiValidationError("Неизвестный вид документа");
  const purpose = input.purpose;
  if (purpose !== "order" && purpose !== "free")
    throw new SemiValidationError("Укажите назначение: под заказ или в запас");

  const number = text(input.number, 64);
  const orderNumber = text(input.orderNumber, 100);
  const masterName = text(input.masterName);
  const recipient = text(input.recipient);
  const comment = text(input.comment, 1000);
  if (!number) throw new SemiValidationError("Укажите номер документа");
  if (purpose === "order" && !orderNumber)
    throw new SemiValidationError("Для изделия под заказ укажите номер заказа");
  if (kind === "production_receipt" && !masterName)
    throw new SemiValidationError("Укажите мастера, сдавшего изделия");
  if (kind === "assembly_issue" && !recipient)
    throw new SemiValidationError("Укажите получателя на сборке");
  if (!Array.isArray(input.lines) || input.lines.length === 0 || input.lines.length > 200)
    throw new SemiValidationError("Документ должен содержать от 1 до 200 позиций");

  const lines = input.lines.map((raw, index) => {
    if (!raw || typeof raw !== "object") throw new SemiValidationError(`Строка ${index + 1}: некорректные данные`);
    const line = raw as Record<string, unknown>;
    const productId = text(line.productId, 100);
    const cellId = text(line.cellId, 100);
    const quantity = line.quantity;
    if (!productId || !cellId || typeof quantity !== "number" ||
        !Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000)
      throw new SemiValidationError(`Строка ${index + 1}: проверьте изделие, ячейку и количество`);
    return { productId, cellId, quantity };
  });
  const unique = new Set(lines.map((line) => `${line.productId}:\u0000${line.cellId}`));
  if (unique.size !== lines.length)
    throw new SemiValidationError("Повторяющиеся изделие и ячейка: объедините количество в одну строку");
  return { kind, number, purpose, orderNumber, masterName, recipient, comment, lines };
}
