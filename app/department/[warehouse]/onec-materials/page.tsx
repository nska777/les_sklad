"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import * as XLSX from "xlsx";
import { ArrowLeft, FileSpreadsheet, Layers3, Loader2, MapPin, PackagePlus, Search, Upload, X } from "lucide-react";
import { toast } from "sonner";

type Rack = { id: string; code: string; name: string; storageType: string };
type Cell = { id: string; rackId: string; code: string; label: string; blocked: boolean };
type Product = { id: string; name: string; sku: string; barcode: string; oneCId?: string | null; category: string; unit: string; quantity1c: number };
type Stock = { productId: string; cellId: string; quantity: number };
type ApiData = { products: Product[]; racks: Rack[]; cells: Cell[]; stocks: Stock[]; error?: string };
type ImportItem = { name: string; sku?: string; oneCId?: string; barcode?: string; category?: string; unit?: string; quantity?: number; sourceRow?: number };

const fmt = (v: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(v);
const norm = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/ё/g, "е");
const numberValue = (v: unknown) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(String(v ?? "").trim().replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
const barcodeValue = (v: unknown) => String(v ?? "").trim().replace(/\s+/g, "").replace(/\.0$/, "");
const findCol = (headers: unknown[], names: string[]) => headers.findIndex((h) => names.map(norm).includes(norm(h)));

async function parseExcel(file: File) {
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false });
  if (!matrix.length) throw new Error("Файл пустой");
  let headerRow = matrix.findIndex((row) => row.some((v) => ["наименование", "товар", "материал", "name"].includes(norm(v))));
  if (headerRow < 0) headerRow = 0;
  const headers = matrix[headerRow] || [];
  const rows = matrix.slice(headerRow + 1);
  let nameCol = findCol(headers, ["наименование", "товар", "материал", "name"]);
  if (nameCol < 0) nameCol = rows.some((r) => String(r[1] ?? "").trim()) ? 1 : 0;
  let qtyCol = findCol(headers, ["остаток", "количество", "кол-во", "кол во", "в наличии", "остаток на складе", "quantity", "qty"]);
  if (qtyCol < 0) {
    const candidates: Array<{ c: number; n: number }> = [];
    const width = Math.max(...matrix.map((r) => r.length), 0);
    for (let c = 0; c < width; c += 1) {
      if (c === nameCol) continue;
      let n = 0;
      for (const row of rows.slice(0, 50)) {
        const value = String(row[c] ?? "").trim().replace(/\s/g, "").replace(",", ".");
        if (value && Number.isFinite(Number(value))) n += 1;
      }
      if (n >= Math.min(3, Math.max(1, rows.length))) candidates.push({ c, n });
    }
    candidates.sort((a, b) => Math.abs(a.c - nameCol) - Math.abs(b.c - nameCol) || b.n - a.n);
    qtyCol = candidates[0]?.c ?? -1;
  }
  const skuCol = findCol(headers, ["артикул", "код", "sku", "код номенклатуры"]);
  const oneCCol = findCol(headers, ["id 1с", "id1с", "1c id", "onec id", "ид 1с", "идентификатор 1с"]);
  let barcodeCol = findCol(headers, ["штрихкод", "штрих-код", "штрих код", "barcode", "ean", "ean13", "ean-13", "gtin"]);
  if (barcodeCol < 0) barcodeCol = headers.findIndex((h) => { const t = norm(h); return t.includes("штрих") || t.includes("barcode") || t.includes("ean") || t.includes("gtin"); });
  const unitCol = findCol(headers, ["единица", "ед. изм.", "ед изм", "единица измерения", "unit"]);
  const categoryCol = findCol(headers, ["категория", "category"]);
  const items = rows.map((row, index) => {
    const name = String(row[nameCol] ?? "").trim();
    if (!name) return null;
    return {
      name,
      sku: skuCol >= 0 ? String(row[skuCol] ?? "").trim() : "",
      oneCId: oneCCol >= 0 ? String(row[oneCCol] ?? "").trim() : "",
      barcode: barcodeCol >= 0 ? barcodeValue(row[barcodeCol]) : "",
      category: categoryCol >= 0 ? String(row[categoryCol] ?? "").trim() : "",
      unit: unitCol >= 0 ? String(row[unitCol] ?? "").trim() : "",
      quantity: qtyCol >= 0 ? numberValue(row[qtyCol]) : 0,
      sourceRow: headerRow + index + 2,
    } satisfies ImportItem;
  }).filter(Boolean) as ImportItem[];
  return { items, qtyLabel: qtyCol >= 0 ? String(headers[qtyCol] || `Колонка ${qtyCol + 1}`) : "Не найдена", barcodeLabel: barcodeCol >= 0 ? String(headers[barcodeCol] || `Колонка ${barcodeCol + 1}`) : "Нет" };
}

export default function DepartmentOneCMaterialsPage() {
  const params = useParams<{ warehouse: string }>();
  const warehouse = String(params?.warehouse || "paint");
  const base = `/department/${warehouse}`;
  const [data, setData] = useState<ApiData>({ products: [], racks: [], cells: [], stocks: [] });
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [importOpen, setImportOpen] = useState(false);
  const [importItems, setImportItems] = useState<ImportItem[]>([]);
  const [fileName, setFileName] = useState("");
  const [qtyLabel, setQtyLabel] = useState("");
  const [barcodeLabel, setBarcodeLabel] = useState("");
  const [placing, setPlacing] = useState<Product | null>(null);
  const [rackId, setRackId] = useState("");
  const [cellId, setCellId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/department-onec", { cache: "no-store" });
      const body = await r.json() as ApiData;
      if (!r.ok) throw new Error(body.error || "Не удалось загрузить материалы 1С");
      setData(body);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Ошибка загрузки"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const rackMap = useMemo(() => new Map(data.racks.map((r) => [r.id, r])), [data.racks]);
  const cellMap = useMemo(() => new Map(data.cells.map((c) => [c.id, c])), [data.cells]);
  const factByProduct = useMemo(() => {
    const map = new Map<string, number>();
    data.stocks.forEach((s) => map.set(s.productId, (map.get(s.productId) || 0) + Number(s.quantity)));
    return map;
  }, [data.stocks]);
  const locationsByProduct = useMemo(() => {
    const map = new Map<string, string[]>();
    data.stocks.filter((s) => Number(s.quantity) > 0).forEach((s) => {
      const cell = cellMap.get(s.cellId); const rack = cell ? rackMap.get(cell.rackId) : undefined;
      if (!cell || !rack) return;
      const label = `${cell.code}: ${fmt(Number(s.quantity))}`;
      map.set(s.productId, [...(map.get(s.productId) || []), label]);
    });
    return map;
  }, [data.stocks, cellMap, rackMap]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return !q ? data.products : data.products.filter((p) => `${p.name} ${p.sku} ${p.barcode} ${p.oneCId || ""} ${p.category}`.toLowerCase().includes(q));
  }, [data.products, query]);
  const perPage = 50;
  const pages = Math.max(1, Math.ceil(filtered.length / perPage));
  const shown = filtered.slice((page - 1) * perPage, page * perPage);
  useEffect(() => { setPage(1); }, [query]);

  const openPlace = (p: Product) => {
    setPlacing(p); setRackId(data.racks[0]?.id || ""); setCellId("");
    const remaining = Math.max(0, Number(p.quantity1c || 0) - Number(factByProduct.get(p.id) || 0));
    setQuantity(String(remaining > 0 ? remaining : 1));
  };
  const rackCells = data.cells.filter((c) => c.rackId === rackId && !c.blocked);

  const place = async () => {
    if (!placing || !cellId || Number(quantity) <= 0) return toast.error("Выберите ячейку и количество");
    setSaving(true);
    try {
      const r = await fetch("/api/department-onec", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "place", productId: placing.id, cellId, quantity }) });
      const body = await r.json() as { error?: string };
      if (!r.ok) throw new Error(body.error || "Не удалось разместить материал");
      toast.success("Материал размещён"); setPlacing(null); await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Ошибка размещения"); }
    finally { setSaving(false); }
  };

  const doImport = async () => {
    if (!importItems.length) return;
    setSaving(true);
    try {
      const r = await fetch("/api/department-onec", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "import", items: importItems }) });
      const body = await r.json() as { error?: string; created?: number; updated?: number; references?: number };
      if (!r.ok) throw new Error(body.error || "Импорт не выполнен");
      toast.success(`1С загружена: ${body.created || 0} новых, ${body.updated || 0} обновлено`, { description: `Остатки сохранены как справочник 1С: ${body.references || 0} позиций` });
      setImportOpen(false); setImportItems([]); await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Ошибка импорта"); }
    finally { setSaving(false); }
  };

  const total1c = data.products.reduce((s, p) => s + Number(p.quantity1c || 0), 0);
  const totalFact = Array.from(factByProduct.values()).reduce((s, v) => s + v, 0);
  const placedCount = data.products.filter((p) => (factByProduct.get(p.id) || 0) > 0).length;

  return <main className="min-h-screen px-4 py-5 text-[var(--foreground)] sm:px-7">
    <div className="mx-auto max-w-[1650px] space-y-4">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div><Link href={base} data-same-tab="true" className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-blue-700 hover:underline"><ArrowLeft size={16}/> Назад в склад</Link><p className="eyebrow">Справочник 1С → физический склад краски</p><h1 className="page-title">Материалы из 1С</h1><p className="page-description">1С хранит ориентир по количеству. Фактический склад показывает только реально размещённый товар.</p></div>
        <div className="flex flex-wrap gap-2"><Link href={`${base}/rack-layout`} data-same-tab="true" className="inline-flex h-10 items-center gap-2 rounded-xl border bg-white px-4 font-semibold"><Layers3 size={16}/> 3D-склад</Link><button onClick={() => setImportOpen(true)} className="inline-flex h-10 items-center gap-2 rounded-xl bg-orange-500 px-4 font-bold text-white"><Upload size={16}/> Загрузить Excel</button></div>
      </div>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="panel p-5"><div className="text-sm text-slate-500">В справочнике</div><div className="mt-1 text-3xl font-black">{data.products.length}</div><div className="mt-1 text-xs text-slate-400">По 1С: {fmt(total1c)}</div></div>
        <div className="panel p-5"><div className="text-sm text-slate-500">Уже размещено</div><div className="mt-1 text-3xl font-black">{placedCount}</div><div className="mt-1 text-xs text-slate-400">Факт: {fmt(totalFact)}</div></div>
        <div className="panel p-5"><div className="text-sm text-slate-500">Не размещено</div><div className="mt-1 text-3xl font-black">{data.products.filter((p) => (factByProduct.get(p.id) || 0) <= 0).length}</div></div>
      </section>

      <section className="panel overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4"><div className="relative w-full max-w-2xl"><Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск: наименование, артикул, штрихкод, ID 1С..." className="h-12 w-full rounded-xl border pl-10 pr-3 outline-none focus:border-blue-500"/></div><div className="text-sm text-slate-400">Найдено: {filtered.length}</div></div>
        {loading ? <div className="flex h-60 items-center justify-center"><Loader2 className="animate-spin"/></div> : <div className="divide-y">{shown.map((p) => {
          const fact = Number(factByProduct.get(p.id) || 0), remaining = Math.max(0, Number(p.quantity1c || 0) - fact), locations = locationsByProduct.get(p.id) || [];
          return <div key={p.id} className="grid gap-3 p-4 lg:grid-cols-[minmax(260px,1.6fr)_120px_140px_minmax(220px,1fr)_210px_150px] lg:items-center">
            <div><div className="font-black">{p.name}</div><div className="mt-1 text-xs text-slate-400">{p.sku}{p.oneCId ? ` · 1С ${p.oneCId}` : ""}</div></div>
            <div><div className="text-xs text-slate-400">По 1С</div><div className="font-black">{fmt(Number(p.quantity1c || 0))} {p.unit}</div></div>
            <div><div className="text-xs text-slate-400">Факт</div><div className="font-black">{fmt(fact)} {p.unit}</div><div className="text-xs text-blue-600">Осталось: {fmt(remaining)}</div></div>
            <div><div className="text-xs text-slate-400">Где лежит</div><div className="mt-1 text-sm">{locations.length ? locations.join(" · ") : "Не размещён"}</div></div>
            <div><div className="text-xs text-slate-400">Штрихкод</div><div className="mt-1 break-all font-mono text-xs">{p.barcode || "—"}</div></div>
            <button onClick={() => openPlace(p)} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 font-bold text-white"><PackagePlus size={16}/> Разместить</button>
          </div>;
        })}{!shown.length && <div className="p-12 text-center text-slate-400">Материалы не найдены</div>}</div>}
        <div className="flex items-center justify-between border-t p-4"><button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="rounded-lg border px-3 py-2 disabled:opacity-40">← Назад</button><div className="text-sm">Страница {page} из {pages}</div><button disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))} className="rounded-lg border px-3 py-2 disabled:opacity-40">Далее →</button></div>
      </section>
    </div>

    {placing && <div className="fixed inset-0 z-[50000] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) setPlacing(null); }}><div className="w-full max-w-xl rounded-3xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between"><div><div className="text-xs font-black uppercase text-orange-600">Размещение</div><h2 className="mt-1 text-xl font-black">{placing.name}</h2><p className="mt-1 text-sm text-slate-500">{placing.barcode}</p></div><button onClick={() => setPlacing(null)} className="rounded-xl p-2 hover:bg-slate-100"><X/></button></div><div className="mt-5 space-y-4"><div><label className="mb-1 block text-sm font-bold">Стеллаж / напольная зона</label><select value={rackId} onChange={(e) => { setRackId(e.target.value); setCellId(""); }} className="h-11 w-full rounded-xl border bg-white px-3"><option value="">Выберите...</option>{data.racks.map((r) => <option key={r.id} value={r.id}>{r.storageType === "floor" ? "Напольная зона" : "Стеллаж"} {r.code} · {r.name}</option>)}</select></div><div><label className="mb-1 block text-sm font-bold">Ячейка</label><select value={cellId} onChange={(e) => setCellId(e.target.value)} className="h-11 w-full rounded-xl border bg-white px-3"><option value="">Выберите...</option>{rackCells.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}</select></div><div><label className="mb-1 block text-sm font-bold">Количество ({placing.unit})</label><input value={quantity} onChange={(e) => setQuantity(e.target.value)} type="number" min="0.001" step="0.001" className="h-11 w-full rounded-xl border px-3"/></div><button disabled={saving || !cellId} onClick={() => void place()} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-orange-500 font-black text-white disabled:opacity-50"><MapPin size={17}/>{saving ? "Размещение..." : "Разместить в ячейку"}</button></div></div></div>}

    {importOpen && <div className="fixed inset-0 z-[50000] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) setImportOpen(false); }}><div className="max-h-[92vh] w-full max-w-3xl overflow-auto rounded-3xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between"><div><div className="text-xs font-black uppercase text-blue-600">1С / Excel</div><h2 className="mt-1 text-2xl font-black">Загрузить справочник 1С</h2><p className="mt-1 text-sm text-slate-500">Количество сохраняется как ориентир 1С. Штрихкод берём из 1С, а если его нет — создаём свой.</p></div><button onClick={() => setImportOpen(false)} className="rounded-xl p-2 hover:bg-slate-100"><X/></button></div><label className="mt-5 flex cursor-pointer items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center"><input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { const parsed = await parseExcel(f); setFileName(f.name); setImportItems(parsed.items); setQtyLabel(parsed.qtyLabel); setBarcodeLabel(parsed.barcodeLabel); } catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось прочитать файл"); } }}/><span><FileSpreadsheet className="mx-auto mb-2"/><b>{fileName || "Выберите Excel / CSV"}</b><small className="mt-1 block text-slate-500">Количество: {qtyLabel || "—"} · Штрихкод: {barcodeLabel || "—"}</small></span></label>{importItems.length > 0 && <div className="mt-4 max-h-72 overflow-auto rounded-2xl border"><table className="w-full text-sm"><thead className="sticky top-0 bg-slate-50"><tr><th className="p-2 text-left">Наименование</th><th className="p-2 text-left">Штрихкод</th><th className="p-2 text-right">По 1С</th></tr></thead><tbody>{importItems.slice(0, 250).map((x, i) => <tr key={`${x.name}-${i}`} className="border-t"><td className="p-2">{x.name}</td><td className="p-2 font-mono text-xs">{x.barcode || "создастся RL"}</td><td className="p-2 text-right font-bold">{fmt(Number(x.quantity || 0))} {x.unit || ""}</td></tr>)}</tbody></table></div>}<button disabled={saving || !importItems.length} onClick={() => void doImport()} className="mt-5 h-12 w-full rounded-xl bg-orange-500 font-black text-white disabled:opacity-50">{saving ? "Загрузка..." : `Загрузить ${importItems.length || ""} позиций`}</button></div></div>}
  </main>;
}
