"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, ScanLine, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScan: (value: string) => void;
};

type ScannerControls = { stop: () => void };

export function CameraCodeScanner({ open, onOpenChange, onScan }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<ScannerControls | null>(null);
  const handledRef = useRef(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      controlsRef.current?.stop();
      controlsRef.current = null;
      handledRef.current = false;
      setError("");
      return;
    }

    let cancelled = false;

    const start = async () => {
      const video = videoRef.current;
      if (!video) return;

      setStarting(true);
      setError("");
      handledRef.current = false;

      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        if (cancelled) return;

        const reader = new BrowserMultiFormatReader();
        const controls = await reader.decodeFromConstraints(
          {
            audio: false,
            video: {
              facingMode: { ideal: "environment" },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
          },
          video,
          (result) => {
            if (!result || handledRef.current) return;
            const text = result.getText().trim();
            if (!text) return;
            handledRef.current = true;
            controlsRef.current?.stop();
            controlsRef.current = null;
            onScan(text);
            onOpenChange(false);
          },
        );

        if (cancelled) {
          controls.stop();
          return;
        }

        controlsRef.current = controls;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "Не удалось открыть камеру";
        if (/permission|notallowed/i.test(message)) {
          setError("Нет доступа к камере. Разрешите камеру для этого сайта в настройках Safari и откройте сканер снова.");
        } else if (/notfound|device/i.test(message)) {
          setError("Камера не найдена на этом устройстве.");
        } else {
          setError(`Не удалось запустить камеру: ${message}`);
        }
      } finally {
        if (!cancelled) setStarting(false);
      }
    };

    const timer = window.setTimeout(() => void start(), 30);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, [open, onOpenChange, onScan]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-950/65 p-3 backdrop-blur-sm">
      <div className="w-full max-w-xl overflow-hidden rounded-[28px] bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-black/10 p-5 sm:p-6">
          <div>
            <div className="flex items-center gap-2 text-xl font-bold sm:text-2xl"><ScanLine /> Сканирование камерой</div>
            <p className="mt-2 text-sm leading-6 text-slate-500">Наведите заднюю камеру на QR-код ячейки или штрихкод материала. Распознавание произойдёт автоматически.</p>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 active:scale-95"
            aria-label="Закрыть сканер"
          >
            <X size={22} />
          </button>
        </div>

        <div className="p-4 sm:p-6">
          <div className="relative overflow-hidden rounded-[24px] bg-black aspect-[3/4] sm:aspect-video">
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="h-full w-full object-cover"
            />

            <div className="pointer-events-none absolute inset-[12%] rounded-[28px] border-2 border-white/90 shadow-[0_0_0_999px_rgba(0,0,0,.14)]" />
            <div className="pointer-events-none absolute left-1/2 top-1/2 h-px w-[58%] -translate-x-1/2 bg-red-400/80 shadow-[0_0_12px_rgba(248,113,113,.9)]" />

            {starting && <div className="absolute inset-0 flex items-center justify-center bg-black/45 text-white"><div className="flex items-center gap-2 rounded-full bg-black/40 px-4 py-2 text-sm"><Loader2 className="animate-spin" size={18} /> Запускаю камеру…</div></div>}

            {error && <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-6 text-center text-white"><div><Camera className="mx-auto mb-3" size={32} /><p className="text-sm leading-6">{error}</p></div></div>}
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 text-xs text-slate-500">
            <span>Поддерживаются QR и Code128</span>
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>Закрыть</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
