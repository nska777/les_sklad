"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Camera, PackageSearch, QrCode, ScanLine } from "lucide-react";
import { toast } from "sonner";
import { MobileBarcodeScanner } from "@/components/mobile-barcode-scanner";

type Mode = "document" | "product" | "cell";

function setReactInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function findIssuePanel() {
  const headings = Array.from(document.querySelectorAll("h2"));
  const heading = headings.find((node) => node.textContent?.trim() === "Собрать и выдать");
  return heading?.closest("section.panel") as HTMLElement | null;
}

export function IssueMobileScanTools() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);

  useEffect(() => {
    let localHost: HTMLElement | null = null;
    const mount = () => {
      const panel = findIssuePanel();
      if (!panel) {
        setHost(null);
        return;
      }
      const title = panel.querySelector(".panel-title");
      if (!title) return;
      localHost = panel.querySelector<HTMLElement>("[data-mobile-scan-host]");
      if (!localHost) {
        localHost = document.createElement("div");
        localHost.dataset.mobileScanHost = "true";
        title.insertAdjacentElement("afterend", localHost);
      }
      setHost(localHost);
    };
    mount();
    const observer = new MutationObserver(mount);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      localHost?.remove();
    };
  }, []);

  const label = useMemo(() => mode === "document" ? "Сканировать QR документа" : mode === "product" ? "Сканировать материал" : "Сканировать QR ячейки", [mode]);

  const handleDetected = (raw: string) => {
    const value = raw.trim();
    if (!value) return;

    if (mode === "document") {
      const input = Array.from(document.querySelectorAll<HTMLInputElement>("input")).find((item) => item.placeholder.includes("ISSUE:"));
      if (!input) return toast.error("Поле QR документа сейчас недоступно");
      setReactInputValue(input, value);
      window.setTimeout(() => input.closest("form")?.requestSubmit(), 30);
      toast.success("QR документа считан");
      return;
    }

    if (mode === "product") {
      const normalized = value.toUpperCase();
      const barcode = Array.from(document.querySelectorAll<HTMLElement>("[data-barcode-value]")).find((item) => item.dataset.barcodeValue?.trim().toUpperCase() === normalized);
      const rowButton = barcode?.closest("button") as HTMLButtonElement | null;
      if (!rowButton) return toast.error("Этот материал не найден в открытом документе");
      rowButton.click();
      rowButton.scrollIntoView({ behavior: "smooth", block: "center" });
      toast.success("Материал выбран");
      return;
    }

    const input = Array.from(document.querySelectorAll<HTMLInputElement>("input")).find((item) => item.placeholder.includes("CT-011A"));
    if (!input) return toast.error("Сначала выберите позицию документа");
    setReactInputValue(input, value);
    window.setTimeout(() => input.closest("form")?.requestSubmit(), 30);
    toast.success("QR ячейки считан");
  };

  if (!host) return null;

  return createPortal(
    <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50/70 p-3 sm:p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-bold text-blue-900"><Camera size={18} /> Камера телефона / ТСД</div>
      <div className="grid gap-2 sm:grid-cols-3">
        <button type="button" onClick={() => setMode("document")} className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm font-semibold text-blue-900 shadow-sm active:scale-[.99]"><QrCode size={17} /> QR документа</button>
        <button type="button" onClick={() => setMode("product")} className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm font-semibold text-blue-900 shadow-sm active:scale-[.99]"><PackageSearch size={17} /> Материал</button>
        <button type="button" onClick={() => setMode("cell")} className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm font-semibold text-blue-900 shadow-sm active:scale-[.99]"><ScanLine size={17} /> Ячейка</button>
      </div>
      <p className="mt-2 text-xs leading-5 text-blue-900/70">На iPhone: документ → материал → ячейка → проверьте количество → подтвердите выдачу. Остаток спишется сразу в общей базе.</p>
      {mode && <div className="hidden"><MobileBarcodeScanner label={label} onDetected={handleDetected} /></div>}
      {mode && <AutoOpenScanner label={label} onDetected={handleDetected} onClose={() => setMode(null)} />}
    </div>,
    host,
  );
}

function AutoOpenScanner({ label, onDetected, onClose }: { label: string; onDetected: (value: string) => void; onClose: () => void }) {
  const [clicked, setClicked] = useState(false);
  useEffect(() => {
    if (clicked) return;
    const timer = window.setTimeout(() => {
      const button = document.querySelector<HTMLButtonElement>("[data-mobile-auto-scanner] button");
      button?.click();
      setClicked(true);
    }, 20);
    return () => window.clearTimeout(timer);
  }, [clicked]);

  return <div data-mobile-auto-scanner className="mt-2">
    <MobileBarcodeScanner label={label} onDetected={(value) => { onDetected(value); onClose(); }} />
  </div>;
}
