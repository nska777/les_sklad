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
  small: { width: 125, height: 50, qr: 34 },
  medium: { width: 125, height: 50, qr: 38 },
  large: { width: 125, height: 50, qr: 41 },
} as const;

const PRODUCT_PRESETS = {
  small: { width: 125, height: 50, barcodeHeight: 18 },
  medium: { width: 125, height: 50, barcodeHeight: 22 },
  large: { width: 125, height: 50, barcodeHeight: 26 },
} as const;

const mmToPx = (mm: number) => Math.max(20, Math.round(mm * 3.78));

export default function LabelsPage() {
  const [data, setData] = useState<ApiResult>({ racks: [], cells: [], products: [] });
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"cells" | "products">("cells");
  const [rackId, setRackId] = useState("");
  const [side, setSide] = useState<"all" | "front" | "back">("all");
  const [preset, setPreset] = useState<Preset>("medium");
  const [customWidth, setCustomWidth] = useState(125);
  const [customHeight, setCustomHeight] = useState(50);

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
      setCustomWidth(125);
      setCustomHeight(50);
    } else {
      setCustomWidth(125);
      setCustomHeight(50);
    }
  }, [mode]);

  const activeRack = data.racks.find((rack) => rack.id === rackId);
  const cells = useMemo(() => data.cells
    .filter((cell) => cell.rackId === rackId && !cell.blocked && (side === "all" || cell.side === side))
    .sort((a, b) => a.side.localeCompare(b.side) || b.rowIndex - a.rowIndex || a.columnIndex - b.columnIndex), [data.cells, rackId, side]);

  const size = useMemo(() => {
    if (preset === "custom") {
      return { width: Math.max(70, customWidth), height: Math.max(35, customHeight) };
    }
    return mode === "cells" ? CELL_PRESETS[preset] : PRODUCT_PRESETS[preset];
  }, [preset, mode, customWidth, customHeight]);

  const qrMm = mode === "cells"
    ? (preset === "custom" ? Math.max(24, Math.min(size.height - 8, 41)) : CELL_PRESETS[preset].qr)
    : 0;
  const barcodeHeightMm = mode === "products"
    ? (preset === "custom" ? Math.max(10, Math.min(24, size.height * 0.42)) : PRODUCT_PRESETS[preset].barcodeHeight)
    : 0;

  const printStyle = {
    "--label-width": `${size.width}mm`,
    "--label-height": `${size.height}mm`,
    "--paper-width": "50mm",
    "--paper-height": "125mm",
    "--qr-size": `${qrMm}mm`,
    "--barcode-height": `${barcodeHeightMm}mm`,
  } as React.CSSProperties;

  return <main className="min-h-screen px-3 py-4 text-[var(--foreground)] sm:px-5 lg:px-7" style={printStyle}>
    <style jsx global>{`
      @page { size: 50mm 125mm; margin: 0; }
      @media print {
        .no-print { display: none !important; }
        html, body {
          width: var(--paper-width) !important;
          min-width: var(--paper-width) !important;
          height: var(--paper-height) !important;
          margin: 0 !important;
          padding: 0 !important;
          background: white !important;
        }
        main { margin: 0 !important; padding: 0 !important; min-height: 0 !important; }
        .print-grid {
          display: block !important;
          width: var(--paper-width) !important;
          margin: 0 !important;
          padding: 0 !important;
        }
        .print-label {
          position: relative !important;
          width: var(--paper-width) !important;
          height: var(--paper-height) !important;
          min-height: var(--paper-height) !important;
          max-height: var(--paper-height) !important;
          margin: 0 !important;
          padding: 0 !important;
          border: 0 !important;
          border-radius: 0 !important;
          box-shadow: none !important;
          overflow: hidden !important;
          box-sizing: border-box !important;
          break-inside: avoid !important;
          page-break-inside: avoid !important;
          break-after: page !important;
          page-break-after: always !important;
        }
        .print-label:last-child {
          break-after: auto !important;
          page-break-after: auto !important;
        }
        .print-label-content {
          position: absolute !important;
          top: 0 !important;
          left: var(--paper-width) !important;
          width: var(--label-width) !important;
          height: var(--label-height) !important;
          min-height: var(--label-height) !important;
          max-height: var(--label-height) !important;
          padding: 3mm !important;
          margin: 0 !important;
          box-sizing: border-box !important;
          transform: rotate(90deg) !important;
          transform-origin: top left !important;
          background: white !important;
          overflow: hidden !important;
        }
        .cell-label .print-label-content {
          display: flex !important;
          flex-direction: row !important;
          align-items: center !important;
          justify-content: flex-start !important;
          text-align: left !important;
          gap: 5mm !important;
        }
        .cell-qr {
          flex: 0 0 var(--qr-size) !important;
          width: var(--qr-size) !important;
          height: var(--qr-size) !important;
          margin: 0 !important;
        }
        .cell-qr svg {
          width: var(--qr-size) !important;
          height: var(--qr-size) !important;
          display: block !important;
        }
        .cell-meta { min-width: 0 !important; flex: 1 !important; }
        .cell-kind {
          display: block !important;
          font-size: 9pt !important;
          line-height: 1.1 !important;
          letter-spacing: .1em !important;
          color: #475569 !important;
          font-weight: 800 !important;
          text-transform: uppercase !important;
        }
        .cell-code {
          margin-top: 2mm !important;
          font-size: 30pt !important;
          line-height: 1 !important;
          font-weight: 950 !important;
          letter-spacing: -.035em !important;
          color: #020617 !important;
          white-space: normal !important;
          overflow-wrap: anywhere !important;
        }
        .cell-meta .label-secondary {
          display: block !important;
          margin-top: 2mm !important;
          font-size: 8.5pt !important;
          line-height: 1.2 !important;
          color: #334155 !important;
        }
        .product-barcode {
          width: 105mm !important;
          max-width: 105mm !important;
          overflow: visible !important;
          margin-top: 2mm !important;
        }
        .product-barcode svg {
          width: 105mm !important;
          max-width: 105mm !important;
          max-height: var(--barcode-height) !important;
          height: var(--barcode-height) !important;
          display: block !important;
          margin: 0 auto !important;
        }
        .label-code {
          margin-top: 1.5mm !important;
          font-size: 12pt !important;
          line-height: 1.05 !important;
          font-weight: 950 !important;
          overflow-wrap: anywhere !important;
        }
        .product-name {
          width: 100% !important;
          margin-top: 0 !important;
          font-size: 12pt !important;
          line-height: 1.12 !important;
          font-weight: 850 !important;
          display: -webkit-box !important;
          -webkit-line-clamp: 2 !important;
          -webkit-box-orient: vertical !important;
          overflow: hidden !important;
        }
        .product-name + .product-barcode { margin-top: 2mm !important; }
        .print-label-content > .label-secondary {
          display: flex !important;
          margin-top: 1.5mm !important;
          font-size: 7.5pt !important;
          line-height: 1.1 !important;
          color: #475569 !important;
        }
      }
    `}</style>

    <div className="mx-auto max-w-[1650px] space-y-4">
      <div className="no-print flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Link href="/" className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-blue-700 hover:underline"><ArrowLeft size={16} /> Назад в склад</Link>
          <p className="eyebrow">Печать</p>
          <h1 className="page-title">Этикетки склада</h1>
          <p className="page-description">SATO 50 × 125 мм: браузер получает реальный размер носителя 50 × 125 мм, а макет поворачивается внутри страницы без уменьшения.</p>
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
              <NativeSelectOption value="small">Компактная · 125×50</NativeSelectOption>
              <NativeSelectOption value="medium">Стандарт · 125×50</NativeSelectOption>
              <NativeSelectOption value="large">Крупная · 125×50</NativeSelectOption>
              <NativeSelectOption value="custom">Свой размер</NativeSelectOption>
            </NativeSelect>
          </div>

          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Фактический размер</div>
            {preset === "custom" ? <div className="grid grid-cols-2 gap-2">
              <Input type="number" min="70" max="250" value={customWidth} onChange={(e) => setCustomWidth(Number(e.target.value) || 125)} aria-label="Ширина этикетки" />
              <Input type="number" min="35" max="180" value={customHeight} onChange={(e) => setCustomHeight(Number(e.target.value) || 50)} aria-label="Высота этикетки" />
            </div> : <div className="flex h-10 items-center rounded-xl border border-black/10 bg-slate-50 px-3 text-sm font-bold">{size.width} × {size.height} мм</div>}
            {preset === "custom" && <div className="mt-1 text-[11px] text-slate-500">Ширина × высота, мм</div>}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-600">
          <span className="rounded-full bg-slate-100 px-3 py-1.5">SATO · носитель 50 × 125 мм · макет 125 × 50 мм</span>
          <span className="rounded-full bg-slate-100 px-3 py-1.5">Этикетка: {size.width} × {size.height} мм</span>
          {mode === "cells" && <span className="rounded-full bg-blue-50 px-3 py-1.5 text-blue-700">Горизонтальная · QR ≈ {Math.round(qrMm)} мм</span>}
          {mode === "products" && <span className="rounded-full bg-orange-50 px-3 py-1.5 text-orange-700">Штрихкод: ≈ {Math.round(barcodeHeightMm)} мм высотой</span>}
        </div>
      </section>

      {loading ? <div className="panel flex min-h-80 items-center justify-center"><Loader2 className="animate-spin" /></div> : mode === "cells" ? <section className="print-grid grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {cells.map((cell) => <article key={cell.id} className="print-label cell-label rounded-2xl border bg-white shadow-sm" style={{ width: `${size.width}mm`, minHeight: `${size.height}mm` }}>
          <div className="print-label-content flex flex-row items-center gap-4 p-3 text-left">
            <div className="cell-qr shrink-0"><QRCodeSVG value={cell.code} size={mmToPx(qrMm)} level="M" /></div>
            <div className="cell-meta min-w-0 flex-1">
              <div className="cell-kind text-[10px] font-bold uppercase tracking-[.16em] text-slate-400">QR-код ячейки</div>
              <div className="cell-code mt-1.5 truncate font-mono text-4xl font-black tracking-[-0.045em] text-slate-950">{cell.code}</div>
              <div className="label-secondary mt-2 text-[11px] text-slate-600">{activeRack?.name || activeRack?.code} · {cell.side === "front" ? "Лицевая" : "Задняя"}</div>
              <div className="label-secondary mt-1 text-[10px] text-slate-500">Полка {cell.rowIndex + 1} · место {String.fromCharCode(65 + cell.columnIndex)}</div>
              <div className="label-secondary mt-2 flex items-center gap-1 text-[10px] font-semibold text-slate-500"><QrCode size={11} /> РУССКИЙ ЛЕС · СКЛАД</div>
            </div>
          </div>
        </article>)}
      </section> : <section className="print-grid grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {data.products.map((product) => <article key={product.id} className="print-label rounded-2xl border bg-white shadow-sm" style={{ width: `${size.width}mm`, minHeight: `${size.height}mm` }}>
          <div className="print-label-content flex flex-col items-center justify-center p-4 text-center">
            <div className="product-name line-clamp-2 text-sm font-bold">{product.name}</div>
            <div className="product-barcode mt-2 w-full overflow-hidden">
              <ReactBarcode value={product.barcode || product.sku} format="CODE128" width={1.25} height={mmToPx(barcodeHeightMm)} displayValue={false} margin={0} />
            </div>
            <div className="label-code mt-2 font-mono text-sm font-black">{product.sku}</div>
            <div className="label-secondary mt-1 flex items-center gap-1 text-[10px] text-slate-500"><Barcode size={12} /> Постоянный код материала</div>
          </div>
        </article>)}
      </section>}

      {!loading && mode === "cells" && !cells.length && <div className="panel p-12 text-center text-slate-500"><Layers3 className="mx-auto mb-3" />Для выбранного стеллажа и стороны ячеек нет.</div>}
    </div>
  </main>;
}