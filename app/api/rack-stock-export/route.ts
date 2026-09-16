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

const n = (value: unknown) => Number(value || 0);
const safe = (value: string) => value.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, "_").slice(0, 80);

type Row = {
  rackCode: string;
  rackName: string;
  cellCode: string;
  side: "front" | "back";
  rowIndex: number;
  columnIndex: number;
  productId: string | null;
  productName: string | null;
  sku: string | null;
  barcode: string | null;
  unit: string | null;
  quantity: number | null;
  available1c: number | null;
};

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const rackCode = (url.searchParams.get("rackCode") || "").trim();
    if (!rackCode) return Response.json({ error: "Не указан стеллаж" }, { status: 400 });

    const db = await getDb();
    const result = await db.execute(sql`
      SELECT
        r.code AS "rackCode",
        r.name AS "rackName",
        c.code AS "cellCode",
        c.side,
        c.row_index AS "rowIndex",
        c.column_index AS "columnIndex",
        p.id AS "productId",
        p.name AS "productName",
        p.sku,
        p.barcode,
        p.unit,
        s.quantity::double precision AS quantity,
        COALESCE(om.available_1c, 0)::double precision AS "available1c"
      FROM racks r
      JOIN cells c ON c.rack_id = r.id
      LEFT JOIN stocks s ON s.cell_id = c.id AND s.quantity > 0
      LEFT JOIN products p ON p.id = s.product_id
      LEFT JOIN onec_materials om ON om.linked_product_id = p.id
      WHERE r.archived = false
        AND r.code = ${rackCode}
        AND COALESCE(c.layout_archived, false) = false
      ORDER BY c.side, c.row_index, c.column_index, p.name NULLS LAST
    `);

    const rows = rowsOf<Row>(result);
    if (!rows.length) return Response.json({ error: `Стеллаж ${rackCode} не найден` }, { status: 404 });

    const now = new Date();
    const generated = new Intl.DateTimeFormat("ru-RU", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Tashkent",
    }).format(now);

    const totals = new Map<string, number>();
    for (const row of rows) {
      if (!row.productId) continue;
      totals.set(row.productId, (totals.get(row.productId) || 0) + n(row.quantity));
    }

    const detail: (string | number)[][] = [
      ["РУССКИЙ ЛЕС · ОСТАТКИ СТЕЛЛАЖА"],
      [`${rows[0].rackCode} · ${rows[0].rackName}`],
      [`Сформировано: ${generated}`],
      [],
      ["Сторона", "Полка", "Ячейка", "Статус", "Материал", "RL-код", "Штрихкод", "Остаток в ячейке", "Ед.", "Всего в стеллаже", "Остаток 1С", "Излишек"],
      ...rows.map((row) => {
        const total = row.productId ? (totals.get(row.productId) || 0) : 0;
        return [
          row.side === "front" ? "Лицевая" : "Задняя",
          row.rowIndex + 1,
          row.cellCode,
          row.productId ? "Занята" : "Свободна",
          row.productName || "",
          row.sku || "",
          row.barcode || row.sku || "",
          row.productId ? n(row.quantity) : 0,
          row.unit || "",
          total,
          row.productId ? n(row.available1c) : 0,
          row.productId ? Math.max(0, total - n(row.available1c)) : 0,
        ];
      }),
    ];

    const wb = XLSX.utils.book_new();
    wb.Props = {
      Title: `Остатки стеллажа ${rackCode}`,
      Subject: "Полная структура стеллажа и фактические остатки",
      Author: "Русский Лес — Склад",
      CreatedDate: now,
    };

    const ws = XLSX.utils.aoa_to_sheet(detail);
    ws["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 11 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 11 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: 11 } },
    ];
    ws["!cols"] = [
      { wch: 12 }, { wch: 8 }, { wch: 14 }, { wch: 11 }, { wch: 42 }, { wch: 14 },
      { wch: 18 }, { wch: 16 }, { wch: 8 }, { wch: 17 }, { wch: 13 }, { wch: 12 },
    ];
    ws["!rows"] = [{ hpt: 28 }, { hpt: 22 }, { hpt: 18 }, { hpt: 8 }, { hpt: 24 }];
    ws["!autofilter"] = { ref: `A5:L${detail.length}` };
    (ws as Record<string, unknown>)["!freeze"] = { xSplit: 0, ySplit: 5, topLeftCell: "A6", activePane: "bottomLeft", state: "frozen" };
    XLSX.utils.book_append_sheet(wb, ws, "Стеллаж");

    const summaryMap = new Map<string, { name: string; sku: string; unit: string; total: number; onec: number; cells: string[] }>();
    for (const row of rows) {
      if (!row.productId) continue;
      const current = summaryMap.get(row.productId) || {
        name: row.productName || "",
        sku: row.sku || "",
        unit: row.unit || "шт.",
        total: 0,
        onec: n(row.available1c),
        cells: [],
      };
      current.total += n(row.quantity);
      current.cells.push(`${row.cellCode} — ${n(row.quantity)} ${row.unit || "шт."}`);
      summaryMap.set(row.productId, current);
    }

    const summaryData: (string | number)[][] = [
      ["СВОДКА ПО СТЕЛЛАЖУ"],
      [`${rows[0].rackCode} · ${rows[0].rackName}`],
      [],
      ["Материал", "RL-код", "Факт в стеллаже", "Ед.", "Остаток 1С", "Излишек", "Ячейки"],
      ...Array.from(summaryMap.values())
        .sort((a, b) => a.name.localeCompare(b.name, "ru"))
        .map((item) => [item.name, item.sku, item.total, item.unit, item.onec, Math.max(0, item.total - item.onec), item.cells.join("; ")]),
    ];
    if (!summaryMap.size) summaryData.push(["Стеллаж пуст"]);

    const summary = XLSX.utils.aoa_to_sheet(summaryData);
    summary["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 6 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 6 } },
    ];
    summary["!cols"] = [{ wch: 42 }, { wch: 14 }, { wch: 17 }, { wch: 8 }, { wch: 13 }, { wch: 12 }, { wch: 70 }];
    if (summaryMap.size) summary["!autofilter"] = { ref: `A4:G${summaryData.length}` };
    XLSX.utils.book_append_sheet(wb, summary, "Сводка");

    const binary = XLSX.write(wb, { type: "buffer", bookType: "xlsx", compression: true });
    const fileName = `Остатки_стеллаж_${safe(rackCode)}_${now.toISOString().slice(0, 10)}.xlsx`;

    return new Response(new Uint8Array(binary), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="rack-stock.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось сформировать Excel стеллажа" }, { status: 500 });
  }
}
