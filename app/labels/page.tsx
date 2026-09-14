"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import ReactBarcode from "react-barcode";
import { QRCodeSVG } from "qrcode.react";
import { ArrowLeft, Barcode, Layers3, Loader2, Printer, QrCode, Ruler } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

type Rack = { id: string; name: string; code: string; rows: number; columns: number };
type Cell = { id: string; rackId: string; code: string; rowIndex: number; columnIndex: number; blocked: boolean; side: "front" | "back" };
type Product = { id: string; name: string; sku: string; barcode: string; unit: string };
type ApiResult = { racks: Rack[]; cells: Cell[]; products: Product[]; error?: string };
type Preset = "small" | "medium" | "large" | "custom";

const CELL_PRESETS = {
  small: { width: 70, height: 30, qr: 23 },
  medium: { width: 85, height: 36, qr: 28 },
  large: { width: 100, height: 42, qr: 34 },
} as const;

const PRODUCT_PRESETS = {
  small: { width: 65, height: 32, barcodeHeight: 14 },
  medium: { width: 80, height: 40, barcodeHeight: 18 },
  large: { width: 100, height: 50, barcodeHeight: 23 },
} as const;

const mmToPx = (mm: number) => Math.max(20, Math.round(mm * 3.78));

export default function LabelsPage() {
  const [data, setData] = useState<ApiResult>({ racks: [], cells: [], products: [] });
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"cells" | "products">("cells");
  const [rackId, setRackId] = useState("");
  const [side, setSide] = useState<"all" | "front" | "back">("all");
  const [preset, setPreset] = useState<Preset>("medium");
  const [customWidth, setCustomWidth] = useState(85);
  const [customHeight, setCustomHeight] = useState(36);

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

  useEffect(() => {
    setPreset("medium");
    if (mode === "cells") {
      setCustomWidth(85);
      setCustomHeight(36);
    } else {
      setCustomWidth(80);
      setCustomHeight(40);
    }
  }, [mode]);

  const activeRack = data.racks.find((rack) => rack.id === rackId);
  const cells = useMemo(() => data.cells
    .filter((cell) => cell.rackId === rackId && !cell.blocked && (side === "all" || cell.side === side))
    .sort((a, b) => a.side.localeCompare(b.side) || b.rowIndex - a.rowIndex || a.columnIndex - b.columnIndex), [data.cells, rackId, side]);

  const size = useMemo(() => {
    if (preset === "custom") {
      return { width: Math.max(55, customWidth), height: Math.max(24, customHeight) };
    }
    return mode === "cells" ? CELL_PRESETS[preset] : PRODUCT_PRESETS[preset];
  }, [preset, mode, customWidth, customHeight]);

  const qrMm = mode === "cells"
    ? (preset === "custom" ? Math.max(18, Math.min(size.height - 7, size.width * 0.38)) : CELL_PRESETS[preset].qr)
    : 0;
  const barcodeHeightMm = mode === "products"
    ? (preset === "custom" ? Math.max(10, Math.min(24, size.height * 0.42)) : PRODUCT_PRESETS[preset].barcodeHeight)
    : 0;

  const printStyle = {
    "--label-width": `${size.width}mm`,
    "--label-height": `${size.height}mm`,
    "--qr-size": `${qrMm}mm`,
    "--barcode-height": `${barcodeHeightMm}mm`,
  } as React.CSSProperties;

  return <main className="min-h-screen px-3 py-4 text-[var(--foreground)] sm:px-5 lg:px-7" style={printStyle}>
    <style jsx global>{`
      @page { size: A4; margin: 8mm; }
      @media print {
        .no-print { display: none !important; }
        html, body { background: white !important; }
        .print-grid {
          display: grid !important;
          grid-template-columns: repeat(auto-fill, var(--label-width)) !important;
          grid-auto-rows: var(--label-height) !important;
          justify-content: start !important;
          align-content: start !important;
          gap: 4mm !important;
          padding: 0 !important;
        }
        .print-label {
          width: var(--label-width) !important;
          height: var(--label-height) !important;
          min-height: 0 !important;
          max-height: var(--label-height) !important;
          break-inside: avoid !important;
          page-break-inside: avoid !important;
          box-shadow: none !important;
          border: 0.35mm solid #111 !important;
          border-radius: 2mm !important;
          padding: 2.5mm !important;
          overflow: hidden !important;
          box-sizing: border-box !important;
        }
        .cell-label {
          display: flex !important;
          flex-direction: row !important;
          align-items: center !important;
          justify-content: flex-start !important;
          text-align: left !important;
          gap: 4mm !important;
        }
        .cell-qr { flex: 0 0 var(--qr-size) !important; width: var(--qr-size) !important; height: var(--qr-size) !important; }
        .cell-qr svg { width: var(--qr-size) !important; height: var(--qr-size) !important; display: block !important; }
        .cell-meta { min-width: 0 !important; flex: 1 !important; }
        .cell-kind { display: block !important; font-size: 6.5pt !important; line-height: 1 !important; letter-spacing: .12em !important; color: #64748b !important; font-weight: 800 !important; text-transform: uppercase !important; }
        .cell-code { margin-top: 2mm !important; font-size: 17pt !important; line-height: 1 !important; font-weight: 900 !important; white-space: nowrap !important; overflow: hidden !important; text-overflow: ellipsis !important; }
        .product-barcode svg { width: 100% !important; max-height: var(--barcode-height) !important; height: var(--barcode-height) !important; }
        .label-secondary { display: none !important; }
        .label-code { margin-top: 1.5mm !important; font-size: 10pt !important; line-height: 1 !important; }
        .product-name { margin-top: 1.5mm !important; font-size: 8pt !important; line-height: 1.15 !important; }
      }
    `}</style>

    <div className="mx-auto max-w-[1650px] space-y-4">
      <div className="no-print flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Link href="/" className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-blue-700 hover:underline"><ArrowLeft size={16} /> Назад в склад</Link>
          <p className="eyebrow">Печать</p>
          <h1 className="page-title">Этикетки склада</h1>
          <p className="page-description">QR ячеек печатаются горизонтально: код слева, номер ячейки крупно справа. Размер задаётся в миллиметрах.</p>
        </div>
        <Button onClick={() => window.print()} className="accent-button"><Printer /> Печать выбранного</Button>
      </div>

      <section className="no-print panel p-4 sm:p-5">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Тип</div>
            <NativeSelect value={mode} onChange={(event) => setMode(event.target.value as "cells" | "products")} className="w-full">
              <NativeSelectOption value="cells">QR ячеек</NativeSelectOption>
              <NativeSelectOption value="products">Штрихкоды материалов</NativeSelectOption>
            </NativeSelect>
          </div>

          {mode === "cells" && <>
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Стеллаж</div>
              <NativeSelect value={rackId} onChange={(event) => setRackId(event.target.value)} className="w-full">
                {data.racks.map((rack) => <NativeSelectOption key={rack.id} value={rack.id}>{rack.code} · {rack.name}</NativeSelectOption>)}
              </NativeSelect>
            </div>
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Сторона</div>
              <NativeSelect value={side} onChange={(event) => setSide(event.target.value as "all" | "front" | "back")} className="w-full">
                <NativeSelectOption value="all">Обе стороны</NativeSelectOption>
                <NativeSelectOption value="front">Лицевая</NativeSelectOption>
                <NativeSelectOption value="back">Задняя</NativeSelectOption>
              </NativeSelect>
            </div>
          </>}

          <div>
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500"><Ruler size={13} /> Размер этикетки</div>
            <NativeSelect value={preset} onChange={(event) => setPreset(event.target.value as Preset)} className="w-full">
              <NativeSelectOption value="small">Маленькая</NativeSelectOption>
              <NativeSelectOption value="medium">Средняя</NativeSelectOption>
              <NativeSelectOption value="large">Большая</NativeSelectOption>
              <NativeSelectOption value="custom">Свой размер</NativeSelectOption>
            </NativeSelect>
          </div>

          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Фактический размер</div>
            {preset === "custom" ? <div className="grid grid-cols-2 gap-2">
              <Input type="number" min="55" max="180" value={customWidth} onChange={(e) => setCustomWidth(Number(e.target.value) || 55)} aria-label="Ширина этикетки" />
              <Input type="number" min="24" max="100" value={customHeight} onChange={(e) => setCustomHeight(Number(e.target.value) || 24)} aria-label="Высота этикетки" />
            </div> : <div className="flex h-10 items-center rounded-xl border border-black/10 bg-slate-50 px-3 text-sm font-bold">{size.width} × {size.height} мм</div>}
            {preset === "custom" && <div className="mt-1 text-[11px] text-slate-500">Ширина × высота, мм</div>}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-600">
          <span className="rounded-full bg-slate-100 px-3 py-1.5">A4 · поля 8 мм</span>
          <span className="rounded-full bg-slate-100 px-3 py-1.5">Этикетка: {size.width} × {size.height} мм</span>
          {mode === "cells" && <span className="rounded-full bg-blue-50 px-3 py-1.5 text-blue-700">Горизонтальная · QR ≈ {Math.round(qrMm)} мм</span>}
          {mode === "products" && <span className="rounded-full bg-orange-50 px-3 py-1.5 text-orange-700">Штрихкод: ≈ {Math.round(barcodeHeightMm)} мм высотой</span>}
        </div>
      </section>

      {loading ? <div className="panel flex min-h-80 items-center justify-center"><Loader2 className="animate-spin" /></div> : mode === "cells" ? <section className="print-grid grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {cells.map((cell) => <article key={cell.id} className="print-label cell-label flex flex-row items-center gap-4 rounded-2xl border bg-white p-3 text-left shadow-sm" style={{ width: `${size.width}mm`, minHeight: `${size.height}mm` }}>
          <div className="cell-qr shrink-0"><QRCodeSVG value={cell.code} size={mmToPx(qrMm)} level="M" /></div>
          <div className="cell-meta min-w-0 flex-1">
            <div className="cell-kind text-[10px] font-bold uppercase tracking-[.16em] text-slate-400">QR-код ячейки</div>
            <div className="cell-code mt-2 truncate font-mono text-2xl font-black tracking-tight text-slate-900">{cell.code}</div>
            <div className="label-secondary mt-2 text-[11px] text-slate-600">{activeRack?.name || activeRack?.code} · {cell.side === "front" ? "Лицевая" : "Задняя"}</div>
            <div className="label-secondary mt-1 text-[10px] text-slate-500">Полка {cell.rowIndex + 1} · место {String.fromCharCode(65 + cell.columnIndex)}</div>
            <div className="label-secondary mt-2 flex items-center gap-1 text-[10px] font-semibold text-slate-500"><QrCode size={11} /> РУССКИЙ ЛЕС · СКЛАД</div>
          </div>
        </article>)}
      </section> : <section className="print-grid grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {data.products.map((product) => <article key={product.id} className="print-label flex flex-col items-center justify-center rounded-2xl border bg-white p-4 text-center shadow-sm" style={{ width: `${size.width}mm`, minHeight: `${size.height}mm` }}>
          <div className="product-name line-clamp-2 text-sm font-bold">{product.name}</div>
          <div className="product-barcode mt-2 w-full overflow-hidden">
            <ReactBarcode value={product.barcode || product.sku} format="CODE128" width={1.25} height={mmToPx(barcodeHeightMm)} displayValue={false} margin={0} />
          </div>
          <div className="label-code mt-2 font-mono text-sm font-black">{product.sku}</div>
          <div className="label-secondary mt-1 flex items-center gap-1 text-[10px] text-slate-500"><Barcode size={12} /> Постоянный код материала</div>
        </article>)}
      </section>}

      {!loading && mode === "cells" && !cells.length && <div className="panel p-12 text-center text-slate-500"><Layers3 className="mx-auto mb-3" />Для выбранного стеллажа и стороны ячеек нет.</div>}
    </div>
  </main>;
}
