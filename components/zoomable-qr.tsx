"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Printer, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

type ZoomableQrProps = {
  value: string;
  label?: string;
  size?: number;
  className?: string;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] || char));
}

function openQrPrintPreview(value: string, label: string, svgMarkup: string) {
  const printWindow = window.open("", "_blank", "width=1000,height=850");
  if (!printWindow) {
    window.alert("Браузер заблокировал окно предпросмотра. Разрешите всплывающие окна для сайта и попробуйте ещё раз.");
    return;
  }
  printWindow.document.open();
  printWindow.document.write(`<!doctype html><html lang="ru"><head><meta charset="utf-8"/><title>QR ячейки ${escapeHtml(label)}</title><style>
  @page{size:A4 portrait;margin:14mm}*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;color:#0f172a;background:white}.toolbar{position:sticky;top:0;z-index:20;display:flex;justify-content:center;gap:10px;padding:14px;background:#f8fafc;border-bottom:1px solid #e2e8f0}.toolbar button{border:0;border-radius:12px;padding:11px 18px;font-weight:800;cursor:pointer}.print{background:#ff6b2c;color:#fff}.rotate{background:#2563eb;color:#fff}.close{background:#e2e8f0}.sheet{min-height:calc(297mm - 28mm);display:flex;align-items:center;justify-content:center;padding:12mm}.label{width:170mm;max-width:100%;display:flex;align-items:center;justify-content:center;gap:12mm;padding:12mm;border:1px solid #dbe3ee;border-radius:6mm;transform-origin:center;transition:transform .2s}.qr svg{width:72mm!important;height:72mm!important;display:block}.kind{font-size:11pt;letter-spacing:.16em;text-transform:uppercase;color:#64748b;font-weight:800}.code{margin-top:5mm;font:900 34pt ui-monospace,SFMono-Regular,Menlo,monospace}.brand{margin-top:6mm;font-size:10pt;color:#94a3b8;font-weight:800}.angle{min-width:48px;display:inline-block}@media print{.toolbar{display:none!important}.sheet{min-height:100vh;padding:0}.label{border:0}}
  </style></head><body><div class="toolbar"><button class="print" onclick="window.print()">Распечатать</button><button id="rotateButton" class="rotate" onclick="rotateLabel()">↻ Повернуть 90° <span class="angle">0°</span></button><button class="close" onclick="window.close()">Закрыть</button></div><main class="sheet"><section id="printLabel" class="label"><div class="qr">${svgMarkup}</div><div><div class="kind">QR-код ячейки</div><div class="code">${escapeHtml(label)}</div><div class="brand">РУССКИЙ ЛЕС · СКЛАД</div></div></section></main><script>var labelAngle=0;function rotateLabel(){labelAngle=(labelAngle+90)%360;document.getElementById('printLabel').style.transform='rotate('+labelAngle+'deg)';document.querySelector('#rotateButton .angle').textContent=labelAngle+'°';}</script></body></html>`);
  printWindow.document.close();
  printWindow.focus();
}

export function ZoomableQr({ value, label, size = 116, className = "" }: ZoomableQrProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const largeRef = useRef<HTMLDivElement>(null);
  const shownLabel = (label || value).trim();

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = oldOverflow; window.removeEventListener("keydown", onKey); };
  }, [open]);

  const printPreview = () => {
    const svg = largeRef.current?.querySelector("svg");
    if (svg) openQrPrintPreview(value, shownLabel, svg.outerHTML);
  };

  return <>
    <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(true); }} className={`group flex cursor-zoom-in flex-col items-center justify-center rounded-2xl border bg-white p-3 transition duration-200 hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-md ${className}`} aria-label={`Открыть QR-код ${shownLabel}`}>
      <QRCodeSVG value={value} size={size}/>
      {shownLabel && <b className="mt-2 font-mono text-sm">{shownLabel}</b>}
      <span className="mt-1 text-[10px] font-semibold text-sky-600 opacity-0 transition group-hover:opacity-100">Нажмите для печати</span>
    </button>

    {mounted && open && createPortal(<div className="fixed inset-0 z-[90000] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" onPointerDown={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) setOpen(false); }} onClick={(e) => e.stopPropagation()}>
      <div className="relative w-full max-w-3xl rounded-[28px] bg-white p-6 shadow-2xl sm:p-8" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={() => setOpen(false)} className="absolute right-3 top-3 z-[90010] flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200" aria-label="Закрыть"><X size={22}/></button>
        <div className="mb-5 pr-14"><div className="text-xs font-black uppercase tracking-[.16em] text-slate-400">QR-код ячейки</div><div className="mt-1 font-mono text-2xl font-black text-slate-900">{shownLabel}</div><div className="mt-1 text-sm text-slate-500">Горизонтальная складская этикетка</div></div>
        <div ref={largeRef} className="flex min-h-[330px] items-center justify-center gap-8 rounded-2xl border bg-white p-7 sm:flex-row"><QRCodeSVG value={value} size={280} className="h-auto w-full max-w-[280px]"/><div className="hidden sm:block"><div className="text-xs font-black uppercase tracking-[.18em] text-slate-400">Ячейка</div><div className="mt-2 font-mono text-5xl font-black">{shownLabel}</div><div className="mt-5 text-xs font-bold text-slate-400">РУССКИЙ ЛЕС · СКЛАД</div></div></div>
        <div className="mt-5 flex justify-center"><button type="button" onClick={printPreview} className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-5 py-3 font-black text-white hover:bg-orange-600"><Printer size={18}/> Предпросмотр и печать</button></div>
        <div className="mt-3 text-center text-xs text-slate-400">В окне печати этикетку можно повернуть на 90°</div>
      </div>
    </div>, document.body)}
  </>;
}
