"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { MapPin, PackagePlus, Search, X } from "lucide-react";
import { toast } from "sonner";
import WarehouseFullUi from "./warehouse-full-ui";
import { PaintMaterialsPanel } from "./paint-materials-panel";

type Rack = { id: string; code: string; name: string; storageType: string };
type Cell = { id: string; rackId: string; code: string; label: string; blocked?: boolean };
type Product = { id: string; name: string; sku: string; barcode: string; oneCId?: string | null; unit: string; category: string; subcategory: string; brand: string; color: string; ral: string; packType: string; packSize: number };
type Stock = { productId: string; cellId: string; quantity: number };
type Snapshot = { racks: Rack[]; cells: Cell[]; products: Product[]; stocks: Stock[] };

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

export default function WarehouseFullUiEnhanced() {
  const [toolbarMount, setToolbarMount] = useState<HTMLElement | null>(null);
  const [materialsMount, setMaterialsMount] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [productId, setProductId] = useState("");
  const [cellId, setCellId] = useState("");
  const [inputUnit, setInputUnit] = useState("кг");

  useEffect(() => {
    let cancelled = false;
    let toolbarCreated: HTMLElement | null = null;
    let materialsCreated: HTMLElement | null = null;
    let hiddenPanel: HTMLElement | null = null;
    const locate = () => {
      if (cancelled) return;
      const input = document.querySelector('input[placeholder*="Название, артикул, RAL"]');
      const toolbar = input?.closest("div.relative")?.parentElement;
      if (!toolbarCreated && toolbar instanceof HTMLElement) {
        toolbarCreated = document.createElement("div");
        toolbarCreated.className = "contents";
        toolbar.insertBefore(toolbarCreated, toolbar.firstChild);
        setToolbarMount(toolbarCreated);
      }
      if (!materialsCreated && input) {
        const panel = input.closest("section.panel");
        if (panel instanceof HTMLElement && panel.parentElement instanceof HTMLElement) {
          hiddenPanel = panel;
          panel.style.display = "none";
          materialsCreated = document.createElement("div");
          panel.parentElement.insertBefore(materialsCreated, panel);
          setMaterialsMount(materialsCreated);
        }
      }
    };
    locate();
    const timer = window.setInterval(locate, 350);
    return () => {
      cancelled = true; window.clearInterval(timer);
      toolbarCreated?.remove(); materialsCreated?.remove();
      if (hiddenPanel) hiddenPanel.style.display = "";
    };
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/department-warehouse", { cache: "no-store" });
      const body = await response.json() as Snapshot & { error?: string };
      if (!response.ok) throw new Error(body.error || "Не удалось загрузить склад");
      setData(body);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось загрузить данные"); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const show = () => { setOpen(true); setQuery(""); setProductId(""); setCellId(""); void load(); };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const products = data?.products || [];
    if (!q) return products;
    return products.filter((p) => `${p.name} ${p.sku} ${p.barcode} ${p.oneCId || ""} ${p.category || ""} ${p.brand || ""} ${p.color || ""} ${p.ral || ""}`.toLowerCase().includes(q));
  }, [data, query]);
  const rackById = useMemo(() => new Map((data?.racks || []).map((r) => [r.id, r])), [data]);
  const product = data?.products.find((p) => p.id === productId);
  const cellContents = useMemo(() => {
    if (!cellId || !data) return [];
    return data.stocks.filter((s) => s.cellId === cellId && Number(s.quantity) > 0).map((s) => ({ ...s, product: data.products.find((p) => p.id === s.productId) }));
  }, [cellId, data]);

  useEffect(() => { if (product?.unit) setInputUnit(normUnit(product.unit)); }, [product?.unit]);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); if (!productId || !cellId || !product) return;
    const form = new FormData(e.currentTarget);
    const raw = Number(String(form.get("quantity") || "").replace(",", "."));
    if (!Number.isFinite(raw) || raw <= 0) return toast.error("Укажите точное количество");
    const converted = convertQuantity(raw, inputUnit, product.unit);
    if (converted === null) return toast.error(`Нельзя пересчитать ${inputUnit} в ${product.unit}`);
    setSaving(true);
    try {
      const response = await fetch("/api/department-warehouse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "receive", productId, cellId, quantity: Number(converted.toFixed(9)), documentNumber: "РАЗМЕЩЕНИЕ", sourceName: "Материалы", sourceLocation: "Склад краски", comment: `Размещение: ${raw} ${inputUnit}` }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "Не удалось разместить материал");
      toast.success("Материал размещён", { description: `${raw.toLocaleString("ru-RU", { maximumFractionDigits: 9 })} ${inputUnit} → учёт ${Number(converted.toFixed(9)).toLocaleString("ru-RU", { maximumFractionDigits: 9 })} ${product.unit}` });
      setOpen(false); await load();
      window.setTimeout(() => window.location.reload(), 180);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось разместить материал"); }
    finally { setSaving(false); }
  };

  const button = <button type="button" onClick={show} className="inline-flex h-9 items-center gap-2 rounded-lg bg-orange-500 px-3 text-sm font-bold text-white shadow-sm hover:bg-orange-600"><PackagePlus size={15}/> Разместить материал</button>;

  return <>
    <WarehouseFullUi />
    {toolbarMount ? createPortal(button, toolbarMount) : <div className="fixed bottom-5 right-5 z-40">{button}</div>}
    {materialsMount && data ? createPortal(<PaintMaterialsPanel products={data.products} cells={data.cells} stocks={data.stocks} warehouseCode="paint"/>, materialsMount) : null}
    {open && <div className="fixed inset-0 z-[35000] flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="max-h-[92vh] w-full max-w-[820px] overflow-auto rounded-[28px] border bg-white p-5 shadow-2xl sm:p-6">
        <div className="flex items-start justify-between gap-4"><div><div className="text-xs font-black uppercase tracking-[.14em] text-orange-600">Фактический склад</div><h2 className="mt-1 text-2xl font-black">Разместить материал</h2><p className="mt-1 text-sm text-slate-500">В одной ячейке можно хранить несколько разных материалов. Количество можно вводить с высокой точностью.</p></div><button type="button" onClick={() => setOpen(false)} className="rounded-xl p-2 hover:bg-slate-100"><X/></button></div>
        {loading ? <div className="py-16 text-center text-slate-400">Загрузка...</div> : <form className="mt-5 space-y-4" onSubmit={submit}>
          <div><label className="mb-1.5 block text-sm font-bold">Поиск материала</label><div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Название, артикул, штрихкод, ID 1С, RAL..." className="h-11 w-full rounded-xl border pl-9 pr-3 outline-none focus:border-blue-500"/></div></div>
          <div><label className="mb-1.5 block text-sm font-bold">Материал</label><select value={productId} onChange={(e) => setProductId(e.target.value)} className="h-11 w-full rounded-xl border bg-white px-3"><option value="">Выберите...</option>{filtered.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.sku} · учёт {p.unit}</option>)}</select>{product && <div className="mt-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-600"><b>Штрихкод:</b> <span className="font-mono">{product.barcode || "будет присвоен автоматически"}</span>{product.oneCId ? <span> · <b>1С:</b> {product.oneCId}</span> : null}</div>}</div>
          <div><label className="mb-1.5 block text-sm font-bold">Место хранения</label><select value={cellId} onChange={(e) => setCellId(e.target.value)} className="h-11 w-full rounded-xl border bg-white px-3"><option value="">Выберите...</option>{(data?.cells || []).filter((c)=>!c.blocked).map((c) => { const rack = rackById.get(c.rackId); const count = data?.stocks.filter((s)=>s.cellId===c.id && Number(s.quantity)>0).length || 0; return <option key={c.id} value={c.id}>{rack?.storageType === "floor" ? "Напольная зона" : `Стеллаж ${rack?.code || ""}`} · {c.code}{rack?.name ? ` · ${rack.name}` : ""} · {count ? `${count} поз.` : "свободно"}</option>; })}</select></div>
          {cellId && <div className="rounded-2xl border bg-blue-50/50 p-3"><div className="text-xs font-black uppercase tracking-wider text-blue-700">Сейчас в ячейке</div>{cellContents.length ? <div className="mt-2 space-y-1">{cellContents.map((s)=><div key={s.productId} className="flex justify-between gap-3 text-sm"><span>{s.product?.name || "Материал"}</span><b>{Number(s.quantity).toLocaleString("ru-RU",{maximumFractionDigits:9})} {s.product?.unit}</b></div>)}</div> : <div className="mt-1 text-sm text-slate-500">Ячейка свободна. Можно добавить первый материал.</div>}</div>}
          <div className="grid gap-3 sm:grid-cols-[1fr_180px]"><div><label className="mb-1.5 block text-sm font-bold">Фактическое количество</label><input name="quantity" inputMode="decimal" type="number" min="0.000000001" step="0.000000001" required className="h-11 w-full rounded-xl border px-3" placeholder="0,000001"/></div><div><label className="mb-1.5 block text-sm font-bold">Единица</label><select value={inputUnit} onChange={(e)=>setInputUnit(e.target.value)} className="h-11 w-full rounded-xl border bg-white px-3">{preciseUnits.map((u)=><option key={u}>{u}</option>)}</select></div></div>
          <div className="text-xs text-slate-500">Поддерживается точность до 9 знаков после запятой. Масса: кг/г/мг. Объём: л/мл/мкл. Система пересчитает в основную единицу карточки материала.</div>
          <button disabled={saving || !productId || !cellId} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-orange-500 font-black text-white disabled:opacity-50"><MapPin size={17}/>{saving ? "Размещение..." : "Разместить и сохранить"}</button>
        </form>}
      </div>
    </div>}
  </>;
}
