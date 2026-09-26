"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import * as XLSX from "xlsx";
import { FileSpreadsheet, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import WarehouseFullUiEnhanced from "./warehouse-full-ui-enhanced";

type ImportItem = {
  name: string;
  sku?: string;
  oneCId?: string;
  barcode?: string;
  category?: string;
  unit?: string;
  quantity?: number;
};

const normalize = (value: unknown) => String(value ?? "").trim().toLowerCase().replace(/ё/g, "е");
const toNumber = (value: unknown) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const n = Number(String(value ?? "").trim().replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

function findColumn(headers: unknown[], variants: string[]) {
  const wanted = variants.map(normalize);
  return headers.findIndex((h) => wanted.includes(normalize(h)));
}

function parseSheet(file: File): Promise<{ items: ImportItem[]; quantityLabel: string }> {
  return file.arrayBuffer().then((buffer) => {
    const wb = XLSX.read(buffer, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false });
    if (!matrix.length) throw new Error("Файл пустой");

    let headerIndex = matrix.findIndex((row) => row.some((v) => ["наименование", "товар", "материал", "name"].includes(normalize(v))));
    if (headerIndex < 0) headerIndex = 0;
    const headers = matrix[headerIndex] || [];
    const rows = matrix.slice(headerIndex + 1);

    let nameCol = findColumn(headers, ["наименование", "товар", "материал", "name"]);
    if (nameCol < 0) nameCol = rows.some((r) => String(r[1] ?? "").trim()) ? 1 : 0;

    let quantityCol = findColumn(headers, ["остаток", "количество", "кол-во", "кол во", "в наличии", "остаток на складе", "quantity", "qty"]);
    if (quantityCol < 0) {
      const candidates: Array<{ index: number; count: number }> = [];
      const width = Math.max(...matrix.map((r) => r.length), 0);
      for (let c = 0; c < width; c += 1) {
        if (c === nameCol) continue;
        let count = 0;
        for (const row of rows.slice(0, 50)) {
          const raw = row[c];
          if (raw === "" || raw === null || raw === undefined) continue;
          const text = String(raw).trim().replace(/\s/g, "").replace(",", ".");
          if (text && Number.isFinite(Number(text))) count += 1;
        }
        if (count >= Math.min(3, Math.max(1, rows.length))) candidates.push({ index: c, count });
      }
      candidates.sort((a, b) => Math.abs(a.index - nameCol) - Math.abs(b.index - nameCol) || b.count - a.count);
      quantityCol = candidates[0]?.index ?? -1;
    }

    const skuCol = findColumn(headers, ["артикул", "код", "sku"]);
    const oneCIdCol = findColumn(headers, ["id 1с", "id1с", "1c id", "onec id"]);
    const barcodeCol = findColumn(headers, ["штрихкод", "barcode"]);
    const categoryCol = findColumn(headers, ["категория", "category"]);
    const unitCol = findColumn(headers, ["единица", "ед. изм.", "ед изм", "unit"]);

    const items = rows.map((row) => {
      const name = String(row[nameCol] ?? "").trim();
      if (!name) return null;
      const item: ImportItem = { name };
      if (skuCol >= 0) item.sku = String(row[skuCol] ?? "").trim();
      if (oneCIdCol >= 0) item.oneCId = String(row[oneCIdCol] ?? "").trim();
      if (barcodeCol >= 0) item.barcode = String(row[barcodeCol] ?? "").trim();
      if (categoryCol >= 0) item.category = String(row[categoryCol] ?? "").trim();
      if (unitCol >= 0) item.unit = String(row[unitCol] ?? "").trim();
      if (quantityCol >= 0 && String(row[quantityCol] ?? "").trim() !== "") item.quantity = toNumber(row[quantityCol]);
      return item;
    }).filter(Boolean) as ImportItem[];

    if (!items.length) throw new Error("Не найдены строки номенклатуры");
    return { items, quantityLabel: quantityCol >= 0 ? String(headers[quantityCol] || `Колонка ${quantityCol + 1}`) : "Не найдена" };
  });
}

export default function WarehouseFullUiV3() {
  const [headerMount, setHeaderMount] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState("");
  const [items, setItems] = useState<ImportItem[]>([]);
  const [quantityLabel, setQuantityLabel] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    const patched: typeof window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/api/department-warehouse") && String(init?.method || "GET").toUpperCase() === "POST" && typeof init?.body === "string") {
        try {
          const body = JSON.parse(init.body) as { action?: string; id?: string; ids?: string[] };
          if (body.action === "deleteProduct" || body.action === "bulkDeleteProducts") {
            return originalFetch("/api/department-warehouse-maintenance", {
              ...init,
              body: JSON.stringify({ action: "hardDeleteProducts", id: body.id, ids: body.ids }),
            });
          }
        } catch { /* normal fetch */ }
      }
      return originalFetch(input, init);
    };
    window.fetch = patched;
    return () => { window.fetch = originalFetch; };
  }, []);

  useEffect(() => {
    let stopped = false;
    let mount: HTMLElement | null = null;
    const locate = () => {
      if (stopped || mount) return;
      const buttons = Array.from(document.querySelectorAll("button"));
      const old = buttons.find((b) => b.textContent?.includes("Материалы из 1С"));
      if (!(old instanceof HTMLElement) || !(old.parentElement instanceof HTMLElement)) return;
      old.style.display = "none";
      mount = document.createElement("span");
      old.parentElement.insertBefore(mount, old);
      setHeaderMount(mount);
    };
    locate();
    const timer = window.setInterval(locate, 400);
    return () => { stopped = true; window.clearInterval(timer); mount?.remove(); };
  }, []);

  const totalQuantity = useMemo(() => items.reduce((sum, x) => sum + Number(x.quantity || 0), 0), [items]);

  const onFile = async (file?: File) => {
    if (!file) return;
    try {
      const parsed = await parseSheet(file);
      setFileName(file.name);
      setItems(parsed.items);
      setQuantityLabel(parsed.quantityLabel);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось прочитать Excel");
    }
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!items.length) return;
    setSaving(true);
    try {
      const response = await fetch("/api/department-warehouse-maintenance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "import1c", items }),
      });
      const body = await response.json() as { error?: string; created?: number; updated?: number; quantities?: number };
      if (!response.ok) throw new Error(body.error || "Импорт не выполнен");
      toast.success(`Импортировано: ${body.created || 0} новых, ${body.updated || 0} обновлено`, { description: `Остатки 1С загружены для ${body.quantities || 0} позиций` });
      setOpen(false);
      setTimeout(() => window.location.reload(), 250);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Импорт не выполнен"); }
    finally { setSaving(false); }
  };

  const importButton = <button type="button" onClick={() => setOpen(true)} className="inline-flex h-9 items-center gap-2 rounded-lg border bg-white/80 px-3 text-sm font-semibold text-slate-700 shadow-sm hover:bg-white"><FileSpreadsheet size={15}/> Материалы из 1С</button>;

  return <>
    <WarehouseFullUiEnhanced />
    {headerMount ? createPortal(importButton, headerMount) : null}

    {open && <div className="fixed inset-0 z-[40000] flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <form onSubmit={submit} className="max-h-[92vh] w-full max-w-[760px] overflow-auto rounded-[28px] border bg-white p-5 shadow-2xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div><div className="text-xs font-black uppercase tracking-[.14em] text-blue-600">1С / Excel</div><h2 className="mt-1 text-2xl font-black">Загрузить номенклатуру и остатки</h2><p className="mt-1 text-sm text-slate-500">Если в файле нет заголовка «Остаток», система найдёт ближайшую числовую колонку справа от «Наименование».</p></div>
          <button type="button" onClick={() => setOpen(false)} className="rounded-xl p-2 hover:bg-slate-100"><X/></button>
        </div>

        <label className="mt-5 flex cursor-pointer items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center hover:bg-slate-50">
          <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])}/>
          <span><FileSpreadsheet className="mx-auto mb-2"/><b>{fileName || "Выберите Excel / CSV"}</b><small className="mt-1 block text-slate-500">Номенклатура + количество/остаток</small></span>
        </label>

        {items.length > 0 && <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl bg-slate-50 p-4"><div className="text-xs text-slate-500">Позиций</div><div className="mt-1 text-2xl font-black">{items.length}</div></div>
          <div className="rounded-2xl bg-slate-50 p-4"><div className="text-xs text-slate-500">Колонка остатка</div><div className="mt-1 font-black">{quantityLabel || "—"}</div></div>
          <div className="rounded-2xl bg-slate-50 p-4"><div className="text-xs text-slate-500">Сумма из файла</div><div className="mt-1 text-2xl font-black">{totalQuantity.toLocaleString("ru-RU", { maximumFractionDigits: 3 })}</div></div>
        </div>}

        {items.length > 0 && <div className="mt-4 max-h-64 overflow-auto rounded-2xl border"><table className="w-full text-sm"><thead className="sticky top-0 bg-slate-50"><tr><th className="p-2 text-left">Наименование</th><th className="p-2 text-right">Остаток 1С</th><th className="p-2 text-left">Ед.</th></tr></thead><tbody>{items.slice(0, 200).map((item, i) => <tr key={`${item.name}-${i}`} className="border-t"><td className="p-2">{item.name}</td><td className="p-2 text-right font-bold">{Number(item.quantity || 0).toLocaleString("ru-RU", { maximumFractionDigits: 3 })}</td><td className="p-2">{item.unit || "по карточке"}</td></tr>)}</tbody></table></div>}

        <div className="mt-5 flex items-center justify-between gap-3">
          <button type="button" onClick={async () => {
            if (!confirm("Очистить ВСЕ движения, смеси и снимки инвентаризации склада краски?")) return;
            const r = await fetch("/api/department-warehouse-maintenance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "clearMovements" }) });
            const b = await r.json() as { error?: string }; if (!r.ok) return toast.error(b.error || "Не удалось очистить"); toast.success("История движений очищена");
          }} className="inline-flex items-center gap-2 rounded-xl border border-red-200 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50"><Trash2 size={15}/> Очистить движения</button>
          <button disabled={saving || !items.length} className="h-11 rounded-xl bg-orange-500 px-5 font-black text-white disabled:opacity-50">{saving ? "Загрузка..." : "Загрузить в склад"}</button>
        </div>
      </form>
    </div>}
  </>;
}
