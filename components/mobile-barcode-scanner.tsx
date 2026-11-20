"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Keyboard, Loader2, RefreshCw, ScanLine, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Props = {
  label: string;
  onDetected: (value: string) => void;
  disabled?: boolean;
  className?: string;
  acceptedValues?: string[];
};

type ScannerControls = { stop: () => void };

export function MobileBarcodeScanner({ label, onDetected, disabled, className, acceptedValues }: Props) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [starting, setStarting] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const controlsRef = useRef<ScannerControls | null>(null);
  const foundRef = useRef(false);
  const startIdRef = useRef(0);
  const hardwareInputRef = useRef<HTMLInputElement>(null);
  const hardwareBufferRef = useRef("");
  const hardwareTimerRef = useRef<number | null>(null);

  const stop = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    const video = videoRef.current;
    if (video) {
      video.pause();
      video.srcObject = null;
    }

    foundRef.current = false;
  }, []);

  const close = useCallback(() => {
    stop();
    setOpen(false);
  }, [stop]);

  useEffect(() => () => stop(), [stop]);

  const acceptValue = useCallback((raw: string) => {
    if (foundRef.current) return false;
    const value = raw.trim();
    if (!value) return false;

    const normalized = value.toUpperCase();
    const allowed = (acceptedValues || [])
      .map((item) => String(item || "").trim().toUpperCase())
      .filter(Boolean);
    if (allowed.length && !allowed.includes(normalized)) return false;

    foundRef.current = true;
    if (navigator.vibrate) navigator.vibrate(70);
    onDetected(value);
    setStatus(`Считано: ${value}`);
    window.setTimeout(() => close(), 180);
    return true;
  }, [acceptedValues, close, onDetected]);

  useEffect(() => {
    if (!open) return;

    const focusHardwareInput = () => {
      const input = hardwareInputRef.current;
      if (!input) return;
      input.focus({ preventScroll: true });
      input.select();
    };

    hardwareBufferRef.current = "";
    const focusTimer = window.setTimeout(focusHardwareInput, 80);
    const flush = () => {
      const value = hardwareBufferRef.current.trim();
      hardwareBufferRef.current = "";
      if (hardwareTimerRef.current !== null) {
        window.clearTimeout(hardwareTimerRef.current);
        hardwareTimerRef.current = null;
      }
      if (value.length >= 2) acceptValue(value);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "Enter" || event.key === "Tab") {
        if (hardwareBufferRef.current) {
          event.preventDefault();
          flush();
        }
        return;
      }
      if (event.key.length !== 1) return;

      hardwareBufferRef.current += event.key;
      if (hardwareTimerRef.current !== null) window.clearTimeout(hardwareTimerRef.current);
      hardwareTimerRef.current = window.setTimeout(flush, 120);
    };

    const keepFocused = () => window.setTimeout(focusHardwareInput, 30);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointerup", keepFocused, true);
    window.addEventListener("focus", focusHardwareInput);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointerup", keepFocused, true);
      window.removeEventListener("focus", focusHardwareInput);
      if (hardwareTimerRef.current !== null) window.clearTimeout(hardwareTimerRef.current);
      hardwareTimerRef.current = null;
      hardwareBufferRef.current = "";
    };
  }, [acceptValue, open]);

  useEffect(() => {
    if (!open) {
      stop();
      setStatus("");
      return;
    }

    let cancelled = false;
    const startId = ++startIdRef.current;

    const start = async () => {
      const video = videoRef.current;
      if (!video) return;

      stop();
      setStarting(true);
      setStatus("");
      foundRef.current = false;

      try {
        if (!window.isSecureContext) {
          throw new Error("Камера браузера доступна только через HTTPS");
        }
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Браузер не предоставляет доступ к камере");
        }

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
          // На части версий iOS видео уже играет после назначения srcObject.
        }

        if (cancelled || startId !== startIdRef.current) return;

        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        const reader = new BrowserMultiFormatReader();
        const controls = await reader.decodeFromStream(stream, video, (result) => {
          if (!result) return;
          acceptValue(result.getText());
        });

        if (cancelled || startId !== startIdRef.current) {
          controls.stop();
          return;
        }

        controlsRef.current = controls;
      } catch (error) {
        stop();
        const name = error instanceof DOMException ? error.name : "";
        const message = error instanceof Error ? error.message : "Не удалось открыть камеру";

        if (name === "NotAllowedError" || /permission|notallowed|denied/i.test(message)) {
          const ios = /iPad|iPhone|iPod/i.test(navigator.userAgent);
          const android = /Android/i.test(navigator.userAgent);
          setStatus(ios
            ? "Доступ к камере запрещён. На iPhone откройте настройки сайта Safari, разрешите «Камера» и нажмите «Повторить». Аппаратный сканер ТСД можно использовать без камеры."
            : android
              ? "Доступ к камере запрещён. Разрешите камеру для браузера/этого сайта в Android и нажмите «Повторить». На ТСД можно просто нажать аппаратную кнопку сканирования — камера не требуется."
              : "Доступ к камере запрещён. Разрешите камеру для этого сайта и нажмите «Повторить». Если используется ТСД, аппаратный сканер работает без камеры.");
        } else if (name === "NotFoundError" || /notfound|device.*not found/i.test(message)) {
          setStatus("Камера на устройстве не найдена.");
        } else if (name === "NotReadableError" || /notreadable|could not start/i.test(message)) {
          setStatus("Камера уже используется другим приложением. Закройте камеру/Telegram и нажмите «Повторить».");
        } else {
          setStatus(message);
        }
      } finally {
        if (!cancelled && startId === startIdRef.current) setStarting(false);
      }
    };

    const timer = window.setTimeout(() => void start(), 80);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      stop();
    };
  }, [acceptValue, attempt, open, stop]);

  return <>
    <Button type="button" variant="outline" disabled={disabled} onClick={() => setOpen(true)} className={className}>
      <Camera /> {label}
    </Button>
    <Dialog open={open} onOpenChange={(value) => value ? setOpen(true) : close()}>
      <DialogContent className="w-[calc(100vw-24px)] max-w-lg overflow-hidden p-0">
        <DialogHeader className="px-4 pt-4 sm:px-5 sm:pt-5">
          <DialogTitle className="flex items-center gap-2"><ScanLine size={20} /> Сканирование кода</DialogTitle>
          <DialogDescription>Просто отсканируйте код. ТСД считывает аппаратной кнопкой, телефон — задней камерой. Код принимается автоматически.</DialogDescription>
        </DialogHeader>
        <input
          ref={hardwareInputRef}
          aria-label="Ввод аппаратного сканера"
          inputMode="none"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          className="absolute left-[-9999px] top-[-9999px] h-px w-px opacity-0"
          onInput={(event) => {
            const input = event.currentTarget;
            const value = input.value;
            input.value = "";
            if (!value) return;
            hardwareBufferRef.current += value;
            if (hardwareTimerRef.current !== null) window.clearTimeout(hardwareTimerRef.current);
            hardwareTimerRef.current = window.setTimeout(() => {
              const scanned = hardwareBufferRef.current.trim();
              hardwareBufferRef.current = "";
              if (scanned.length >= 2) acceptValue(scanned);
            }, 90);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === "Tab") {
              event.preventDefault();
              const scanned = hardwareBufferRef.current.trim();
              hardwareBufferRef.current = "";
              if (scanned.length >= 2) acceptValue(scanned);
            }
          }}
        />
        <div className="relative mx-3 mb-3 overflow-hidden rounded-2xl bg-black sm:mx-5 sm:mb-5">
          <video ref={videoRef} autoPlay playsInline muted disablePictureInPicture className="aspect-[3/4] w-full object-cover sm:aspect-[4/3]" />
          {!status && <>
            <div className="pointer-events-none absolute inset-[18%_10%] rounded-2xl border-2 border-white/90 shadow-[0_0_0_999px_rgba(0,0,0,.28)]" />
            <div className="pointer-events-none absolute left-1/2 top-1/2 h-px w-[58%] -translate-x-1/2 bg-red-400/80 shadow-[0_0_12px_rgba(248,113,113,.9)]" />
          </>}
          {starting && <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white"><div className="flex items-center gap-2 rounded-full bg-black/50 px-4 py-2 text-sm"><Loader2 className="animate-spin" size={18} /> Запускаю камеру…</div></div>}
          {!status && <div className="pointer-events-none absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full bg-black/60 px-3 py-1.5 text-[11px] font-semibold text-white"><Keyboard size={14}/> ТСД: нажмите кнопку сканирования</div>}
          {status && <div className="absolute inset-0 flex items-center justify-center bg-black/85 p-6 text-center text-white"><div className="max-w-sm"><p className="text-sm leading-6">{status}</p><Button type="button" variant="secondary" className="mt-4" onClick={() => setAttempt((value) => value + 1)}><RefreshCw size={16} /> Повторить</Button></div></div>}
          <button type="button" onClick={close} className="absolute right-3 top-3 z-20 rounded-full bg-black/60 p-2 text-white"><X size={18} /></button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
