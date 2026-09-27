"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import * as XLSX from "xlsx";
import { Download, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";

type AuditRow = {
  id: string;
  source: string;
  action: string;
  category: string;
  entityType: string;
  entityId: string;
  entityName: string;
  details: string;
  quantity: string;
  route: string;
  document: string;
  operator: string;
  createdAt: string;
};

const categories = ["Все", "Приход", "Выдача", "Перемещение", "Материалы", "Инвентаризация", "Стеллажи", "Импорт", "Удаления", "Корректировки", "Отмены", "Прочее"];
const formatDate = (value: string) => new Date(value).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });

export function DepartmentAuditPanel() {
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("Все");
  const [query, setQuery] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/department-audit", { cache: "no-store" });
      const body = await response.json() as { rows?: AuditRow[]; error?: string };
      if (!response.ok) throw new Error(body.error || "Не удалось загрузить журнал действий");
      setRows(Array.isArray(body.rows) ? body.rows : []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось загрузить журнал действий");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let stopped = false;
    let created: HTMLElement | null = null;
    let hidden: HTMLElement | null = null;
    const locate = () => {
      if (stopped) return;
      const headings = Array.from(document.querySelectorAll("h2"));
      const heading = headings.find((node) => node.textContent?.trim() === "Движения" && (node as HTMLElement).offsetParent !== null);
      if (!(heading instanceof HTMLElement)) return;
      const panel = heading.closest("section.panel");
      if (!(panel instanceof HTMLElement) || !(panel.parentElement instanceof HTMLElement)) return;
      if (!created) {
        hidden = panel;
        panel.style.display = "none";
        created = document.createElement("div");
        panel.parentElement.insertBefore(created, panel);
        setMount(created);
        void load();
      }
    };
    locate();
    const timer = window.setInterval(locate, 350);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      created?.remove();
      if (hidden) hidden.style.display = "";
    };
  }, []);

  useEffect(() => {
    const previous = window.fetch.bind(window);
    const auditEndpoints = [
      "/api/department-warehouse",
      "/api/department-warehouse-controls",
      "/api/department-warehouse-maintenance",
      "/api/department-warehouse-inventory",
      "/api/department-onec/place",
      "/api/department-excess",
    ];
    const patched: typeof window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = String(init?.method || "GET").toUpperCase();
      let parsed: Record<string, unknown> | null = null;
      if (method === "POST" && typeof init?.body === "string" && auditEndpoints.some((path) => url.includes(path)) && !url.includes("/api/department-audit")) {
        try { parsed = JSON.parse(init.body) as Record<string, unknown>; } catch { parsed = null; }
      }
      const response = await previous(input, init);
      if (parsed && response.ok) {
        const action = String(parsed.action || "").trim();
        if (action) {
          void previous("/api/department-audit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action, endpoint: url, payload: parsed }),
          }).then(() => {
            if (mount) window.setTimeout(() => void load(), 120);
          }).catch(() => undefined);
        }
      }
      return response;
    };
    window.fetch = patched;
    return () => { window.fetch = previous; };
  }, [mount]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (filter !== "Все" && row.category !== filter) return false;
      if (!q) return true;
      return `${row.action} ${row.entityName} ${row.details} ${row.quantity} ${row.route} ${row.document} ${row.operator}`.toLowerCase().includes(q);
    });
  }, [rows, filter, query]);

  const exportExcel = () => {
    const data = visible.map((row) => ({
      "Дата и время": formatDate(row.createdAt),
      "Действие": row.action,
      "Категория": row.category,
      "Объект": row.entityName,
      "Детали": row.details,
      "Количество": row.quantity,
      "Откуда → Куда": row.route,
      "Документ": row.document,
      "Пользователь": row.operator,
    }));
    const ws = XLSX.utils.json_to_sheet(data.length ? data : [{ "Движения": "Нет данных" }]);
    ws["!cols"] = [{ wch: 18 }, { wch: 24 }, { wch: 18 }, { wch: 34 }, { wch: 46 }, { wch: 18 }, { wch: 24 }, { wch: 20 }, { wch: 22 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Движения");
    XLSX.writeFile(wb, `RL_Sklad_Dvizheniya_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  if (!mount) return null;
  return createPortal(
    <section className="panel overflow-hidden p-0">
      <div className="border-b p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-black">Движения и журнал действий</h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">Полная история склада: приход, размещение, перемещение, выдача, создание, редактирование, удаление, инвентаризации, стеллажи и импорт. Журнал аудита не очищается вместе с рабочими таблицами.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void load()} className="inline-flex h-10 items-center gap-2 rounded-xl border bg-white px-4 text-sm font-bold hover:bg-slate-50"><RefreshCw size={15} className={loading ? "animate-spin" : ""}/> Обновить</button>
            <button type="button" onClick={exportExcel} className="inline-flex h-10 items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 text-sm font-bold text-emerald-800 hover:bg-emerald-100"><Download size={15}/> Excel</button>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {categories.map((item) => <button key={item} type="button" onClick={() => setFilter(item)} className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${filter === item ? "border-blue-500 bg-blue-50 text-blue-700" : "bg-white text-slate-600 hover:bg-slate-50"}`}>{item}</button>)}
        </div>

        <div className="relative mt-4 max-w-xl"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск: материал, действие, документ, пользователь..." className="h-11 w-full rounded-xl border bg-white pl-10 pr-3 outline-none focus:border-blue-500"/></div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-[1180px] w-full text-sm">
          <thead className="bg-slate-50/80 text-left text-xs uppercase tracking-wide text-slate-500"><tr>
            <th className="px-4 py-3">Дата</th><th className="px-4 py-3">Действие</th><th className="px-4 py-3">Объект</th><th className="px-4 py-3">Изменение / детали</th><th className="px-4 py-3">Количество</th><th className="px-4 py-3">Откуда → куда</th><th className="px-4 py-3">Документ</th><th className="px-4 py-3">Пользователь</th>
          </tr></thead>
          <tbody>
            {visible.map((row) => <tr key={row.id} className="border-t align-top hover:bg-slate-50/60">
              <td className="whitespace-nowrap px-4 py-3 text-slate-500">{formatDate(row.createdAt)}</td>
              <td className="px-4 py-3"><div className="font-black">{row.action}</div><div className="mt-1 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">{row.category}</div></td>
              <td className="px-4 py-3"><div className="font-bold">{row.entityName || "—"}</div>{row.entityId && row.entityId.length < 50 ? <div className="mt-1 font-mono text-[11px] text-slate-400">{row.entityId}</div> : null}</td>
              <td className="max-w-[360px] px-4 py-3 text-slate-600">{row.details || "—"}</td>
              <td className="whitespace-nowrap px-4 py-3 font-bold">{row.quantity || "—"}</td>
              <td className="whitespace-nowrap px-4 py-3">{row.route || "—"}</td>
              <td className="px-4 py-3">{row.document || "—"}</td>
              <td className="px-4 py-3 font-bold">{row.operator || "—"}</td>
            </tr>)}
            {!visible.length && <tr><td colSpan={8} className="px-4 py-14 text-center text-slate-400">{loading ? "Загрузка журнала..." : "Записей пока нет"}</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="border-t px-5 py-3 text-xs text-slate-500">Показано: {visible.length} · Всего в журнале: {rows.length}</div>
    </section>,
    mount,
  );
}
