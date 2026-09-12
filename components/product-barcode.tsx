"use client";

import { useEffect, useRef, useState } from "react";
import Barcode from "react-barcode";
import { Printer, X } from "lucide-react";

type ProductBarcodeProps = {
  value: string;
  productName?: string;
  name?: string;
  compact?: boolean;
  className?: string;
};

function findNearbyProductName(button: HTMLButtonElement | null) {
  if (!button) return "";
  const article = button.closest("article");
  const articleName = article?.querySelector(".break-words.font-bold")?.textContent?.trim();
  if (articleName) return articleName;

  let node: HTMLElement | null = button.parentElement;
  for (let level = 0; node && level < 6; level += 1, node = node.parentElement) {
    const marked = node.querySelector<HTMLElement>("[data-product-name]")?.textContent?.trim();
    if (marked) return marked;
    const candidate = node.querySelector<HTMLElement>(".font-semibold")?.textContent?.trim();
    if (candidate && !candidate.startsWith("Штрихкод") && !candidate.startsWith("RL-код")) return candidate;
  }
  return "";
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char] || char));
}

function openBarcodePrintPreview(value: string, name: string, svgMarkup: string) {
  const printWindow = window.open("", "_blank", "width=1000,height=850");
  if (!printWindow) return;

  printWindow.document.open();
  printWindow.document.write(`<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<title>Штрихкод ${escapeHtml(value)}</title>
<style>
  @page { size: A4 portrait; margin: 14mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; color: #111827; background: #fff; }
  .toolbar { position: sticky; top: 0; display: flex; justify-content: center; gap: 10px; padding: 14px; background: #f8fafc; border-bottom: 1px solid #e5e7eb; }
  .toolbar button { border: 0; border-radius: 12px; padding: 11px 18px; font-size: 15px; font-weight: 700; cursor: pointer; }
  .print { background: #ff6b2c; color: white; }
  .close { background: #e5e7eb; color: #111827; }
  .sheet { width: 100%; min-height: calc(297mm - 28mm); display: flex; align-items: center; justify-content: center; }
  .label { width: 170mm; max-width: 100%; text-align: center; padding: 14mm 12mm; border: 1px solid #dbe3ee; border-radius: 6mm; }
  .kind { font-size: 13pt; letter-spacing: .18em; text-transform: uppercase; color: #64748b; font-weight: 700; }
  .name { margin-top: 5mm; font-size: 24pt; line-height: 1.15; font-weight: 800; }
  .code { margin-top: 4mm; font: 700 17pt ui-monospace, SFMono-Regular, Menlo, monospace; }
  .barcode { margin-top: 12mm; display: flex; justify-content: center; overflow: hidden; }
  .barcode svg { width: 145mm !important; max-width: 100% !important; height: auto !important; }
  @media print {
    .toolbar { display: none !important; }
    .sheet { min-height: auto; }
    .label { border: 0; }
  }
</style>
</head>
<body>
  <div class="toolbar">
    <button class="print" onclick="window.print()">Распечатать</button>
    <button class="close" onclick="window.close()">Закрыть</button>
  </div>
  <main class="sheet">
    <section class="label">
      <div class="kind">Штрихкод материала</div>
      ${name ? `<div class="name">${escapeHtml(name)}</div>` : ""}
      <div class="code">${escapeHtml(value)}</div>
      <div class="barcode">${svgMarkup}</div>
    </section>
  </main>
</body>
</html>`);
  printWindow.document.close();
  printWindow.focus();
}

export function ProductBarcode({ value, productName, name, compact = false, className = "" }: ProductBarcodeProps) {
  const safeValue = value.trim();
  const explicitName = productName?.trim() || name?.trim() || "";
  const [open, setOpen] = useState(false);
  const [resolvedName, setResolvedName] = useState(explicitName);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const largeBarcodeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setResolvedName(explicitName || findNearbyProductName(buttonRef.current));
  }, [explicitName]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!safeValue) return null;

  const shownName = explicitName || resolvedName;

  const printPreview = () => {
    const svg = largeBarcodeRef.current?.querySelector("svg");
    if (!svg) return;
    openBarcodePrintPreview(safeValue, shownName, svg.outerHTML);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          setResolvedName(explicitName || findNearbyProductName(buttonRef.current));
          setOpen(true);
        }}
        className={`group block w-full cursor-zoom-in overflow-hidden rounded-xl border border-black/10 bg-white px-3 py-2 text-left transition duration-200 hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md ${className}`}
        aria-label={`Увеличить штрихкод ${safeValue}`}
      >
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[.14em] text-slate-400">Штрихкод</span>
          <span className="text-[10px] font-medium text-blue-600 opacity-0 transition group-hover:opacity-100">Нажмите для увеличения</span>
        </div>
        {shownName && <div className="mb-1 truncate text-center text-xs font-semibold text-slate-700">{shownName}</div>}
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
              onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
              onClick={(event) => { event.preventDefault(); event.stopPropagation(); setOpen(false); }}
              className="absolute right-3 top-3 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-600 shadow-sm transition hover:bg-slate-200 active:scale-95"
              aria-label="Закрыть"
            >
              <X size={22} />
            </button>
            <div className="mb-5 pr-14">
              <div className="text-xs font-semibold uppercase tracking-[.16em] text-slate-400">Штрихкод материала</div>
              {shownName && <div className="mt-1 text-xl font-bold text-slate-900 sm:text-2xl">{shownName}</div>}
              <div className="mt-1 font-mono text-sm font-bold text-slate-700">{safeValue}</div>
            </div>
            <div ref={largeBarcodeRef} className="flex min-h-[220px] flex-col items-center justify-center gap-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-5 sm:min-h-[300px] sm:p-8">
              {shownName && <div className="max-w-full text-center text-lg font-bold text-slate-900 sm:text-2xl">{shownName}</div>}
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
            <div className="mt-5 flex justify-center">
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  printPreview();
                }}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-orange-500 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-orange-600 active:scale-[.98]"
              >
                <Printer size={18} /> Предпросмотр и печать
              </button>
            </div>
            <div className="mt-3 text-center text-xs text-slate-400">Закрыть — крестик справа сверху или Esc</div>
          </div>
        </div>
      )}
    </>
  );
}
