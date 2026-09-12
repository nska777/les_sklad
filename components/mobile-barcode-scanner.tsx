"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, ScanLine, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type BarcodeResult = { rawValue?: string };
type BarcodeDetectorLike = {
  detect: (source: ImageBitmapSource) => Promise<BarcodeResult[]>;
};
type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

type Props = {
  label: string;
  onDetected: (value: string) => void;
  disabled?: boolean;
  className?: string;
};

export function MobileBarcodeScanner({ label, onDetected, disabled, className }: Props) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [starting, setStarting] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const foundRef = useRef(false);

  const stop = () => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    detectorRef.current = null;
    foundRef.current = false;
  };

  useEffect(() => () => stop(), []);

  useEffect(() => {
    if (!open) {
      stop();
      return;
    }

    let cancelled = false;
    const start = async () => {
      setStarting(true);
      setStatus("");
      foundRef.current = false;
      try {
        const Detector = (window as Window & { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
        if (!Detector) {
          setStatus("Этот браузер не поддерживает камерное распознавание штрихкодов. На iPhone откройте сайт в актуальном Safari или используйте Bluetooth-сканер.");
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        detectorRef.current = new Detector({ formats: ["qr_code", "code_128", "code_39", "ean_13", "ean_8", "upc_a", "upc_e"] });

        const tick = async () => {
          if (cancelled || foundRef.current) return;
          const current = videoRef.current;
          const detector = detectorRef.current;
          if (current && detector && current.readyState >= 2) {
            try {
              const results = await detector.detect(current);
              const value = results.find((item) => item.rawValue?.trim())?.rawValue?.trim();
              if (value) {
                foundRef.current = true;
                if (navigator.vibrate) navigator.vibrate(70);
                onDetected(value);
                setStatus(`Считано: ${value}`);
                window.setTimeout(() => setOpen(false), 250);
                return;
              }
            } catch {
              // Камера продолжает сканирование следующего кадра.
            }
          }
          frameRef.current = requestAnimationFrame(tick);
        };
        tick();
      } catch (error) {
        const name = error instanceof DOMException ? error.name : "";
        setStatus(name === "NotAllowedError"
          ? "Нет доступа к камере. Разрешите камеру для этого сайта в настройках Safari/Chrome."
          : "Не удалось запустить камеру. Проверьте разрешение камеры и попробуйте ещё раз.");
      } finally {
        if (!cancelled) setStarting(false);
      }
    };
    void start();
    return () => {
      cancelled = true;
      stop();
    };
  }, [open, onDetected]);

  return <>
    <Button type="button" variant="outline" disabled={disabled} onClick={() => setOpen(true)} className={className}>
      <Camera /> {label}
    </Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="w-[calc(100vw-24px)] max-w-lg overflow-hidden p-0">
        <DialogHeader className="px-4 pt-4 sm:px-5 sm:pt-5">
          <DialogTitle className="flex items-center gap-2"><ScanLine size={20} /> Сканирование камерой</DialogTitle>
          <DialogDescription>Наведите заднюю камеру на QR или штрихкод. Распознавание произойдёт автоматически.</DialogDescription>
        </DialogHeader>
        <div className="relative mx-3 mb-3 overflow-hidden rounded-2xl bg-black sm:mx-5 sm:mb-5">
          <video ref={videoRef} playsInline muted className="aspect-[3/4] w-full object-cover sm:aspect-[4/3]" />
          <div className="pointer-events-none absolute inset-[18%_10%] rounded-2xl border-2 border-white/90 shadow-[0_0_0_999px_rgba(0,0,0,.28)]" />
          {starting && <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white"><Loader2 className="animate-spin" /></div>}
          {status && <div className="absolute inset-x-3 bottom-3 rounded-xl bg-black/70 px-3 py-2 text-center text-sm text-white">{status}</div>}
          <button type="button" onClick={() => setOpen(false)} className="absolute right-3 top-3 rounded-full bg-black/55 p-2 text-white"><X size={18} /></button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
