"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, Download, Search } from "lucide-react";

type IssuedRow = {
  id: string;
  createdAt: string;
  documentNumber: string;
  oneCId: string;
  recipient: string;
  operator: string;
  quantity: number;
  comment: string;
  productName: string;
  productSku: string;
  productBarcode: string;
  productUnit: string;
  cellCode: string;
};

type ResponseBody = { rows?: IssuedRow[] };

type IssuedDocument = {
  key: string;
  documentNumber: string;
  oneCId: string;
  recipient: string;
  operator: string;
  comment: string;
  createdAt: string;
  rows: IssuedRow[];
  totalQuantity: number;
};

function replaceJournalLabel() {
  const tabs = Array.from(document.querySelectorAll<HTMLElement>("[role='tab']"));
  const tab = tabs.find((node) => /Журнал|Выданные/.test(node.textContent || ""));
  if (!tab) return null;
  for (const node of Array.from(tab.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent?.includes("Журнал")) node.textContent = node.textContent.replace("Журнал", "Выданные");
  }
  tab.setAttribute("aria-label", "Выданные материалы");
  return tab;
}

function journalPanel(tab: HTMLElement | null) {
  if (!tab) return null;
  const controlled = tab.getAttribute("aria-controls");
  return controlled ? document.getElementById(controlled) : null;
}

const formatQty = (value: number) => Number(value || 0).toLocaleString("ru-RU", { maximumFractionDigits: 3 });

function parseWarehouseDate(value: string) {
  const raw = String(value || "").trim();
  if (!raw) return new Date(NaN);
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw)) return new Date(raw);
  return new Date(`${raw.replace(" ", "T")}Z`);
}

function formatWarehouseDate(value: string) {
  const date = parseWarehouseDate(value);
  return date.toLocaleDateString("ru-RU", { timeZone: "Asia/Tashkent" });
}

function formatWarehouseTime(value: string) {
  const date = parseWarehouseDate(value);
  return date.toLocaleTimeString("ru-RU", {
    timeZone: "Asia/Tashkent",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function HardwareIssuedMaterials() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [rows, setRows] = useState<IssuedRow[]>([]);
  const [query, setQuery] = useState("");
  const [openedDocument, setOpenedDocument] = useState<string | null>(null);

  useEffect(() => {
    if (window.location.pathname !== "/warehouse") return;
    let stopped = false;

    const load = async () => {
      try {
        const response = await fetch("/api/warehouse/issued", { cache: "no-store" });
        if (!response.ok) return;
        const body = await response.json() as ResponseBody;
        if (!stopped) setRows(Array.isArray(body.rows) ? body.rows : []);
      } catch {
        // Фоновое обновление журнала выдач не блокирует склад.
      }
    };

    const mount = () => {
      const tab = replaceJournalLabel();
      const panel = journalPanel(tab);
      if (!panel) return;
      let target = panel.querySelector<HTMLElement>("[data-issued-materials-host='1']");
      if (!target) {
        Array.from(panel.children).forEach((child) => {
          if (child instanceof HTMLElement) child.style.display = "none";
        });
        target = document.createElement("div");
        target.dataset.issuedMaterialsHost = "1";
        panel.appendChild(target);
      }
      setHost(target);
    };

    mount();
    void load();
    const observer = new MutationObserver(mount);
    observer.observe(document.body, { childList: true, subtree: true });
    const mountTimer = window.setInterval(mount, 1000);
    const dataTimer = window.setInterval(() => void load(), 1500);
    const refresh = () => void load();
    window.addEventListener("hardware:refresh-now", refresh);

    return () => {
      stopped = true;
      observer.disconnect();
      window.clearInterval(mountTimer);
      window.clearInterval(dataTimer);
      window.removeEventListener("hardware:refresh-now", refresh);
    };
  }, []);

  const documents = useMemo<IssuedDocument[]>(() => {
    const grouped = new Map<string, IssuedDocument>();

    for (const row of rows) {
      const key = row.documentNumber || "Без документа";
      const current = grouped.get(key);
      if (current) {
        current.rows.push(row);
        current.totalQuantity += Number(row.quantity || 0);
        if (parseWarehouseDate(row.createdAt).getTime() > parseWarehouseDate(current.createdAt).getTime()) current.createdAt = row.createdAt;
        if (!current.oneCId && row.oneCId) current.oneCId = row.oneCId;
        if (!current.recipient && row.recipient) current.recipient = row.recipient;
        if (!current.operator && row.operator) current.operator = row.operator;
        if (!current.comment && row.comment) current.comment = row.comment;
      } else {
        grouped.set(key, {
          key,
          documentNumber: key,
          oneCId: row.oneCId || "",
          recipient: row.recipient || "",
          operator: row.operator || "",
          comment: row.comment || "",
          createdAt: row.createdAt,
          rows: [row],
          totalQuantity: Number(row.quantity || 0),
        });
      }
    }

    return Array.from(grouped.values())
      .map((document) => ({ ...document, rows: [...document.rows].sort((a, b) => a.productName.localeCompare(b.productName, "ru")) }))
      .sort((a, b) => parseWarehouseDate(b.createdAt).getTime() - parseWarehouseDate(a.createdAt).getTime());
  }, [rows]);

  const filteredDocuments = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("ru-RU");
    if (!q) return documents;

    return documents.filter((document) => {
      const documentText = [document.documentNumber, document.oneCId, document.recipient, document.operator, document.comment]
        .join(" ").toLocaleLowerCase("ru-RU");
      if (documentText.includes(q)) return true;
      return document.rows.some((row) => [row.productName, row.productSku, row.productBarcode, row.cellCode, row.comment]
        .join(" ").toLocaleLowerCase("ru-RU").includes(q));
    });
  }, [documents, query]);

  const filteredRows = useMemo(() => filteredDocuments.flatMap((document) => document.rows), [filteredDocuments]);
  const totalQuantity = filteredRows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);

  const exportExcel = async () => {
    const XLSX = await import("xlsx");
    const title = [["РУССКИЙ ЛЕС · ВЫДАННЫЕ МАТЕРИАЛЫ"], ["Сформировано", new Date().toLocaleString("ru-RU", { timeZone: "Asia/Tashkent" })], []];
    const headers = [["Дата", "Время", "Документ", "ID 1С", "Материал", "Артикул", "Штрихкод", "Кол-во", "Ед.", "Ячейка", "Получатель", "Кладовщик", "Комментарий"]];
    const data = filteredRows.map((row) => [
      formatWarehouseDate(row.createdAt),
      formatWarehouseTime(row.createdAt),
      row.documentNumber,
      row.oneCId,
      row.productName,
      row.productSku,
      row.productBarcode,
      row.quantity,
      row.productUnit,
      row.cellCode,
      row.recipient,
      row.operator,
      row.comment,
    ]);
    const sheet = XLSX.utils.aoa_to_sheet([...title, ...headers, ...data]);
    sheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 12 } }];
    sheet["!cols"] = [
      { wch: 12 }, { wch: 10 }, { wch: 18 }, { wch: 20 }, { wch: 42 }, { wch: 18 },
      { wch: 20 }, { wch: 12 }, { wch: 9 }, { wch: 13 }, { wch: 24 }, { wch: 20 }, { wch: 32 },
    ];
    sheet["!autofilter"] = { ref: `A4:M${Math.max(4, data.length + 4)}` };
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Выданные материалы");
    XLSX.writeFile(book, `Выданные_материалы_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  if (!host) return null;

  return createPortal(
    <div className="space-y-3">
      <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
        <div>
          <p className="eyebrow">Фактическая выдача со склада</p>
          <h1 className="page-title">Выданные материалы</h1>
          <p className="page-description">Один документ — одна строка. Нажмите, чтобы посмотреть состав выдачи.</p>
        </div>
        <button type="button" onClick={() => void exportExcel()} className="inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700"><Download size={16} /> Скачать Excel</button>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-2.5"><div className="text-[11px] font-semibold uppercase tracking-[.12em] text-slate-500">Позиций</div><div className="mt-0.5 text-xl font-extrabold text-slate-900">{filteredRows.length}</div></div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-2.5"><div className="text-[11px] font-semibold uppercase tracking-[.12em] text-slate-500">Документов</div><div className="mt-0.5 text-xl font-extrabold text-slate-900">{filteredDocuments.length}</div></div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-2.5"><div className="text-[11px] font-semibold uppercase tracking-[.12em] text-slate-500">Выдано всего</div><div className="mt-0.5 text-xl font-extrabold text-slate-900">{formatQty(totalQuantity)}</div></div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col justify-between gap-2 border-b border-slate-200 px-4 py-2.5 sm:flex-row sm:items-center">
          <div className="font-extrabold text-slate-900">История выдач</div>
          <label className="relative block w-full sm:w-[390px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Документ, материал, артикул, получатель…" className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
          </label>
        </div>

        <div className="divide-y divide-slate-100">
          {filteredDocuments.map((document) => {
            const opened = openedDocument === document.key;

            return <div key={document.key} className="bg-white">
              <button
                type="button"
                onClick={() => setOpenedDocument(opened ? null : document.key)}
                className="grid w-full grid-cols-[auto_1fr] gap-2 px-3 py-2.5 text-left transition hover:bg-slate-50 sm:grid-cols-[auto_145px_1fr_120px_160px_130px] sm:items-center"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-600">{opened ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
                <div>
                  <div className="font-extrabold text-slate-900">{formatWarehouseDate(document.createdAt)}</div>
                  <div className="text-[11px] text-slate-500">{formatWarehouseTime(document.createdAt)}</div>
                </div>
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Документ</div>
                  <div className="font-extrabold text-slate-900">№ {document.documentNumber}</div>
                  {document.oneCId && <div className="text-[11px] text-slate-500">1С: {document.oneCId}</div>}
                </div>
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Позиций</div>
                  <div className="font-bold text-slate-800">{document.rows.length}</div>
                </div>
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Получатель</div>
                  <div className="truncate font-semibold text-slate-800">{document.recipient || "—"}</div>
                </div>
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Выдано</div>
                  <div className="font-extrabold text-emerald-700">{formatQty(document.totalQuantity)}</div>
                </div>
              </button>

              {opened && <div className="border-t border-slate-100 bg-slate-50/60 px-3 py-2.5 sm:px-4 sm:py-3">
                <div className="mb-2 grid gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 sm:grid-cols-2 lg:grid-cols-4">
                  <div><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Документ</div><div className="font-extrabold text-slate-900">№ {document.documentNumber}</div>{document.oneCId && <div className="text-[11px] text-slate-500">1С: {document.oneCId}</div>}</div>
                  <div><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Получатель</div><div className="font-bold text-slate-800">{document.recipient || "—"}</div></div>
                  <div><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Кладовщик</div><div className="font-bold text-slate-800">{document.operator || "—"}</div></div>
                  <div><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Комментарий</div><div className="text-slate-700">{document.comment || "—"}</div></div>
                </div>

                <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                  <table className="w-full min-w-[760px] border-collapse text-sm">
                    <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
                      <tr><th className="px-3 py-2">Материал</th><th className="px-3 py-2">Артикул</th><th className="px-3 py-2">Ячейка</th><th className="px-3 py-2">Кол-во</th><th className="px-3 py-2">Время выдачи</th></tr>
                    </thead>
                    <tbody>
                      {document.rows.map((row) => <tr key={row.id} className="border-t border-slate-100 align-top">
                        <td className="px-3 py-2"><div className="font-bold text-slate-900">{row.productName}</div>{row.productBarcode && <div className="text-[11px] text-slate-500">Штрихкод: {row.productBarcode}</div>}</td>
                        <td className="px-3 py-2 font-mono font-bold text-slate-700">{row.productSku || "—"}</td>
                        <td className="whitespace-nowrap px-3 py-2 font-mono font-bold text-slate-700">{row.cellCode || "—"}</td>
                        <td className="whitespace-nowrap px-3 py-2 font-extrabold text-emerald-700">{formatQty(row.quantity)} {row.productUnit}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-slate-600">{formatWarehouseTime(row.createdAt)}</td>
                      </tr>)}
                    </tbody>
                  </table>
                </div>
              </div>}
            </div>;
          })}

          {!filteredDocuments.length && <div className="px-4 py-8 text-center text-slate-500">Выданных материалов по выбранному поиску нет.</div>}
        </div>
      </div>
    </div>,
    host,
  );
}
