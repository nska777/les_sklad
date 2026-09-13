"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Loader2, RefreshCw, ScanLine, X } from "lucide-react";
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
  const streamRef = useRef<MediaStream | null>(null);
  const handledRef = useRef(false);
  const startIdRef = useRef(0);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  const stopCamera = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    const video = videoRef.current;
    if (video) {
      video.pause();
      video.srcObject = null;
    }
  }, []);

  const closeScanner = useCallback(() => {
    stopCamera();
    handledRef.current = false;
    onOpenChange(false);
  }, [onOpenChange, stopCamera]);

  useEffect(() => {
    if (!open) {
      stopCamera();
      handledRef.current = false;
      setError("");
      return;
    }

    let cancelled = false;
    const startId = ++startIdRef.current;

    const start = async () => {
      const video = videoRef.current;
      if (!video) return;

      stopCamera();
      setStarting(true);
      setError("");
      handledRef.current = false;

      try {
        if (!window.isSecureContext) {
          throw new Error("Камера браузера доступна только через HTTPS");
        }
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Браузер не предоставляет доступ к камере");
        }

        // На iPhone Safari надёжнее сначала получить MediaStream самостоятельно,
        // явно назначить его video, запустить play(), а уже потом подключать ZXing.
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30, max: 60 },
          },
        });

        if (cancelled || startId !== startIdRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        video.setAttribute("playsinline", "true");
        video.setAttribute("webkit-playsinline", "true");
        video.muted = true;
        video.srcObject = stream;

        await new Promise<void>((resolve) => {
          if (video.readyState >= 2) return resolve();
          const done = () => {
            video.removeEventListener("loadedmetadata", done);
            resolve();
          };
          video.addEventListener("loadedmetadata", done, { once: true });
          window.setTimeout(done, 1500);
        });

        try {
          await video.play();
        } catch {
          // На части версий iOS поток уже воспроизводится после назначения srcObject.
        }

        if (cancelled || startId !== startIdRef.current) return;

        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        if (cancelled || startId !== startIdRef.current) return;

        const reader = new BrowserMultiFormatReader();
        const controls = await reader.decodeFromStream(stream, video, (result) => {
          if (!result || handledRef.current) return;
          const text = result.getText().trim();
          if (!text) return;

          handledRef.current = true;
          stopCamera();

          if (navigator.vibrate) navigator.vibrate(70);
          onScan(text);
          onOpenChange(false);
        });

        if (cancelled || startId !== startIdRef.current) {
          controls.stop();
          return;
        }

        controlsRef.current = controls;
      } catch (cause) {
        stopCamera();
        const name = cause instanceof DOMException ? cause.name : "";
        const message = cause instanceof Error ? cause.message : "Не удалось открыть камеру";

        if (name === "NotAllowedError" || /permission|notallowed|denied/i.test(message)) {
          setError("Доступ к камере запрещён. На iPhone: Настройки → Safari → Камера → Разрешить, затем откройте сканер снова.");
        } else if (name === "NotFoundError" || /notfound|device.*not found/i.test(message)) {
          setError("Камера на устройстве не найдена.");
        } else if (name === "NotReadableError" || /notreadable|could not start/i.test(message)) {
          setError("Камера уже используется другим приложением. Закройте камеру/Telegram и нажмите «Повторить».");
        } else {
          setError(message);
        }
      } finally {
        if (!cancelled && startId === startIdRef.current) setStarting(false);
      }
    };

    const timer = window.setTimeout(() => void start(), 80);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      stopCamera();
    };
  }, [open, attempt, onOpenChange, onScan, stopCamera]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-950/65 p-3 backdrop-blur-sm">
      <div className="w-full max-w-xl overflow-hidden rounded-[28px] bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-black/10 p-5 sm:p-6">
          <div>
            <div className="flex items-center gap-2 text-xl font-bold sm:text-2xl"><ScanLine /> Сканирование камерой</div>
            <p className="mt-2 text-sm leading-6 text-slate-500">Наведите заднюю камеру на QR ячейки или Code128 материала. Код распознается автоматически.</p>
          </div>
          <button
            type="button"
            onClick={closeScanner}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 active:scale-95"
            aria-label="Закрыть сканер"
          >
            <X size={22} />
          </button>
        </div>

        <div className="p-4 sm:p-6">
          <div className="relative aspect-[3/4] overflow-hidden rounded-[24px] bg-black sm:aspect-video">
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              disablePictureInPicture
              className="h-full w-full object-cover"
            />

            {!error && <>
              <div className="pointer-events-none absolute inset-[12%] rounded-[28px] border-2 border-white/90 shadow-[0_0_0_999px_rgba(0,0,0,.14)]" />
              <div className="pointer-events-none absolute left-1/2 top-1/2 h-px w-[58%] -translate-x-1/2 bg-red-400/80 shadow-[0_0_12px_rgba(248,113,113,.9)]" />
            </>}

            {starting && <div className="absolute inset-0 flex items-center justify-center bg-black/45 text-white"><div className="flex items-center gap-2 rounded-full bg-black/40 px-4 py-2 text-sm"><Loader2 className="animate-spin" size={18} /> Запускаю заднюю камеру…</div></div>}

            {error && <div className="absolute inset-0 flex items-center justify-center bg-black/85 p-6 text-center text-white"><div className="max-w-sm"><Camera className="mx-auto mb-3" size={34} /><p className="text-sm leading-6">{error}</p><Button type="button" variant="secondary" className="mt-4" onClick={() => setAttempt((value) => value + 1)}><RefreshCw size={16} /> Повторить</Button></div></div>}
          </div>

          <div className="mt-4 flex flex-col gap-2 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
            <span>Поддерживаются QR-коды и Code128 · задняя камера</span>
            <Button type="button" variant="outline" size="sm" onClick={closeScanner}>Закрыть</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
