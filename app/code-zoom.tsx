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
  const explicit = svg.closest<HTMLElement>("[data-code-label]")?.dataset.codeLabel
    || svg.parentElement?.parentElement?.querySelector<HTMLElement>("[data-code-label]")?.dataset.codeLabel;
  if (explicit?.trim()) return explicit.trim();

  const cellCard = svg.closest<HTMLElement>(".cell-label");
  const cellCode = cellCard?.querySelector<HTMLElement>(".cell-code")?.textContent?.trim();
  if (cellCode) return cellCode;

  const nearbyCode = svg.parentElement?.parentElement?.querySelector<HTMLElement>(".font-mono")?.textContent?.trim();
  if (nearbyCode) return nearbyCode;

  const container = svg.parentElement;
  if (!container) return "QR-код";
  const text = container.textContent?.trim().replace(/\s+/g, " ") || "";
  return text.slice(0, 80) || "QR-код";
}

function openQrPrintPreview(preview: NonNullable<Preview>) {
  const printWindow = window.open("", "_blank", "width=1100,height=850");
  if (!printWindow) {
    window.alert("Браузер заблокировал окно печати. Разрешите всплывающие окна для сайта и попробуйте ещё раз.");
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
<title>QR ${safeLabel}</title>
<style>
  @page { size: A4 portrait; margin: 14mm; }
  * { box-sizing: border-box; }
  html, body {
    width: 100%;
    min-height: 100%;
    margin: 0;
    padding: 0;
    background: #fff;
    color: #111827;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .toolbar {
    position: sticky;
    top: 0;
    z-index: 20;
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 10px;
    padding: 14px;
    background: #f8fafc;
    border-bottom: 1px solid #e5e7eb;
  }
  .toolbar button {
    border: 0;
    border-radius: 12px;
    padding: 11px 18px;
    font-size: 15px;
    font-weight: 700;
    cursor: pointer;
  }
  .print { background: #ff6b2c; color: #fff; }
  .rotate { background: #2563eb; color: #fff; }
  .close { background: #e5e7eb; color: #111827; }
  .sheet {
    width: 100%;
    min-height: calc(297mm - 28mm);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 12mm;
    overflow: visible;
  }
  .label {
    width: 170mm;
    height: 68mm;
    max-width: 100%;
    display: flex;
    align-items: center;
    gap: 11mm;
    padding: 6mm 10mm;
    border: 1px solid #dbe3ee;
    border-radius: 6mm;
    background: #fff;
    overflow: hidden;
    transform-origin: center center;
    transition: transform .2s ease;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .qr {
    width: 55mm;
    height: 55mm;
    flex: 0 0 55mm;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .qr svg {
    width: 55mm !important;
    height: 55mm !important;
    display: block;
  }
  .meta {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  .kind {
    font-size: 13pt;
    letter-spacing: .18em;
    text-transform: uppercase;
    color: #64748b;
    font-weight: 700;
  }
  .code {
    margin-top: 4mm;
    font: 800 54pt/.96 ui-monospace, SFMono-Regular, Menlo, monospace;
    letter-spacing: -.035em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: #020617;
  }
  .brand {
    margin-top: 4mm;
    font-size: 13pt;
    color: #64748b;
    font-weight: 700;
    letter-spacing: .04em;
  }
  .angle { min-width: 54px; display: inline-block; text-align: left; }
  @media print {
    .toolbar { display: none !important; }
    .sheet { min-height: 100vh; padding: 0; overflow: visible; }
    .label { border: 0; }
  }
</style>
</head>
<body>
  <div class="toolbar">
    <button class="print" onclick="window.print()">Распечатать</button>
    <button id="rotateButton" class="rotate" onclick="rotateLabel()">↻ Повернуть 90° <span class="angle">0°</span></button>
    <button class="close" onclick="window.close()">Закрыть</button>
  </div>
  <main class="sheet">
    <section id="printLabel" class="label">
      <div class="qr">${preview.markup}</div>
      <div class="meta">
        <div class="kind">Ячейка</div>
        <div class="code">${safeLabel}</div>
        <div class="brand">РУССКИЙ ЛЕС · СКЛАД</div>
      </div>
    </section>
  </main>
<script>
  var labelAngle = 0;
  function rotateLabel() {
    labelAngle = (labelAngle + 90) % 360;
    var label = document.getElementById('printLabel');
    var angle = document.querySelector('#rotateButton .angle');
    if (label) label.style.transform = 'rotate(' + labelAngle + 'deg)';
    if (angle) angle.textContent = labelAngle + '°';
  }
</script>
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

    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreview(null);
    };
    window.addEventListener("keydown", onKey);

    return () => {
      document.body.style.overflow = oldOverflow;
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
      <div className="relative w-full max-w-3xl rounded-[30px] border border-white/40 bg-white p-6 shadow-2xl animate-in zoom-in-90 fade-in duration-200 sm:p-8" style={{ pointerEvents: "auto" }}>
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
          <div className="text-xs font-semibold uppercase tracking-[.16em] text-slate-400">QR-код ячейки</div>
          <div className="mt-1 text-sm text-slate-500">Горизонтальная складская этикетка</div>
        </div>

        <div className="flex flex-col items-center gap-6 rounded-2xl border border-slate-200 bg-white p-5 sm:flex-row sm:p-8">
          <div
            className="w-full max-w-[280px] shrink-0 [&_svg]:h-auto [&_svg]:w-full"
            dangerouslySetInnerHTML={{ __html: preview.markup }}
          />
          <div className="min-w-0 flex-1 text-center sm:text-left">
            <div className="text-xs font-bold uppercase tracking-[.18em] text-slate-400">Ячейка</div>
            <div className="mt-2 break-words font-mono text-5xl font-black tracking-[-0.045em] text-slate-950 sm:text-6xl">{preview.label}</div>
            <div className="mt-4 text-xs font-semibold tracking-wide text-slate-400">РУССКИЙ ЛЕС · СКЛАД</div>
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              const currentPreview = preview;
              setPreview(null);
              window.setTimeout(() => openQrPrintPreview(currentPreview), 80);
            }}
            className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-orange-500 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-orange-600 active:scale-[.98]"
            style={{ pointerEvents: "auto" }}
          >
            <Printer size={18} pointerEvents="none" /> Предпросмотр и печать
          </button>
        </div>
        <div className="mt-3 text-center text-xs text-slate-400">В окне печати можно повернуть всю QR-этикетку на 90° перед печатью</div>
      </div>
    </div>
  );
}
