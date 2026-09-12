"use client";

import { useEffect, useState } from "react";
import Barcode from "react-barcode";
import { X } from "lucide-react";

type ProductBarcodeProps = {
  value: string;
  compact?: boolean;
  className?: string;
};

export function ProductBarcode({ value, compact = false, className = "" }: ProductBarcodeProps) {
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
          className="fixed inset-0 z-[120] flex cursor-zoom-out items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setOpen(false)}
          role="presentation"
        >
          <div
            className="relative w-full max-w-3xl cursor-default rounded-[28px] border border-white/40 bg-white p-5 shadow-2xl animate-in zoom-in-95 fade-in duration-200 sm:p-8"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-600 transition hover:bg-slate-200"
              aria-label="Закрыть"
            >
              <X size={18} />
            </button>
            <div className="mb-5 pr-10">
              <div className="text-xs font-semibold uppercase tracking-[.16em] text-slate-400">Штрихкод материала</div>
              <div className="mt-1 font-mono text-sm font-bold text-slate-700">{safeValue}</div>
            </div>
            <div className="flex min-h-[220px] items-center justify-center overflow-x-auto rounded-2xl border border-slate-200 bg-white p-5 sm:min-h-[300px] sm:p-8">
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
            <div className="mt-4 text-center text-xs text-slate-400">Нажмите вне окна или на крестик, чтобы закрыть</div>
          </div>
        </div>
      )}
    </>
  );
}
