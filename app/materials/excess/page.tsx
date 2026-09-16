"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, FileSpreadsheet, Layers3, Loader2, MapPin, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Location = {
  cellId: string;
  cellCode: string;
  quantity: number;
  rackId: string;
  rackCode: string;
  rackName: string;
  side: "front" | "back";
  rowIndex: number;
  columnIndex: number;
};

type ExcessItem = {
  productId: string;
  name: string;
  sku: string;
  barcode: string;
  unit: string;
  available1c: number;
  factual: number;
  excess: number;
  locations: Location[];
};

type ApiResult = {
  items: ExcessItem[];
  stats: { items: number; units: number };
  error?: string;
};

const qty = (value: number) => Number(value || 0).toLocaleString("ru-RU", { maximumFractionDigits: 3 });

export default function ExcessStockPage() {
  const [data, setData] = useState<ApiResult>({ items: [], stats: { items: 0, units: 0 } });
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    fetch("/api/excess-stock", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as ApiResult;
        if (!response.ok) throw new Error(result.error || "Не удалось загрузить излишки");
        if (!cancelled) setData(result);
      })
      .catch((error) => {
        if (!cancelled) setData({ items: [], stats: { items: 0, units: 0 }, error: error instanceof Error ? error.message : "Ошибка загрузки" });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return data.items;
    return data.items.filter((item) => `${item.name} ${item.sku} ${item.barcode} ${item.locations.map((location) => location.cellCode).join(" ")}`.toLowerCase().includes(q));
  }, [data.items, query]);

  const toggle = (id: string) => {
    setOpenIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <main className="min-h-screen px-3 py-4 text-[var(--foreground)] sm:px-5 lg:px-7">
      <div className="mx-auto max-w-[1500px] space-y-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Link href="/materials" className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-blue-700 hover:underline">← Назад в материалы</Link>
            <p className="eyebrow">Контроль факта относительно 1С</p>
            <h1 className="page-title">Излишки материалов</h1>
            <p className="page-description">1С служит ориентиром. Здесь собраны позиции, где фактический остаток склада выше доступного остатка 1С.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3"><div className="text-xs font-semibold uppercase tracking-wider text-orange-700">Позиций</div><div className="text-2xl font-black text-orange-900">{data.stats.items}</div></div>
            <div className="rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3"><div className="text-xs font-semibold uppercase tracking-wider text-orange-700">Излишек</div><div className="text-2xl font-black text-orange-900">+{qty(data.stats.units)}</div></div>
            <Button asChild variant="outline" className="h-auto min-h-12"><a href="/api/stock-export?scope=all"><FileSpreadsheet /> Выгрузить все остатки</a></Button>
          </div>
        </div>

        <section className="panel overflow-hidden">
          <div className="border-b border-black/10 p-3 sm:p-4">
            <div className="relative max-w-3xl"><Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Название, RL-код, штрихкод или ячейка" className="h-11 pl-11" /></div>
          </div>

          {loading ? <div className="flex min-h-80 items-center justify-center"><Loader2 className="animate-spin" /></div> : data.error ? <div className="p-8 text-center text-red-600">{data.error}</div> : !filtered.length ? <div className="p-12 text-center text-slate-500"><AlertTriangle className="mx-auto mb-3" /><div className="font-semibold">Излишков не найдено</div></div> : <div className="divide-y divide-black/10">
            {filtered.map((item) => {
              const open = openIds.has(item.productId);
              return <article key={item.productId}>
                <button type="button" onClick={() => toggle(item.productId)} className="grid w-full cursor-pointer gap-3 p-4 text-left transition hover:bg-orange-50/50 sm:p-5 xl:grid-cols-[minmax(260px,2fr)_130px_130px_130px_90px] xl:items-center">
                  <div className="min-w-0"><div className="font-bold">{item.name}</div><div className="mt-1 font-mono text-xs font-semibold text-slate-500">{item.sku}</div></div>
                  <div><div className="text-xs text-slate-500">По 1С</div><b>{qty(item.available1c)} {item.unit}</b></div>
                  <div><div className="text-xs text-slate-500">Факт</div><b>{qty(item.factual)} {item.unit}</b></div>
                  <div><div className="text-xs text-orange-700">Излишек</div><b className="text-lg text-orange-700">+{qty(item.excess)} {item.unit}</b></div>
                  <div className="flex items-center justify-end gap-2 text-sm font-semibold text-slate-600">{item.locations.length} мест {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</div>
                </button>

                {open && <div className="border-t border-orange-100 bg-orange-50/30 px-4 pb-5 pt-4 sm:px-5">
                  <div className="mb-3 rounded-xl border border-orange-200 bg-white px-3 py-2 text-sm text-slate-600">Излишек считается по товару целиком: <b>факт − остаток 1С</b>. Ниже показано, где физически лежит весь фактический остаток этой позиции.</div>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {item.locations.map((location) => <div key={location.cellId} className="rounded-2xl border border-black/10 bg-white p-4">
                      <div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-1.5 font-mono font-black"><MapPin size={15} /> {location.cellCode}</div><div className="mt-1 text-sm font-semibold">{location.rackName || location.rackCode}</div><div className="mt-1 text-xs text-slate-500">{location.side === "front" ? "Лицевая" : "Задняя"} сторона · полка {location.rowIndex + 1} · место {String.fromCharCode(65 + location.columnIndex)}</div></div><div className="text-right"><div className="text-xs text-slate-500">В ячейке</div><b>{qty(location.quantity)} {item.unit}</b></div></div>
                      <Button asChild size="sm" variant="outline" className="mt-3 w-full"><Link href={`/rack-layout?cell=${encodeURIComponent(location.cellId)}`} target="_blank"><Layers3 /> Открыть ячейку в 3D</Link></Button>
                    </div>)}
                  </div>
                </div>}
              </article>;
            })}
          </div>}
        </section>
      </div>
    </main>
  );
}
