"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

type ZoomableQrProps = {
  value: string;
  label?: string;
  size?: number;
  className?: string;
};

export function ZoomableQr({ value, label, size = 116, className = "" }: ZoomableQrProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`group flex cursor-zoom-in flex-col items-center justify-center rounded-2xl border bg-white p-3 transition duration-200 hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md ${className}`}
        aria-label={`Увеличить QR-код ${label || value}`}
      >
        <QRCodeSVG value={value} size={size} />
        {label && <b className="mt-2 font-mono text-sm">{label}</b>}
        <span className="mt-1 text-[10px] font-medium text-blue-600 opacity-0 transition group-hover:opacity-100">Нажмите для увеличения</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[120] flex cursor-zoom-out items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setOpen(false)}
          role="presentation"
        >
          <div
            className="relative w-full max-w-xl cursor-default rounded-[28px] border border-white/40 bg-white p-6 shadow-2xl animate-in zoom-in-95 fade-in duration-200 sm:p-8"
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
              <div className="text-xs font-semibold uppercase tracking-[.16em] text-slate-400">QR-код ячейки</div>
              <div className="mt-1 font-mono text-lg font-bold text-slate-800">{label || value}</div>
            </div>
            <div className="flex items-center justify-center rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
              <QRCodeSVG value={value} size={320} className="h-auto w-full max-w-[320px]" />
            </div>
            <div className="mt-4 text-center text-xs text-slate-400">Нажмите вне окна или на крестик, чтобы закрыть</div>
          </div>
        </div>
      )}
    </>
  );
}
