import * as XLSX from "xlsx";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";

export const dynamic = "force-dynamic";

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows as T[];
  }
  return [];
}

const safe = (value: string) => value.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, "_").slice(0, 80);
const qty = (value: number) => Number(value || 0);

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const scope = (url.searchParams.get("scope") || "all").toLowerCase();
    const rackCode = (url.searchParams.get("rackCode") || "").trim();
    const cellCode = (url.searchParams.get("cellCode") || "").trim();

    if (!(["all", "rack", "cell"] as const).includes(scope as "all" | "rack" | "cell")) {
      return Response.json({ error: "Неизвестный режим выгрузки" }, { status: 400 });
    }
    if (scope === "rack" && !rackCode) return Response.json({ error: "Не указан стеллаж" }, { status: 400 });
    if (scope === "cell" && !cellCode) return Response.json({ error: "Не указана ячейка" }, { status: 400 });

    const db = await getDb();
    const result = await db.execute(sql`
      SELECT
        p.id AS "productId",
        p.name,
        p.sku,
        p.barcode,
        p.unit,
        s.quantity::double precision AS quantity,
        c.code AS "cellCode",
        c.side,
        c.row_index AS "rowIndex",
        c.column_index AS "columnIndex",
        r.code AS "rackCode",
        r.name AS "rackName",
        COALESCE(om.available_1c, 0)::double precision AS "available1c",
        SUM(s.quantity) OVER (PARTITION BY p.id)::double precision AS "productTotal"
      FROM stocks s
      JOIN products p ON p.id = s.product_id
      JOIN cells c ON c.id = s.cell_id
      JOIN racks r ON r.id = c.rack_id
      LEFT JOIN onec_materials om ON om.linked_product_id = p.id
      WHERE s.quantity > 0
        AND r.archived = false
        AND (${scope !== "rack"} OR r.code = ${rackCode})
        AND (${scope !== "cell"} OR c.code = ${cellCode})
      ORDER BY r.code, c.side, c.row_index, c.column_index, p.name
    `);

    const rows = rowsOf<{
      productId: string;
      name: string;
      sku: string;
      barcode: string;
      unit: string;
      quantity: number;
      cellCode: string;
      side: "front" | "back";
      rowIndex: number;
      columnIndex: number;
      rackCode: string;
      rackName: string;
      available1c: number;
      productTotal: number;
    }>(result);

    const now = new Date();
    const generated = new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tashkent" }).format(now);
    const scopeTitle = scope === "rack" ? `Стеллаж ${rackCode}` : scope === "cell" ? `Ячейка ${cellCode}` : "Весь склад";

    const wb = XLSX.utils.book_new();
    wb.Props = {
      Title: `Остатки склада — ${scopeTitle}`,
      Subject: "Фактические остатки по местам хранения",
      Author: "Русский Лес — Склад",
      CreatedDate: now,
    };

    const data: (string | number)[][] = [
      ["РУССКИЙ ЛЕС · СКЛАД — ОСТАТКИ"],
      [scopeTitle],
      [`Сформировано: ${generated}`],
      [],
      ["Материал", "RL-код", "Штрихкод", "Факт в ячейке", "Ед.", "Стеллаж", "Сторона", "Полка", "Ячейка", "Факт всего", "Остаток 1С", "Излишек"],
      ...rows.map((row) => [
        row.name,
        row.sku,
        row.barcode || row.sku,
        qty(row.quantity),
        row.unit || "шт.",
        `${row.rackCode}${row.rackName && row.rackName !== row.rackCode ? ` · ${row.rackName}` : ""}`,
        row.side === "front" ? "Лицевая" : "Задняя",
        row.rowIndex + 1,
        row.cellCode,
        qty(row.productTotal),
        qty(row.available1c),
        Math.max(0, qty(row.productTotal) - qty(row.available1c)),
      ]),
    ];

    if (!rows.length) data.push(["Нет фактических остатков для выбранного объекта"]);

    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 11 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 11 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: 11 } },
    ];
    ws["!cols"] = [
      { wch: 42 }, { wch: 14 }, { wch: 18 }, { wch: 14 }, { wch: 8 }, { wch: 24 },
      { wch: 12 }, { wch: 8 }, { wch: 15 }, { wch: 13 }, { wch: 13 }, { wch: 12 },
    ];
    ws["!rows"] = [{ hpt: 28 }, { hpt: 22 }, { hpt: 18 }, { hpt: 8 }, { hpt: 24 }];
    if (rows.length) ws["!autofilter"] = { ref: `A5:L${rows.length + 5}` };
    (ws as Record<string, unknown>)["!freeze"] = { xSplit: 0, ySplit: 5, topLeftCell: "A6", activePane: "bottomLeft", state: "frozen" };
    XLSX.utils.book_append_sheet(wb, ws, "Остатки");

    const aggregate = new Map<string, { name: string; sku: string; unit: string; total: number; onec: number; excess: number; locations: string[] }>();
    for (const row of rows) {
      const current = aggregate.get(row.productId) || { name: row.name, sku: row.sku, unit: row.unit || "шт.", total: row.productTotal, onec: row.available1c, excess: Math.max(0, row.productTotal - row.available1c), locations: [] };
      current.locations.push(`${row.cellCode} — ${qty(row.quantity)} ${row.unit || "шт."}`);
      aggregate.set(row.productId, current);
    }

    const summaryData: (string | number)[][] = [
      ["СВОДКА ПО МАТЕРИАЛАМ"],
      [scopeTitle],
      [],
      ["Материал", "RL-код", "Факт всего", "Ед.", "Остаток 1С", "Излишек", "Где лежит"],
      ...Array.from(aggregate.values()).sort((a, b) => a.name.localeCompare(b.name, "ru")).map((item) => [
        item.name, item.sku, qty(item.total), item.unit, qty(item.onec), qty(item.excess), item.locations.join("; "),
      ]),
    ];
    const summary = XLSX.utils.aoa_to_sheet(summaryData);
    summary["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 6 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 6 } },
    ];
    summary["!cols"] = [{ wch: 42 }, { wch: 14 }, { wch: 14 }, { wch: 8 }, { wch: 13 }, { wch: 12 }, { wch: 60 }];
    summary["!rows"] = [{ hpt: 28 }, { hpt: 22 }, { hpt: 8 }, { hpt: 24 }];
    if (aggregate.size) summary["!autofilter"] = { ref: `A4:G${aggregate.size + 4}` };
    (summary as Record<string, unknown>)["!freeze"] = { xSplit: 0, ySplit: 4, topLeftCell: "A5", activePane: "bottomLeft", state: "frozen" };
    XLSX.utils.book_append_sheet(wb, summary, "Сводка");

    const binary = XLSX.write(wb, { type: "buffer", bookType: "xlsx", compression: true });
    const fileName = scope === "rack"
      ? `Остатки_стеллаж_${safe(rackCode)}.xlsx`
      : scope === "cell"
        ? `Остатки_ячейка_${safe(cellCode)}.xlsx`
        : `Остатки_склада_${now.toISOString().slice(0, 10)}.xlsx`;

    return new Response(new Uint8Array(binary), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="stock.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось сформировать Excel" }, { status: 500 });
  }
}
