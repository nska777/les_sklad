"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertTriangle, Layers3, MapPin } from "lucide-react";

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

export function ExcessStockPanel({ context }: { context: "materials" | "rack" }) {
  const [data, setData] = useState<ApiResult>({ items: [], stats: { items: 0, units: 0 } });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch("/api/excess-stock", { cache: "no-store" });
        const result = await response.json() as ApiResult;
        if (active && response.ok) setData(result);
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    const onRefresh = () => void load();
    window.addEventListener("warehouse-data-refresh", onRefresh);
    return () => {
      active = false;
      window.removeEventListener("warehouse-data-refresh", onRefresh);
    };
  }, []);

  if (loading || !data.items.length) return null;

  return (
    <div className="px-3 pt-4 sm:px-5 lg:px-7">
      <div className="mx-auto max-w-[1750px]">
        <details className="overflow-hidden rounded-2xl border border-orange-200 bg-orange-50/90 shadow-sm" open>
          <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-100 text-orange-700"><AlertTriangle size={20} /></div>
              <div>
                <div className="font-bold text-orange-950">Излишки относительно 1С</div>
                <div className="text-xs text-orange-800">1С используется как ориентир, фактический склад не ограничивается остатком 1С.</div>
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="rounded-full bg-white px-3 py-1.5 font-semibold text-orange-900 ring-1 ring-orange-200">Позиций: {data.stats.items}</span>
              <span className="rounded-full bg-orange-600 px-3 py-1.5 font-bold text-white">Излишек: +{qty(data.stats.units)}</span>
            </div>
          </summary>

          <div className="border-t border-orange-200 bg-white/75 p-3 sm:p-4">
            <div className="grid gap-3 xl:grid-cols-2">
              {data.items.map((item) => (
                <article key={item.productId} className="rounded-2xl border border-orange-200 bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="break-words font-bold text-slate-950">{item.name}</div>
                      <div className="mt-1 font-mono text-xs font-semibold text-slate-500">{item.sku}</div>
                    </div>
                    <span className="rounded-full bg-orange-100 px-3 py-1 text-sm font-black text-orange-800">+{qty(item.excess)} {item.unit}</span>
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                    <div className="rounded-xl bg-slate-50 p-2.5"><div className="text-[11px] text-slate-500">По 1С</div><b>{qty(item.available1c)}</b></div>
                    <div className="rounded-xl bg-slate-50 p-2.5"><div className="text-[11px] text-slate-500">Факт</div><b>{qty(item.factual)}</b></div>
                    <div className="rounded-xl bg-orange-50 p-2.5"><div className="text-[11px] text-orange-700">Излишек</div><b className="text-orange-800">+{qty(item.excess)}</b></div>
                  </div>

                  {!!item.locations?.length && <div className="mt-3">
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Размещено в ячейках</div>
                    <div className="flex flex-wrap gap-1.5">
                      {item.locations.map((location) => (
                        <Link key={location.cellId} href={`/rack-layout?cell=${encodeURIComponent(location.cellId)}`} className="inline-flex items-center gap-1.5 rounded-lg border border-orange-200 bg-orange-50 px-2.5 py-1.5 text-xs font-semibold text-orange-900 hover:bg-orange-100">
                          <MapPin size={12} />
                          <span className="font-mono">{location.cellCode}</span>
                          <span>· {qty(location.quantity)} {item.unit}</span>
                          {context === "materials" && <Layers3 size={12} />}
                        </Link>
                      ))}
                    </div>
                  </div>}
                </article>
              ))}
            </div>
          </div>
        </details>
      </div>
    </div>
  );
}
