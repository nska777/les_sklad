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

type LegacyNavigator = Navigator & {
  getUserMedia?: (
    constraints: MediaStreamConstraints,
    success: (stream: MediaStream) => void,
    error: (error: DOMException) => void,
  ) => void;
  webkitGetUserMedia?: (
    constraints: MediaStreamConstraints,
    success: (stream: MediaStream) => void,
    error: (error: DOMException) => void,
  ) => void;
};

async function openCameraStream(): Promise<MediaStream> {
  if (!window.isSecureContext) throw new Error("Камера браузера доступна только через HTTPS");

  if (navigator.mediaDevices?.getUserMedia) {
    const attempts: MediaStreamConstraints[] = [
      { audio: false, video: { facingMode: { exact: "environment" } } },
      { audio: false, video: { facingMode: { ideal: "environment" } } },
      { audio: false, video: true },
    ];

    let lastError: unknown = null;
    for (const constraints of attempts) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints);
      } catch (error) {
        lastError = error;
        const name = error instanceof DOMException ? error.name : "";
        if (name === "NotAllowedError" || name === "SecurityError") throw error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Не удалось открыть камеру");
  }

  const legacy = navigator as LegacyNavigator;
  const getLegacy = legacy.getUserMedia || legacy.webkitGetUserMedia;
  if (!getLegacy) throw new Error("Этот браузер не поддерживает доступ к камере");

  return await new Promise<MediaStream>((resolve, reject) => {
    getLegacy.call(legacy, { audio: false, video: true }, resolve, reject);
  });
}

export function MobileBarcodeScanner({ label, onDetected, disabled, className, acceptedValues }: Props) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [starting, setStarting] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const controlsRef = useRef<ScannerControls | null>(null);
  const foundRef = useRef(false);
  const startSeqRef = useRef(0);
  const hardwareBufferRef = useRef("");
  const hardwareTimerRef = useRef<number | null>(null);
  const hiddenInputRef = useRef<HTMLInputElement>(null);

  const stop = useCallback(() => {
    startSeqRef.current += 1;
    controlsRef.current?.stop();
    controlsRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    const video = videoRef.current;
    if (video) {
      try { video.pause(); } catch {}
      video.srcObject = null;
    }
  }, []);

  const close = useCallback(() => {
    stop();
    foundRef.current = false;
    setOpen(false);
    setStatus("");
  }, [stop]);

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

    hardwareBufferRef.current = "";
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

    const focusTimer = window.setTimeout(() => hiddenInputRef.current?.focus({ preventScroll: true }), 50);
    window.addEventListener("keydown", onKeyDown, true);

    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", onKeyDown, true);
      if (hardwareTimerRef.current !== null) window.clearTimeout(hardwareTimerRef.current);
      hardwareTimerRef.current = null;
      hardwareBufferRef.current = "";
    };
  }, [acceptValue, open]);

  const startCamera = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;

    const seq = ++startSeqRef.current;
    controlsRef.current?.stop();
    controlsRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    foundRef.current = false;
    setStatus("");
    setStarting(true);

    try {
      const stream = await openCameraStream();
      if (seq !== startSeqRef.current) {
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
        const done = () => resolve();
        video.addEventListener("loadedmetadata", done, { once: true });
        window.setTimeout(done, 1800);
      });

      try { await video.play(); } catch {}

      if (seq !== startSeqRef.current) return;

      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      const reader = new BrowserMultiFormatReader();
      const controls = await reader.decodeFromStream(stream, video, (result) => {
        if (result) acceptValue(result.getText());
      });

      if (seq !== startSeqRef.current) {
        controls.stop();
        return;
      }
      controlsRef.current = controls;
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      const message = error instanceof Error ? error.message : "Не удалось открыть камеру";

      if (name === "NotAllowedError" || name === "SecurityError" || /permission|notallowed|denied/i.test(message)) {
        setStatus("Доступ к камере запрещён. Нажмите «Включить камеру» и подтвердите разрешение браузера. Если запрос не появляется — разрешите камеру для этого браузера в настройках Android.");
      } else if (name === "NotFoundError" || name === "OverconstrainedError" || /notfound|device.*not found|overconstrained/i.test(message)) {
        setStatus("Браузер не нашёл доступную камеру. Нажмите «Включить камеру» — система попробует открыть любую камеру устройства.");
      } else if (name === "NotReadableError" || /notreadable|could not start/i.test(message)) {
        setStatus("Камера занята другим приложением. Закройте приложения, использующие камеру, и нажмите «Включить камеру».");
      } else {
        setStatus(message);
      }
    } finally {
      if (seq === startSeqRef.current) setStarting(false);
    }
  }, [acceptValue]);

  useEffect(() => {
    if (!open) return;
    const isAndroid = /Android/i.test(navigator.userAgent);
    if (isAndroid) {
      setStatus("ТСД готов к сканированию. Нажмите аппаратную кнопку сканера. Камера для этого не требуется.");
      return;
    }
    const timer = window.setTimeout(() => void startCamera(), 150);
    return () => window.clearTimeout(timer);
  }, [open, startCamera]);

  useEffect(() => () => stop(), [stop]);

  return <>
    <Button type="button" variant="outline" disabled={disabled} onClick={() => setOpen(true)} className={className}>
      <Camera /> {label}
    </Button>

    <Dialog open={open} onOpenChange={(value) => value ? setOpen(true) : close()}>
      <DialogContent className="w-[calc(100vw-24px)] max-w-lg overflow-hidden p-0">
        <DialogHeader className="px-4 pt-4 sm:px-5 sm:pt-5">
          <DialogTitle className="flex items-center gap-2"><ScanLine size={20} /> Сканирование кода</DialogTitle>
          <DialogDescription>ТСД: нажмите аппаратную кнопку сканера. Телефон: можно использовать заднюю камеру.</DialogDescription>
        </DialogHeader>

        <input
          ref={hiddenInputRef}
          className="fixed left-[-9999px] top-[-9999px] h-px w-px opacity-0"
          aria-hidden="true"
          autoComplete="off"
          inputMode="none"
          onChange={(event) => {
            const value = event.target.value.trim();
            if (value) acceptValue(value);
            event.target.value = "";
          }}
        />

        <div className="relative mx-3 mb-3 overflow-hidden rounded-2xl bg-black sm:mx-5 sm:mb-5">
          <video ref={videoRef} autoPlay playsInline muted disablePictureInPicture className="aspect-[3/4] w-full object-cover sm:aspect-[4/3]" />

          {!status && <>
            <div className="pointer-events-none absolute inset-[18%_10%] rounded-2xl border-2 border-white/90 shadow-[0_0_0_999px_rgba(0,0,0,.28)]" />
            <div className="pointer-events-none absolute left-1/2 top-1/2 h-px w-[58%] -translate-x-1/2 bg-red-400/80 shadow-[0_0_12px_rgba(248,113,113,.9)]" />
          </>}

          {starting && <div className="absolute inset-0 flex items-center justify-center bg-black/55 text-white">
            <div className="flex items-center gap-2 rounded-full bg-black/60 px-4 py-2 text-sm"><Loader2 className="animate-spin" size={18} /> Открываю камеру…</div>
          </div>}

          {status && <div className="absolute inset-0 flex items-center justify-center bg-black/90 p-6 text-center text-white">
            <div className="max-w-sm">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10"><Keyboard size={24} /></div>
              <p className="text-sm leading-6">{status}</p>
              <p className="mt-3 text-xs leading-5 text-white/70">Если это ТСД — просто нажмите физическую кнопку сканера и наведите на QR/штрихкод.</p>
              <Button type="button" variant="secondary" className="mt-4 h-12 px-5 text-base font-bold" onClick={() => void startCamera()}>
                <Camera size={18} /> Использовать камеру
              </Button>
              <Button type="button" variant="ghost" className="mt-2 text-white hover:bg-white/10 hover:text-white" onClick={() => hiddenInputRef.current?.focus({ preventScroll: true })}>
                <RefreshCw size={16} /> Ждать сканер ТСД
              </Button>
            </div>
          </div>}

          <button type="button" onClick={close} className="absolute right-3 top-3 z-20 rounded-full bg-black/60 p-2 text-white"><X size={18} /></button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
