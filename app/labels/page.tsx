"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import ReactBarcode from "react-barcode";
import { QRCodeSVG } from "qrcode.react";
import { ArrowLeft, Barcode, Layers3, Loader2, Printer, QrCode } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

type Rack = { id: string; name: string; code: string; rows: number; columns: number };
type Cell = { id: string; rackId: string; code: string; rowIndex: number; columnIndex: number; blocked: boolean; side: "front" | "back" };
type Product = { id: string; name: string; sku: string; barcode: string; unit: string };
type ApiResult = { racks: Rack[]; cells: Cell[]; products: Product[]; error?: string };

export default function LabelsPage() {
  const [data, setData] = useState<ApiResult>({ racks: [], cells: [], products: [] });
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"cells" | "products">("cells");
  const [rackId, setRackId] = useState("");
  const [side, setSide] = useState<"all" | "front" | "back">("all");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/rack-layout", { cache: "no-store" });
      const result = await response.json() as ApiResult;
      if (!response.ok) throw new Error(result.error || "Не удалось загрузить этикетки");
      setData(result);
      setRackId((current) => result.racks.some((rack) => rack.id === current) ? current : result.racks[0]?.id || "");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось загрузить этикетки");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const activeRack = data.racks.find((rack) => rack.id === rackId);
  const cells = useMemo(() => data.cells
    .filter((cell) => cell.rackId === rackId && !cell.blocked && (side === "all" || cell.side === side))
    .sort((a, b) => a.side.localeCompare(b.side) || b.rowIndex - a.rowIndex || a.columnIndex - b.columnIndex), [data.cells, rackId, side]);

  return <main className="min-h-screen px-3 py-4 text-[var(--foreground)] sm:px-5 lg:px-7">
    <style jsx global>{`
      @media print {
        .no-print { display: none !important; }
        body { background: white !important; }
        .print-grid { display: grid !important; grid-template-columns: repeat(3, 1fr) !important; gap: 8mm !important; padding: 0 !important; }
        .print-label { break-inside: avoid; box-shadow: none !important; border: 1px solid #111 !important; min-height: 55mm !important; }
      }
    `}</style>
    <div className="mx-auto max-w-[1650px] space-y-4">
      <div className="no-print flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div><Link href="/" className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-blue-700 hover:underline"><ArrowLeft size={16} /> Назад в склад</Link><p className="eyebrow">Печать</p><h1 className="page-title">Этикетки склада</h1><p className="page-description">Массовая печать QR-кодов ячеек и постоянных RL-кодов материалов.</p></div>
        <Button onClick={() => window.print()} className="accent-button"><Printer /> Печать выбранного</Button>
      </div>

      <section className="no-print panel p-4 sm:p-5">
        <div className="grid gap-4 md:grid-cols-3">
          <div><div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Тип</div><NativeSelect value={mode} onChange={(event) => setMode(event.target.value as "cells" | "products")} className="w-full"><NativeSelectOption value="cells">QR ячеек</NativeSelectOption><NativeSelectOption value="products">Этикетки материалов</NativeSelectOption></NativeSelect></div>
          {mode === "cells" && <><div><div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Стеллаж</div><NativeSelect value={rackId} onChange={(event) => setRackId(event.target.value)} className="w-full">{data.racks.map((rack) => <NativeSelectOption key={rack.id} value={rack.id}>{rack.code} · {rack.name}</NativeSelectOption>)}</NativeSelect></div><div><div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Сторона</div><NativeSelect value={side} onChange={(event) => setSide(event.target.value as "all" | "front" | "back")} className="w-full"><NativeSelectOption value="all">Обе стороны</NativeSelectOption><NativeSelectOption value="front">Лицевая</NativeSelectOption><NativeSelectOption value="back">Задняя</NativeSelectOption></NativeSelect></div></>}
        </div>
      </section>

      {loading ? <div className="panel flex min-h-80 items-center justify-center"><Loader2 className="animate-spin" /></div> : mode === "cells" ? <section className="print-grid grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {cells.map((cell) => <article key={cell.id} className="print-label flex min-h-56 flex-col items-center justify-center rounded-2xl border bg-white p-5 text-center shadow-sm"><QRCodeSVG value={cell.code} size={130} level="M" /><div className="mt-4 font-mono text-2xl font-black">{cell.code}</div><div className="mt-2 text-sm text-slate-600">{activeRack?.name || activeRack?.code} · {cell.side === "front" ? "Лицевая" : "Задняя"}</div><div className="mt-1 text-xs text-slate-500">Полка {cell.rowIndex + 1} · место {String.fromCharCode(65 + cell.columnIndex)}</div><div className="mt-3 flex items-center gap-1 text-xs font-semibold text-slate-500"><QrCode size={13} /> РУССКИЙ ЛЕС · СКЛАД</div></article>)}
      </section> : <section className="print-grid grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.products.map((product) => <article key={product.id} className="print-label flex min-h-64 flex-col items-center justify-center rounded-2xl border bg-white p-5 text-center shadow-sm"><QRCodeSVG value={product.barcode || product.sku} size={110} /><div className="mt-3 font-mono text-xl font-black">{product.sku}</div><div className="mt-3 max-w-full overflow-hidden"><ReactBarcode value={product.barcode || product.sku} format="CODE128" width={1.35} height={48} displayValue={false} margin={0} /></div><div className="mt-3 line-clamp-2 text-sm font-bold">{product.name}</div><div className="mt-2 flex items-center gap-1 text-xs text-slate-500"><Barcode size={13} /> Постоянный код материала</div></article>)}
      </section>}

      {!loading && mode === "cells" && !cells.length && <div className="panel p-12 text-center text-slate-500"><Layers3 className="mx-auto mb-3" />Для выбранного стеллажа и стороны ячеек нет.</div>}
    </div>
  </main>;
}
