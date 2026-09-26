"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import * as XLSX from "xlsx";
import ReactBarcode from "react-barcode";
import { ArrowLeft, Layers3, Loader2, Search, Upload, X } from "lucide-react";
import { toast } from "sonner";

type Rack = { id: string; code: string; name: string; storageType: string };
type Cell = { id: string; rackId: string; code: string; label: string; blocked: boolean };
type CatalogItem = { id: string; name: string; sku: string; barcode: string; oneCId?: string | null; category: string; unit: string; quantity1c: number; linkedProductId?: string | null };
type Stock = { productId: string; cellId: string; quantity: number };
type ApiData = { products: CatalogItem[]; racks: Rack[]; cells: Cell[]; stocks: Stock[]; error?: string };
type ImportItem = { name: string; sku?: string; oneCId?: string; barcode?: string; category?: string; unit?: string; quantity?: number; sourceRow?: number };

const fmt = (v: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 6 }).format(v);
const norm = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/ё/g, "е");
const num = (v: unknown) => { const n = Number(String(v ?? "").trim().replace(/\s/g, "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
const barcodeValue = (v: unknown) => String(v ?? "").trim().replace(/\s+/g, "").replace(/\.0$/, "");
const findCol = (headers: unknown[], names: string[]) => headers.findIndex((h) => names.map(norm).includes(norm(h)));
const physicalUnits = ["кг", "г", "л", "мл", "шт."];

async function parseExcel(file: File) {
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false });
  if (!matrix.length) throw new Error("Файл пустой");
  let headerRow = matrix.findIndex((row) => row.some((v) => ["наименование", "товар", "материал", "name"].includes(norm(v))));
  if (headerRow < 0) headerRow = 0;
  const headers = matrix[headerRow] || [], rows = matrix.slice(headerRow + 1);
  let nameCol = findCol(headers, ["наименование", "товар", "материал", "name"]);
  if (nameCol < 0) nameCol = rows.some((r) => String(r[1] ?? "").trim()) ? 1 : 0;
  let qtyCol = findCol(headers, ["остаток", "количество", "кол-во", "кол во", "в наличии", "остаток на складе", "quantity", "qty"]);
  if (qtyCol < 0) {
    const candidates: Array<{ c: number; n: number }> = [];
    const width = Math.max(...matrix.map((r) => r.length), 0);
    for (let c = 0; c < width; c += 1) {
      if (c === nameCol) continue;
      let n = 0;
      for (const row of rows.slice(0, 50)) if (String(row[c] ?? "").trim() && Number.isFinite(num(row[c]))) n += 1;
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
    const name = String(row[nameCol] ?? "").trim(); if (!name) return null;
    return { name, sku: skuCol >= 0 ? String(row[skuCol] ?? "").trim() : "", oneCId: oneCCol >= 0 ? String(row[oneCCol] ?? "").trim() : "", barcode: barcodeCol >= 0 ? barcodeValue(row[barcodeCol]) : "", category: categoryCol >= 0 ? String(row[categoryCol] ?? "").trim() : "", unit: unitCol >= 0 ? String(row[unitCol] ?? "").trim() : "", quantity: qtyCol >= 0 ? num(row[qtyCol]) : 0, sourceRow: headerRow + index + 2 } satisfies ImportItem;
  }).filter(Boolean) as ImportItem[];
  return { items, qtyLabel: qtyCol >= 0 ? String(headers[qtyCol] || `Колонка ${qtyCol + 1}`) : "Не найдена", barcodeLabel: barcodeCol >= 0 ? String(headers[barcodeCol] || `Колонка ${barcodeCol + 1}`) : "Нет" };
}

export default function DepartmentOneCMaterialsPage() {
  const params = useParams<{ warehouse: string }>();
  const warehouse = String(params?.warehouse || "paint"), base = `/department/${warehouse}`;
  const [data, setData] = useState<ApiData>({ products: [], racks: [], cells: [], stocks: [] });
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const [query, setQuery] = useState(""), [page, setPage] = useState(1);
  const [importOpen, setImportOpen] = useState(false), [importItems, setImportItems] = useState<ImportItem[]>([]);
  const [fileName, setFileName] = useState(""), [qtyLabel, setQtyLabel] = useState(""), [barcodeLabel, setBarcodeLabel] = useState("");
  const [placing, setPlacing] = useState<CatalogItem | null>(null), [rackId, setRackId] = useState(""), [cellId, setCellId] = useState("");
  const [quantity, setQuantity] = useState(""), [inputUnit, setInputUnit] = useState("кг");

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await fetch("/api/department-onec", { cache: "no-store" }); const body = await r.json() as ApiData; if (!r.ok) throw new Error(body.error || "Не удалось загрузить материалы 1С"); setData(body); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Ошибка загрузки"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const rackMap = useMemo(() => new Map(data.racks.map((r) => [r.id, r])), [data.racks]);
  const cellMap = useMemo(() => new Map(data.cells.map((c) => [c.id, c])), [data.cells]);
  const factByCatalog = useMemo(() => {
    const map = new Map<string, number>();
    data.products.forEach((item) => { if (item.linkedProductId) map.set(item.id, data.stocks.filter((s) => s.productId === item.linkedProductId).reduce((sum, s) => sum + Number(s.quantity), 0)); });
    return map;
  }, [data.products, data.stocks]);
  const locationsByCatalog = useMemo(() => {
    const map = new Map<string, string[]>();
    data.products.forEach((item) => {
      if (!item.linkedProductId) return;
      const labels = data.stocks.filter((s) => s.productId === item.linkedProductId && Number(s.quantity) > 0).map((s) => { const cell = cellMap.get(s.cellId); const rack = cell ? rackMap.get(cell.rackId) : undefined; return cell && rack ? `${cell.code}: ${fmt(Number(s.quantity))}` : ""; }).filter(Boolean);
      if (labels.length) map.set(item.id, labels);
    });
    return map;
  }, [data.products, data.stocks, cellMap, rackMap]);
  const filtered = useMemo(() => { const q = query.trim().toLowerCase(); return !q ? data.products : data.products.filter((p) => `${p.name} ${p.sku} ${p.barcode} ${p.oneCId || ""} ${p.category}`.toLowerCase().includes(q)); }, [data.products, query]);
  const perPage = 50, pages = Math.max(1, Math.ceil(filtered.length / perPage)), shown = filtered.slice((page - 1) * perPage, page * perPage);
  useEffect(() => { setPage(1); }, [query]);

  const openPlace = (p: CatalogItem) => { setPlacing(p); setRackId(data.racks[0]?.id || ""); setCellId(""); setQuantity(""); setInputUnit(physicalUnits.includes(p.unit) ? p.unit : "кг"); };
  const rackCells = data.cells.filter((c) => c.rackId === rackId && !c.blocked);
  const place = async () => {
    const precise = num(quantity);
    if (!placing || !cellId || precise <= 0) return toast.error("Выберите ячейку, единицу и точное количество");
    setSaving(true);
    try {
      const r = await fetch("/api/department-onec/place", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ catalogId: placing.id, cellId, quantity, inputUnit }) });
      const body = await r.json() as { error?: string; storedQuantity?: number; storedUnit?: string };
      if (!r.ok) throw new Error(body.error || "Не удалось разместить материал");
      toast.success(`Размещено: ${fmt(precise)} ${inputUnit}`, { description: body.storedUnit ? `Учётный остаток: ${fmt(Number(body.storedQuantity || 0))} ${body.storedUnit}` : undefined });
      setPlacing(null); await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Ошибка размещения"); }
    finally { setSaving(false); }
  };
  const doImport = async () => {
    if (!importItems.length) return; setSaving(true);
    try { const r = await fetch("/api/department-onec", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "import", items: importItems }) }); const body = await r.json() as { error?: string; created?: number; updated?: number }; if (!r.ok) throw new Error(body.error || "Импорт не выполнен"); toast.success(`Справочник 1С: ${body.created || 0} новых, ${body.updated || 0} обновлено`); setImportOpen(false); setImportItems([]); await load(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Ошибка импорта"); }
    finally { setSaving(false); }
  };

  const total1c = data.products.reduce((s, p) => s + Number(p.quantity1c || 0), 0), totalFact = Array.from(factByCatalog.values()).reduce((s, v) => s + v, 0), placedCount = data.products.filter((p) => (factByCatalog.get(p.id) || 0) > 0).length;

  return <main className="min-h-screen px-4 py-5 text-[var(--foreground)] sm:px-7"><div className="mx-auto max-w-[1650px] space-y-4">
    <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between"><div><Link href={base} data-same-tab="true" className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-blue-700 hover:underline"><ArrowLeft size={16}/> Назад в склад</Link><p className="eyebrow">Справочник 1С → фактический склад краски</p><h1 className="page-title">Материалы из 1С</h1><p className="page-description">1С остаётся справочником. Факт появляется только после точного размещения.</p></div><div className="flex gap-2"><Link href={`${base}/rack-layout`} data-same-tab="true" className="inline-flex h-10 items-center gap-2 rounded-xl border bg-white px-4 font-semibold"><Layers3 size={16}/> 3D-склад</Link><button onClick={() => setImportOpen(true)} className="inline-flex h-10 items-center gap-2 rounded-xl bg-orange-500 px-4 font-bold text-white"><Upload size={16}/> Загрузить Excel</button></div></div>
    <section className="grid gap-3 sm:grid-cols-3"><div className="panel p-5"><div className="text-sm text-slate-500">В справочнике 1С</div><div className="mt-1 text-3xl font-black">{data.products.length}</div><div className="mt-1 text-xs text-slate-400">По 1С: {fmt(total1c)}</div></div><div className="panel p-5"><div className="text-sm text-slate-500">Фактически размещено</div><div className="mt-1 text-3xl font-black">{placedCount}</div><div className="mt-1 text-xs text-slate-400">Факт: {fmt(totalFact)}</div></div><div className="panel p-5"><div className="text-sm text-slate-500">Ещё не размещено</div><div className="mt-1 text-3xl font-black">{data.products.filter((p) => (factByCatalog.get(p.id) || 0) <= 0).length}</div></div></section>
    <section className="panel overflow-hidden p-0"><div className="flex items-center justify-between gap-3 border-b p-4"><div className="relative w-full max-w-2xl"><Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск: наименование, артикул, штрихкод, ID 1С..." className="h-12 w-full rounded-xl border pl-10 pr-3"/></div><div className="text-sm text-slate-400">Найдено: {filtered.length}</div></div>
      {loading ? <div className="flex h-60 items-center justify-center"><Loader2 className="animate-spin"/></div> : <div className="divide-y">{shown.map((p) => { const fact = Number(factByCatalog.get(p.id) || 0), locations = locationsByCatalog.get(p.id) || []; return <div key={p.id} className="grid gap-3 p-4 xl:grid-cols-[1.7fr_.55fr_.55fr_1fr_1.15fr_auto] xl:items-center"><div><div className="font-black">{p.name}</div><div className="mt-1 text-xs text-slate-400">{p.sku}{p.oneCId ? ` · ID 1С: ${p.oneCId}` : ""}</div></div><div><div className="text-xs text-slate-400">По 1С</div><b>{fmt(p.quantity1c)} {p.unit}</b></div><div><div className="text-xs text-slate-400">Факт</div><b>{fmt(fact)}</b></div><div><div className="text-xs text-slate-400">Где лежит</div><div className="text-sm">{locations.length ? locations.join(" · ") : "Не размещён"}</div></div><div><div className="text-xs text-slate-400">Штрихкод</div><div className="mt-1 inline-block rounded-lg bg-white px-2 py-1">{p.barcode ? <ReactBarcode value={p.barcode} height={28} width={1.15} displayValue fontSize={10} margin={0}/> : <span className="text-xs text-slate-400">Создастся при размещении</span>}</div></div><button onClick={() => openPlace(p)} className="rounded-xl bg-orange-500 px-4 py-2 font-bold text-white">Разместить</button></div>; })}{!shown.length && <div className="p-12 text-center text-slate-400">Ничего не найдено</div>}</div>}
      {pages > 1 && <div className="flex justify-center gap-3 border-t p-4"><button disabled={page <= 1} onClick={() => setPage((x) => x - 1)} className="rounded-lg border px-3 py-1.5 disabled:opacity-40">Назад</button><span>{page} / {pages}</span><button disabled={page >= pages} onClick={() => setPage((x) => x + 1)} className="rounded-lg border px-3 py-1.5 disabled:opacity-40">Далее</button></div>}
    </section>
  </div>
  {placing && <div className="fixed inset-0 z-[50000] flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) setPlacing(null); }}><div className="w-full max-w-[700px] rounded-[28px] bg-white p-6 shadow-2xl"><div className="flex justify-between"><div><div className="text-xs font-black uppercase tracking-[.14em] text-orange-600">Фактическое размещение</div><h2 className="mt-1 text-xl font-black">{placing.name}</h2><p className="mt-1 text-sm text-slate-500">Укажите реальное количество и единицу измерения. Поддерживается точность до 0,000001.</p></div><button onClick={() => setPlacing(null)}><X/></button></div><div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="text-sm font-bold">Место хранения<select value={rackId} onChange={(e) => { setRackId(e.target.value); setCellId(""); }} className="mt-1 h-11 w-full rounded-xl border bg-white px-3"><option value="">Выберите...</option>{data.racks.map((r) => <option key={r.id} value={r.id}>{r.storageType === "floor" ? "Напольная зона" : "Стеллаж"} {r.code} · {r.name}</option>)}</select></label><label className="text-sm font-bold">Ячейка<select value={cellId} onChange={(e) => setCellId(e.target.value)} className="mt-1 h-11 w-full rounded-xl border bg-white px-3"><option value="">Выберите...</option>{rackCells.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}</select></label></div><div className="mt-4 grid gap-3 sm:grid-cols-[1fr_180px]"><label className="text-sm font-bold">Фактическое количество<input value={quantity} onChange={(e) => setQuantity(e.target.value)} inputMode="decimal" placeholder="Например: 48,125750" className="mt-1 h-11 w-full rounded-xl border px-3"/></label><label className="text-sm font-bold">Единица<select value={inputUnit} onChange={(e) => setInputUnit(e.target.value)} className="mt-1 h-11 w-full rounded-xl border bg-white px-3">{physicalUnits.map((u) => <option key={u}>{u}</option>)}</select></label></div><div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm"><b>Штрихкод:</b> {placing.barcode || "будет создан автоматически"}</div><button disabled={saving || !rackId || !cellId || num(quantity) <= 0} onClick={() => void place()} className="mt-5 h-12 w-full rounded-xl bg-orange-500 font-black text-white disabled:opacity-50">{saving ? "Размещение..." : "Создать фактический материал и разместить"}</button></div></div>}
  {importOpen && <div className="fixed inset-0 z-[50000] flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-sm"><div className="max-h-[92vh] w-full max-w-[850px] overflow-auto rounded-[28px] bg-white p-6"><div className="flex justify-between"><div><h2 className="text-2xl font-black">Загрузить справочник 1С</h2><p className="mt-1 text-sm text-slate-500">Импорт обновляет только справочник 1С.</p></div><button onClick={() => setImportOpen(false)}><X/></button></div><label className="mt-5 flex cursor-pointer items-center justify-center rounded-2xl border-2 border-dashed p-8"><input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; try { const parsed = await parseExcel(file); setFileName(file.name); setImportItems(parsed.items); setQtyLabel(parsed.qtyLabel); setBarcodeLabel(parsed.barcodeLabel); } catch (err) { toast.error(err instanceof Error ? err.message : "Не удалось прочитать файл"); } }}/><span className="text-center"><Upload className="mx-auto mb-2"/><b>{fileName || "Выберите Excel / CSV"}</b></span></label>{importItems.length > 0 && <div className="mt-4 grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-400">Позиций</div><b>{importItems.length}</b></div><div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-400">Остаток</div><b>{qtyLabel}</b></div><div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-400">Штрихкод</div><b>{barcodeLabel}</b></div></div>}<button disabled={saving || !importItems.length} onClick={() => void doImport()} className="mt-5 h-12 w-full rounded-xl bg-orange-500 font-black text-white disabled:opacity-50">{saving ? "Загрузка..." : "Загрузить только в справочник 1С"}</button></div></div>}
  </main>;
}
