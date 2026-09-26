"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRightLeft, Boxes, MapPin, Search } from "lucide-react";
import { ProductBarcode } from "@/components/product-barcode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Product = { id: string; name: string; sku: string; barcode: string; category: string; subcategory: string; brand: string; color: string; ral: string; unit: string; packType: string; packSize: number; oneCId?: string | null };
type Cell = { id: string; rackId: string; code: string; label: string; blocked: boolean };
type Stock = { productId: string; cellId: string; quantity: number };

const fmt = (v: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 6 }).format(v);

export function PaintMaterialsPanel({ products, cells, stocks, warehouseCode }: { products: Product[]; cells: Cell[]; stocks: Stock[]; warehouseCode: string }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return !q ? products : products.filter((p) => `${p.name} ${p.sku} ${p.barcode} ${p.oneCId || ""} ${p.category} ${p.brand} ${p.color} ${p.ral}`.toLowerCase().includes(q));
  }, [products, query]);
  const cellById = useMemo(() => new Map(cells.map((c) => [c.id, c])), [cells]);

  return <section className="panel overflow-hidden p-0">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4 sm:p-5">
      <div><h2 className="text-xl font-black">Материалы склада</h2><p className="mt-1 text-xs text-slate-500">Только фактически размещённые материалы. В одной ячейке может храниться несколько разных позиций.</p></div>
      <div className="relative w-full sm:w-96"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17}/><Input value={query} onChange={(e)=>setQuery(e.target.value)} className="pl-9" placeholder="Название, артикул, штрихкод, ID 1С..."/></div>
    </div>
    <div className="divide-y">
      {filtered.map((p) => {
        const locations = stocks.filter((s) => s.productId === p.id && Number(s.quantity) > 0);
        const total = locations.reduce((sum, s) => sum + Number(s.quantity), 0);
        return <article key={p.id} className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(240px,1.3fr)_280px_160px_minmax(280px,1fr)] lg:items-center">
          <div>
            <div className="font-black leading-5">{p.name}</div>
            <div className="mt-1 text-xs text-slate-500">{p.sku}{p.oneCId ? ` · 1С ${p.oneCId}` : ""}</div>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-semibold text-slate-600">
              {p.category && <span className="rounded-full bg-slate-100 px-2.5 py-1">{p.category}</span>}
              {p.packType && <span className="rounded-full bg-slate-100 px-2.5 py-1">{p.packType}</span>}
              {p.ral && <span className="rounded-full bg-slate-100 px-2.5 py-1">RAL {p.ral}</span>}
            </div>
          </div>
          <div>{p.barcode ? <ProductBarcode value={p.barcode} productName={p.name} compact/> : <div className="rounded-xl border border-dashed p-4 text-center text-xs text-slate-400">Штрихкод не задан</div>}</div>
          <div className="rounded-2xl bg-slate-50 p-4 text-center"><div className="text-xs text-slate-500">Всего на складе</div><div className="mt-1 text-2xl font-black">{fmt(total)} <span className="text-sm">{p.unit}</span></div></div>
          <div>
            <div className="mb-2 text-xs font-black uppercase tracking-wider text-slate-500">Места хранения</div>
            <div className="flex flex-wrap gap-2">{locations.map((s) => { const cell = cellById.get(s.cellId); return <Link key={`${p.id}-${s.cellId}`} data-same-tab="true" href={`/department/${warehouseCode}/rack-layout?product=${encodeURIComponent(p.id)}&cell=${encodeURIComponent(s.cellId)}`} className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-xs font-bold transition hover:border-blue-300 hover:bg-blue-50"><MapPin size={14}/>{cell?.code || "—"}<span className="text-slate-500">{fmt(Number(s.quantity))} {p.unit}</span></Link>; })}{!locations.length && <span className="text-sm text-slate-400">Не размещён</span>}</div>
            {locations.length > 0 && <div className="mt-2 flex gap-2"><Button asChild size="sm" variant="outline"><Link data-same-tab="true" href={`/department/${warehouseCode}/rack-layout?product=${encodeURIComponent(p.id)}`}><Boxes size={14}/> Найти в 3D</Link></Button><Button size="sm" variant="outline" onClick={()=>document.querySelector<HTMLButtonElement>('[data-value="transfer"]')?.click()}><ArrowRightLeft size={14}/> Переместить</Button></div>}
          </div>
        </article>;
      })}
      {!filtered.length && <div className="p-12 text-center text-slate-400">Материалы не найдены</div>}
    </div>
  </section>;
}
