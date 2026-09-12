"use client";

import { useEffect, useState } from "react";
import Barcode from "react-barcode";
import { X } from "lucide-react";

type ProductBarcodeProps = {
  value: string;
  productName?: string;
  compact?: boolean;
  className?: string;
};

export function ProductBarcode({ value, productName, compact = false, className = "" }: ProductBarcodeProps) {
  const safeValue = value.trim();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!safeValue) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`group block w-full cursor-zoom-in overflow-hidden rounded-xl border border-black/10 bg-white px-3 py-2 text-left transition duration-200 hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md ${className}`}
        aria-label={`Увеличить штрихкод ${safeValue}`}
      >
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[.14em] text-slate-400">Штрихкод</span>
          <span className="text-[10px] font-medium text-blue-600 opacity-0 transition group-hover:opacity-100">Нажмите для увеличения</span>
        </div>
        {productName && <div className="mb-1 truncate text-center text-xs font-semibold text-slate-700">{productName}</div>}
        <div className="flex max-w-full justify-center overflow-hidden">
          <Barcode
            value={safeValue}
            format="CODE128"
            width={compact ? 1.25 : 1.55}
            height={compact ? 38 : 52}
            margin={0}
            fontSize={compact ? 11 : 12}
            displayValue
            background="transparent"
          />
        </div>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm animate-in fade-in duration-200"
          role="dialog"
          aria-modal="true"
          aria-label={`Штрихкод ${safeValue}`}
        >
          <div className="relative w-full max-w-3xl rounded-[28px] border border-white/40 bg-white p-5 shadow-2xl animate-in zoom-in-95 fade-in duration-200 sm:p-8">
            <button
              type="button"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => { event.stopPropagation(); setOpen(false); }}
              className="absolute right-3 top-3 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-600 shadow-sm transition hover:bg-slate-200 active:scale-95"
              aria-label="Закрыть"
            >
              <X size={22} />
            </button>
            <div className="mb-5 pr-14">
              <div className="text-xs font-semibold uppercase tracking-[.16em] text-slate-400">Штрихкод материала</div>
              {productName && <div className="mt-1 text-xl font-bold text-slate-900 sm:text-2xl">{productName}</div>}
              <div className="mt-1 font-mono text-sm font-bold text-slate-700">{safeValue}</div>
            </div>
            <div className="flex min-h-[220px] flex-col items-center justify-center gap-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-5 sm:min-h-[300px] sm:p-8">
              {productName && <div className="max-w-full text-center text-lg font-bold text-slate-900 sm:text-2xl">{productName}</div>}
              <Barcode
                value={safeValue}
                format="CODE128"
                width={2.7}
                height={150}
                margin={0}
                fontSize={22}
                displayValue
                background="transparent"
              />
            </div>
            <div className="mt-4 text-center text-xs text-slate-400">Закрыть — крестик справа сверху или Esc</div>
          </div>
        </div>
      )}
    </>
  );
}
