"use client";

import { useEffect, useState } from "react";
import { Printer, X } from "lucide-react";

type Preview = { markup: string; label: string } | null;

function findLargeSquareSvg(target: EventTarget | null) {
  if (!(target instanceof Element)) return null;
  const svg = target.closest("svg");
  if (!(svg instanceof SVGSVGElement)) return null;

  const rect = svg.getBoundingClientRect();
  if (rect.width < 80 || rect.height < 80) return null;
  if (Math.abs(rect.width - rect.height) > Math.max(rect.width, rect.height) * 0.12) return null;
  return svg;
}

function nearbyLabel(svg: SVGSVGElement) {
  const container = svg.parentElement;
  if (!container) return "QR-код";
  const text = container.textContent?.trim().replace(/\s+/g, " ") || "";
  return text.slice(0, 80) || "QR-код";
}

function openQrPrintPreview(preview: NonNullable<Preview>) {
  const printWindow = window.open("", "_blank", "width=900,height=900");
  if (!printWindow) {
    window.alert("Браузер заблокировал окно предпросмотра. Разрешите всплывающие окна для localhost и попробуйте ещё раз.");
    return;
  }

  const safeLabel = preview.label.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char] || char));

  printWindow.document.open();
  printWindow.document.write(`<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<title>QR-код ${safeLabel}</title>
<style>
  @page { size: A4 portrait; margin: 14mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; color: #111827; background: #fff; }
  .toolbar { position: sticky; top: 0; display: flex; justify-content: center; gap: 10px; padding: 14px; background: #f8fafc; border-bottom: 1px solid #e5e7eb; }
  .toolbar button { border: 0; border-radius: 12px; padding: 11px 18px; font-size: 15px; font-weight: 700; cursor: pointer; }
  .print { background: #ff6b2c; color: white; }
  .close { background: #e5e7eb; color: #111827; }
  .sheet { width: 100%; min-height: calc(297mm - 28mm); display: flex; align-items: center; justify-content: center; }
  .label { width: 150mm; max-width: 100%; text-align: center; padding: 12mm; border: 1px solid #dbe3ee; border-radius: 6mm; }
  .kind { font-size: 13pt; letter-spacing: .18em; text-transform: uppercase; color: #64748b; font-weight: 700; }
  .code { margin-top: 4mm; font: 700 18pt ui-monospace, SFMono-Regular, Menlo, monospace; }
  .qr { margin: 10mm auto 0; width: 105mm; height: 105mm; max-width: 100%; }
  .qr svg { width: 100% !important; height: 100% !important; display: block; }
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
      <div class="kind">QR-код ячейки</div>
      <div class="code">${safeLabel}</div>
      <div class="qr">${preview.markup}</div>
    </section>
  </main>
</body>
</html>`);
  printWindow.document.close();
  printWindow.focus();
}

export function CodeZoom() {
  const [preview, setPreview] = useState<Preview>(null);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target;

      if (target instanceof Element && target.closest("[data-code-zoom-close]")) {
        event.preventDefault();
        event.stopPropagation();
        setPreview(null);
        return;
      }

      if (preview) return;
      const svg = findLargeSquareSvg(target);
      if (!svg) return;
      event.preventDefault();
      event.stopPropagation();
      setPreview({ markup: svg.outerHTML, label: nearbyLabel(svg) });
    };

    const onPointerOver = (event: PointerEvent) => {
      if (preview) return;
      const svg = findLargeSquareSvg(event.target);
      if (svg) svg.style.cursor = "zoom-in";
    };

    document.addEventListener("click", onClick, true);
    document.addEventListener("pointerover", onPointerOver, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("pointerover", onPointerOver, true);
    };
  }, [preview]);

  useEffect(() => {
    if (!preview) return;

    // Radix Dialog во время открытого модального окна ставит body { pointer-events: none }.
    // CodeZoom рендерится выше диалога, поэтому визуально виден, но без этого фикса
    // кнопки крестика и печати могут вообще не получать клики.
    const oldOverflow = document.body.style.overflow;
    const oldPointerEvents = document.body.style.pointerEvents;
    document.body.style.overflow = "hidden";
    document.body.style.pointerEvents = "auto";

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreview(null);
    };
    window.addEventListener("keydown", onKey);

    return () => {
      document.body.style.overflow = oldOverflow;
      document.body.style.pointerEvents = oldPointerEvents;
      window.removeEventListener("keydown", onKey);
    };
  }, [preview]);

  if (!preview) return null;

  return (
    <div
      data-code-zoom-root
      className="no-print fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-md animate-in fade-in duration-200"
      style={{ pointerEvents: "auto" }}
      role="dialog"
      aria-modal="true"
      aria-label={`QR-код ${preview.label}`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="relative w-full max-w-xl rounded-[30px] border border-white/40 bg-white p-6 shadow-2xl animate-in zoom-in-90 fade-in duration-200 sm:p-8" style={{ pointerEvents: "auto" }}>
        <button
          type="button"
          data-code-zoom-close
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setPreview(null);
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setPreview(null);
          }}
          className="absolute right-3 top-3 z-[10010] flex h-12 w-12 cursor-pointer items-center justify-center rounded-full bg-slate-100 text-slate-700 shadow-sm transition hover:bg-slate-200 active:scale-95"
          style={{ pointerEvents: "auto" }}
          aria-label="Закрыть QR-код"
        >
          <X size={24} pointerEvents="none" />
        </button>
        <div className="mb-5 pr-14">
          <div className="text-xs font-semibold uppercase tracking-[.16em] text-slate-400">QR-код</div>
          <div className="mt-1 truncate font-mono text-sm font-bold text-slate-800">{preview.label}</div>
        </div>
        <div className="flex items-center justify-center rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
          <div
            className="w-full max-w-[360px] [&_svg]:h-auto [&_svg]:w-full"
            dangerouslySetInnerHTML={{ __html: preview.markup }}
          />
        </div>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              openQrPrintPreview(preview);
            }}
            className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-orange-500 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-orange-600 active:scale-[.98]"
            style={{ pointerEvents: "auto" }}
          >
            <Printer size={18} pointerEvents="none" /> Предпросмотр и печать
          </button>
        </div>
        <div className="mt-3 text-center text-xs text-slate-400">Закрыть — крестик справа сверху или Esc</div>
      </div>
    </div>
  );
}
