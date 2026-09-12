"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

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

export function CodeZoom() {
  const [preview, setPreview] = useState<Preview>(null);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (preview) return;
      const svg = findLargeSquareSvg(event.target);
      if (!svg) return;
      event.preventDefault();
      event.stopPropagation();
      setPreview({ markup: svg.outerHTML, label: nearbyLabel(svg) });
    };

    const onPointerOver = (event: PointerEvent) => {
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
      className="no-print fixed inset-0 z-[130] flex cursor-zoom-out items-center justify-center bg-slate-950/60 p-4 backdrop-blur-md animate-in fade-in duration-200"
      onClick={() => setPreview(null)}
      role="presentation"
    >
      <div className="relative w-full max-w-xl rounded-[30px] border border-white/40 bg-white p-6 shadow-2xl animate-in zoom-in-90 fade-in duration-200 sm:p-8">
        <button
          type="button"
          onClick={() => setPreview(null)}
          className="absolute right-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-600 transition hover:bg-slate-200"
          aria-label="Закрыть"
        >
          <X size={20} />
        </button>
        <div className="mb-5 pr-12">
          <div className="text-xs font-semibold uppercase tracking-[.16em] text-slate-400">QR-код</div>
          <div className="mt-1 truncate font-mono text-sm font-bold text-slate-800">{preview.label}</div>
        </div>
        <div className="flex items-center justify-center rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
          <div
            className="w-full max-w-[360px] [&_svg]:h-auto [&_svg]:w-full"
            dangerouslySetInnerHTML={{ __html: preview.markup }}
          />
        </div>
        <div className="mt-4 text-center text-xs text-slate-400">Нажмите ещё раз в любом месте, чтобы закрыть</div>
      </div>
    </div>
  );
}
