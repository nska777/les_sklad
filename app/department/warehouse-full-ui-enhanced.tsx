"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { MapPin, PackagePlus, Search, X } from "lucide-react";
import { toast } from "sonner";
import WarehouseFullUi from "./warehouse-full-ui";

type Rack = { id: string; code: string; name: string; storageType: string };
type Cell = { id: string; rackId: string; code: string; label: string };
type Product = { id: string; name: string; sku: string; barcode: string; oneCId?: string | null; unit: string; category?: string; brand?: string; color?: string; ral?: string };
type Snapshot = { racks: Rack[]; cells: Cell[]; products: Product[] };

export default function WarehouseFullUiEnhanced() {
  const [toolbarMount, setToolbarMount] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [productId, setProductId] = useState("");
  const [cellId, setCellId] = useState("");

  useEffect(() => {
    let cancelled = false;
    let created: HTMLElement | null = null;
    const locate = () => {
      if (cancelled || toolbarMount) return;
      const input = document.querySelector('input[placeholder*="Название, артикул, RAL"]');
      const toolbar = input?.closest("div.relative")?.parentElement;
      if (toolbar instanceof HTMLElement) {
        created = document.createElement("div");
        created.className = "contents";
        toolbar.insertBefore(created, toolbar.firstChild);
        setToolbarMount(created);
      }
    };
    locate();
    const timer = window.setInterval(locate, 500);
    return () => { cancelled = true; window.clearInterval(timer); created?.remove(); };
  }, [toolbarMount]);

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

  const show = () => { setOpen(true); setQuery(""); setProductId(""); setCellId(""); void load(); };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const products = data?.products || [];
    if (!q) return products;
    return products.filter((p) => `${p.name} ${p.sku} ${p.barcode} ${p.oneCId || ""} ${p.category || ""} ${p.brand || ""} ${p.color || ""} ${p.ral || ""}`.toLowerCase().includes(q));
  }, [data, query]);
  const rackById = useMemo(() => new Map((data?.racks || []).map((r) => [r.id, r])), [data]);
  const product = data?.products.find((p) => p.id === productId);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); if (!productId || !cellId) return;
    const form = new FormData(e.currentTarget);
    setSaving(true);
    try {
      const response = await fetch("/api/department-warehouse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "receive", productId, cellId, quantity: form.get("quantity"), documentNumber: "РАЗМЕЩЕНИЕ", sourceName: "Материалы", sourceLocation: "Склад краски", comment: "Размещение из раздела Материалы" }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "Не удалось разместить материал");
      toast.success("Материал размещён");
      setOpen(false);
      window.setTimeout(() => window.location.reload(), 250);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось разместить материал"); }
    finally { setSaving(false); }
  };

  const button = <button type="button" onClick={show} className="inline-flex h-9 items-center gap-2 rounded-lg bg-orange-500 px-3 text-sm font-bold text-white shadow-sm hover:bg-orange-600"><PackagePlus size={15}/> Разместить материал</button>;

  return <>
    <WarehouseFullUi />
    {toolbarMount ? createPortal(button, toolbarMount) : <div className="fixed bottom-5 right-5 z-40">{button}</div>}
    {open && <div className="fixed inset-0 z-[35000] flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="max-h-[92vh] w-full max-w-[760px] overflow-auto rounded-[28px] border bg-white p-5 shadow-2xl sm:p-6">
        <div className="flex items-start justify-between gap-4"><div><div className="text-xs font-black uppercase tracking-[.14em] text-orange-600">Материалы</div><h2 className="mt-1 text-2xl font-black">Разместить материал</h2><p className="mt-1 text-sm text-slate-500">Выберите материал и конкретное место хранения: стеллаж, ячейку или напольную зону.</p></div><button type="button" onClick={() => setOpen(false)} className="rounded-xl p-2 hover:bg-slate-100"><X/></button></div>
        {loading ? <div className="py-16 text-center text-slate-400">Загрузка...</div> : <form className="mt-5 space-y-4" onSubmit={submit}>
          <div><label className="mb-1.5 block text-sm font-bold">Поиск</label><div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Название, артикул, штрихкод, ID 1С, RAL..." className="h-11 w-full rounded-xl border pl-9 pr-3 outline-none focus:border-blue-500"/></div></div>
          <div><label className="mb-1.5 block text-sm font-bold">Материал</label><select value={productId} onChange={(e) => setProductId(e.target.value)} className="h-11 w-full rounded-xl border bg-white px-3"><option value="">Выберите...</option>{filtered.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.sku} · {p.unit}</option>)}</select>{product && <div className="mt-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-600"><b>Штрихкод:</b> <span className="font-mono">{product.barcode || "будет присвоен автоматически"}</span>{product.oneCId ? <span> · <b>1С:</b> {product.oneCId}</span> : null}</div>}</div>
          <div><label className="mb-1.5 block text-sm font-bold">Место хранения</label><select value={cellId} onChange={(e) => setCellId(e.target.value)} className="h-11 w-full rounded-xl border bg-white px-3"><option value="">Выберите...</option>{(data?.cells || []).map((c) => { const rack = rackById.get(c.rackId); return <option key={c.id} value={c.id}>{rack?.storageType === "floor" ? "Напольная зона" : `Стеллаж ${rack?.code || ""}`} · {c.code}{rack?.name ? ` · ${rack.name}` : ""}</option>; })}</select></div>
          <div><label className="mb-1.5 block text-sm font-bold">Количество {product?.unit ? `(${product.unit})` : ""}</label><input name="quantity" type="number" min="0.001" step="0.001" required className="h-11 w-full rounded-xl border px-3"/></div>
          <button disabled={saving || !productId || !cellId} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-orange-500 font-black text-white disabled:opacity-50"><MapPin size={17}/>{saving ? "Размещение..." : "Разместить и сохранить"}</button>
        </form>}
      </div>
    </div>}
  </>;
}
