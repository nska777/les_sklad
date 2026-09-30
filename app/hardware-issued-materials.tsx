"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Download, Search } from "lucide-react";

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

export function HardwareIssuedMaterials() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [rows, setRows] = useState<IssuedRow[]>([]);
  const [query, setQuery] = useState("");

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

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("ru-RU");
    if (!q) return rows;
    return rows.filter((row) => [
      row.documentNumber,
      row.oneCId,
      row.recipient,
      row.operator,
      row.productName,
      row.productSku,
      row.productBarcode,
      row.cellCode,
      row.comment,
    ].join(" ").toLocaleLowerCase("ru-RU").includes(q));
  }, [query, rows]);

  const totalQuantity = filtered.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
  const documents = new Set(filtered.map((row) => row.documentNumber)).size;

  const exportExcel = async () => {
    const XLSX = await import("xlsx");
    const title = [["РУССКИЙ ЛЕС · ВЫДАННЫЕ МАТЕРИАЛЫ"], ["Сформировано", new Date().toLocaleString("ru-RU")], []];
    const headers = [["Дата", "Время", "Документ", "ID 1С", "Материал", "Артикул", "Штрихкод", "Кол-во", "Ед.", "Ячейка", "Получатель", "Кладовщик", "Комментарий"]];
    const data = filtered.map((row) => {
      const date = new Date(row.createdAt);
      return [
        date.toLocaleDateString("ru-RU"),
        date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
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
      ];
    });
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
    <div className="space-y-5">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <p className="eyebrow">Фактическая выдача со склада</p>
          <h1 className="page-title">Выданные материалы</h1>
          <p className="page-description">Каждая подтверждённая выдача фиксируется здесь автоматически: документ, материал, количество, получатель, кладовщик, дата и время.</p>
        </div>
        <button type="button" onClick={() => void exportExcel()} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700"><Download size={17} /> Скачать Excel</button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="text-xs font-semibold uppercase tracking-[.12em] text-slate-500">Записей</div><div className="mt-1 text-2xl font-extrabold text-slate-900">{filtered.length}</div></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="text-xs font-semibold uppercase tracking-[.12em] text-slate-500">Документов</div><div className="mt-1 text-2xl font-extrabold text-slate-900">{documents}</div></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="text-xs font-semibold uppercase tracking-[.12em] text-slate-500">Выдано всего</div><div className="mt-1 text-2xl font-extrabold text-slate-900">{totalQuantity.toLocaleString("ru-RU", { maximumFractionDigits: 3 })}</div></div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col justify-between gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center">
          <div className="font-extrabold text-slate-900">История выдач</div>
          <label className="relative block w-full sm:w-[420px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Документ, материал, артикул, получатель…" className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
          </label>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] border-collapse text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="px-4 py-3">Дата / время</th><th className="px-4 py-3">Документ</th><th className="px-4 py-3">Материал</th><th className="px-4 py-3">Кол-во</th><th className="px-4 py-3">Ячейка</th><th className="px-4 py-3">Получатель</th><th className="px-4 py-3">Кладовщик</th><th className="px-4 py-3">Комментарий</th></tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const date = new Date(row.createdAt);
                return <tr key={row.id} className="border-t border-slate-100 align-top hover:bg-slate-50/70">
                  <td className="whitespace-nowrap px-4 py-3"><div className="font-bold text-slate-800">{date.toLocaleDateString("ru-RU")}</div><div className="text-xs text-slate-500">{date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</div></td>
                  <td className="px-4 py-3"><div className="font-bold text-slate-900">{row.documentNumber}</div>{row.oneCId && <div className="text-xs text-slate-500">1С: {row.oneCId}</div>}</td>
                  <td className="px-4 py-3"><div className="font-bold text-slate-900">{row.productName}</div><div className="text-xs text-slate-500">{row.productSku}{row.productBarcode ? ` · ${row.productBarcode}` : ""}</div></td>
                  <td className="whitespace-nowrap px-4 py-3 font-extrabold text-emerald-700">{Number(row.quantity).toLocaleString("ru-RU", { maximumFractionDigits: 3 })} {row.productUnit}</td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono font-bold text-slate-700">{row.cellCode}</td>
                  <td className="px-4 py-3 font-semibold text-slate-800">{row.recipient || "—"}</td>
                  <td className="px-4 py-3 text-slate-700">{row.operator || "—"}</td>
                  <td className="max-w-[280px] px-4 py-3 text-slate-600">{row.comment || "—"}</td>
                </tr>;
              })}
              {!filtered.length && <tr><td colSpan={8} className="px-4 py-12 text-center text-slate-500">Выданных материалов по выбранному поиску нет.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>,
    host,
  );
}
