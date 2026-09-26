"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, MapPin, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { ProductBarcode } from "@/components/product-barcode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Product = { id: string; name: string; sku: string; barcode: string; category: string; subcategory: string; brand: string; color: string; ral: string; unit: string; packType: string; packSize: number; oneCId?: string | null };
type Cell = { id: string; rackId: string; code: string; label: string; blocked: boolean; rowIndex?: number; columnIndex?: number };
type Rack = { id: string; code: string; name: string; storageType: string };
type Stock = { productId: string; cellId: string; quantity: number };

type MoveDraft = { product: Product; stock: Stock } | null;

const fmt = (v: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 9 }).format(v);
const preciseUnits = ["кг", "г", "мг", "л", "мл", "мкл", "шт."];
const normUnit = (value: string) => value.trim().toLowerCase().replace("шт", "шт.");
const unitToBase = (unit: string) => {
  const u = normUnit(unit);
  if (u === "кг") return { family: "mass", factor: 1 };
  if (u === "г") return { family: "mass", factor: .001 };
  if (u === "мг") return { family: "mass", factor: .000001 };
  if (u === "л") return { family: "volume", factor: 1 };
  if (u === "мл") return { family: "volume", factor: .001 };
  if (u === "мкл") return { family: "volume", factor: .000001 };
  return { family: "piece", factor: 1 };
};
const convertQuantity = (value: number, from: string, to: string) => {
  const a = unitToBase(from), b = unitToBase(to);
  if (a.family !== b.family) return null;
  return value * a.factor / b.factor;
};

export function PaintMaterialsPanel({ products, cells, stocks, racks }: { products: Product[]; cells: Cell[]; stocks: Stock[]; racks: Rack[] }) {
  const [query, setQuery] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [move, setMove] = useState<MoveDraft>(null);
  const [targetCellId, setTargetCellId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [inputUnit, setInputUnit] = useState("кг");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.json()).then((body) => setIsAdmin(body?.user?.role === "admin")).catch(() => setIsAdmin(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return !q ? products : products.filter((p) => `${p.name} ${p.sku} ${p.barcode} ${p.oneCId || ""} ${p.category} ${p.brand} ${p.color} ${p.ral}`.toLowerCase().includes(q));
  }, [products, query]);
  const cellById = useMemo(() => new Map(cells.map((c) => [c.id, c])), [cells]);
  const rackById = useMemo(() => new Map(racks.map((r) => [r.id, r])), [racks]);

  const distinctInCell = (cellId: string) => new Set(stocks.filter((s) => s.cellId === cellId && Number(s.quantity) > 0).map((s) => s.productId));
  const destinationCells = useMemo(() => {
    if (!move) return [];
    return cells.filter((c) => {
      if (c.blocked || c.id === move.stock.cellId) return false;
      const current = distinctInCell(c.id);
      return current.has(move.product.id) || current.size < 5;
    });
  }, [cells, stocks, move]);

  const openMove = (product: Product, stock: Stock) => {
    setMove({ product, stock });
    setTargetCellId("");
    setQuantity(String(stock.quantity));
    setInputUnit(normUnit(product.unit));
  };

  const submitMove = async () => {
    if (!move || !targetCellId) return;
    const raw = Number(quantity.replace(",", "."));
    if (!Number.isFinite(raw) || raw <= 0) return toast.error("Укажите количество");
    const converted = convertQuantity(raw, inputUnit, move.product.unit);
    if (converted === null) return toast.error(`Нельзя пересчитать ${inputUnit} в ${move.product.unit}`);
    if (converted > Number(move.stock.quantity) + 1e-12) return toast.error(`В ячейке доступно ${fmt(Number(move.stock.quantity))} ${move.product.unit}`);
    setBusy(true);
    try {
      const r = await fetch("/api/department-warehouse-controls", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "moveProduct", productId: move.product.id, fromCellId: move.stock.cellId, toCellId: targetCellId, quantity: Number(converted.toFixed(9)), comment: `Перемещение из раздела Материалы: ${raw} ${inputUnit}` }) });
      const body = await r.json() as { error?: string };
      if (!r.ok) throw new Error(body.error || "Не удалось переместить материал");
      toast.success("Материал перемещён");
      setMove(null);
      window.setTimeout(() => window.location.reload(), 200);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Не удалось переместить материал"); }
    finally { setBusy(false); }
  };

  const deleteProduct = async (product: Product) => {
    if (!isAdmin) return;
    if (!confirm(`Удалить материал «${product.name}» полностью вместе с остатками и историей движений?`)) return;
    setBusy(true);
    try {
      const r = await fetch("/api/department-warehouse-controls", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "deleteProductAdmin", productId: product.id }) });
      const body = await r.json() as { error?: string };
      if (!r.ok) throw new Error(body.error || "Не удалось удалить материал");
      toast.success("Материал удалён");
      window.setTimeout(() => window.location.reload(), 180);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Не удалось удалить материал"); }
    finally { setBusy(false); }
  };

  return <>
    <section className="panel overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4 sm:p-5">
        <div><h2 className="text-xl font-black">Материалы склада</h2><p className="mt-1 text-xs text-slate-500">Фактические остатки. В одной ячейке — максимум 5 разных материалов.</p></div>
        <div className="relative w-full sm:w-96"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17}/><Input value={query} onChange={(e)=>setQuery(e.target.value)} className="pl-9" placeholder="Название, артикул, штрихкод, ID 1С..."/></div>
      </div>
      <div className="divide-y">
        {filtered.map((p) => {
          const locations = stocks.filter((s) => s.productId === p.id && Number(s.quantity) > 0);
          const total = locations.reduce((sum, s) => sum + Number(s.quantity), 0);
          return <article key={p.id} className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(240px,1.3fr)_280px_160px_minmax(310px,1fr)] lg:items-center">
            <div>
              <div className="font-black leading-5">{p.name}</div>
              <div className="mt-1 text-xs text-slate-500">{p.sku}{p.oneCId ? ` · 1С ${p.oneCId}` : ""}</div>
              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-semibold text-slate-600">{p.category && <span className="rounded-full bg-slate-100 px-2.5 py-1">{p.category}</span>}{p.packType && <span className="rounded-full bg-slate-100 px-2.5 py-1">{p.packType}</span>}{p.ral && <span className="rounded-full bg-slate-100 px-2.5 py-1">RAL {p.ral}</span>}</div>
              {isAdmin && <Button type="button" size="sm" variant="outline" className="mt-3 text-red-600" disabled={busy} onClick={()=>void deleteProduct(p)}><Trash2 size={14}/> Удалить материал</Button>}
            </div>
            <div>{p.barcode ? <ProductBarcode value={p.barcode} productName={p.name} compact/> : <div className="rounded-xl border border-dashed p-4 text-center text-xs text-slate-400">Штрихкод не задан</div>}</div>
            <div className="rounded-2xl bg-slate-50 p-4 text-center"><div className="text-xs text-slate-500">Всего на складе</div><div className="mt-1 text-2xl font-black">{fmt(total)} <span className="text-sm">{p.unit}</span></div></div>
            <div>
              <div className="mb-2 text-xs font-black uppercase tracking-wider text-slate-500">Места хранения</div>
              <div className="space-y-2">{locations.map((s) => { const cell = cellById.get(s.cellId); const rack = cell ? rackById.get(cell.rackId) : undefined; return <div key={`${p.id}-${s.cellId}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-white px-3 py-2 text-xs"><span className="inline-flex items-center gap-2 font-bold"><MapPin size={14}/>{rack?.storageType === "floor" ? "Напольная зона" : `Стеллаж ${rack?.code || ""}`} · {cell?.code || "—"}{cell?.rowIndex !== undefined && rack?.storageType !== "floor" ? ` · полка ${cell.rowIndex + 1}` : ""}</span><span className="font-black">{fmt(Number(s.quantity))} {p.unit}</span><Button type="button" size="sm" variant="outline" onClick={()=>openMove(p,s)}><ArrowRightLeft size={14}/> Переместить</Button></div>; })}{!locations.length && <span className="text-sm text-slate-400">Не размещён</span>}</div>
            </div>
          </article>;
        })}
        {!filtered.length && <div className="p-12 text-center text-slate-400">Материалы не найдены</div>}
      </div>
    </section>

    {move && <div className="fixed inset-0 z-[50000] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm" onMouseDown={(e)=>{ if(e.target===e.currentTarget&&!busy)setMove(null); }}>
      <section className="w-full max-w-2xl rounded-[28px] bg-white p-5 shadow-2xl sm:p-6">
        <div className="flex items-start justify-between gap-4"><div><div className="text-xs font-black uppercase tracking-[.14em] text-blue-600">Перемещение</div><h2 className="mt-1 text-2xl font-black">{move.product.name}</h2><p className="mt-1 text-sm text-slate-500">Выберите доступное место хранения. Ячейки с 5 разными материалами скрыты.</p></div><button type="button" onClick={()=>setMove(null)} className="rounded-xl p-2 hover:bg-slate-100"><X/></button></div>
        <div className="mt-5 rounded-2xl bg-slate-50 p-4 text-sm"><b>Откуда:</b> {cellById.get(move.stock.cellId)?.code} · доступно {fmt(Number(move.stock.quantity))} {move.product.unit}</div>
        <div className="mt-4"><label className="mb-1.5 block text-sm font-bold">Куда переместить</label><select value={targetCellId} onChange={(e)=>setTargetCellId(e.target.value)} className="h-12 w-full rounded-xl border bg-white px-3"><option value="">Выберите стеллаж / напольную зону / ячейку...</option>{destinationCells.map((c)=>{ const rack=rackById.get(c.rackId); const count=distinctInCell(c.id).size; return <option key={c.id} value={c.id}>{rack?.storageType==="floor"?"Напольная зона":`Стеллаж ${rack?.code||""}`} · {c.code}{c.rowIndex!==undefined&&rack?.storageType!=="floor"?` · полка ${c.rowIndex+1}`:""} · {count}/5 материалов</option>; })}</select></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_160px]"><div><label className="mb-1.5 block text-sm font-bold">Количество</label><Input value={quantity} onChange={(e)=>setQuantity(e.target.value)} inputMode="decimal" placeholder="0,000001"/></div><div><label className="mb-1.5 block text-sm font-bold">Единица</label><select value={inputUnit} onChange={(e)=>setInputUnit(e.target.value)} className="h-10 w-full rounded-md border bg-white px-3 text-sm">{preciseUnits.map((u)=><option key={u}>{u}</option>)}</select></div></div>
        <Button type="button" className="accent-button mt-5 h-12 w-full" disabled={busy||!targetCellId} onClick={()=>void submitMove()}><ArrowRightLeft size={17}/>{busy?"Перемещение...":"Переместить материал"}</Button>
      </section>
    </div>}
  </>;
}
