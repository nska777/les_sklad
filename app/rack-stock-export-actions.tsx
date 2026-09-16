"use client";

import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { FileSpreadsheet } from "lucide-react";

function findRackTarget() {
  if (typeof document === "undefined") return { target: null as HTMLElement | null, rackCode: "" };
  const scene = document.getElementById("rack-3d-scene");
  if (!scene) return { target: null as HTMLElement | null, rackCode: "" };
  const text = scene.textContent || "";
  const match = text.match(/Стеллаж\s+([^\s]+)/i);
  const header = scene.firstElementChild as HTMLElement | null;
  const candidate = header?.children?.[1];
  const target = candidate instanceof HTMLElement ? candidate : null;
  return { target, rackCode: match?.[1]?.trim() || "" };
}

function findCellTarget() {
  if (typeof document === "undefined") return { target: null as HTMLElement | null, cellCode: "" };
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'));
  for (const dialog of dialogs) {
    const text = dialog.textContent || "";
    const match = text.match(/Ячейка\s+([^\s]+)/i);
    if (!match) continue;
    const contentButton = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes("Содержимое"));
    const target = contentButton?.parentElement instanceof HTMLElement ? contentButton.parentElement : null;
    return { target, cellCode: match[1].trim() };
  }
  return { target: null as HTMLElement | null, cellCode: "" };
}

const buttonClass = "inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100 active:scale-[.98]";

export function RackStockExportActions() {
  const pathname = usePathname();
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (pathname !== "/rack-layout") return;
    const observer = new MutationObserver(() => setVersion((value) => value + 1));
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class"] });
    const timer = window.setInterval(() => setVersion((value) => value + 1), 1000);
    return () => {
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, [pathname]);

  const rack = useMemo(() => pathname === "/rack-layout" ? findRackTarget() : { target: null, rackCode: "" }, [pathname, version]);
  const cell = useMemo(() => pathname === "/rack-layout" ? findCellTarget() : { target: null, cellCode: "" }, [pathname, version]);

  if (pathname !== "/rack-layout") return null;

  return (
    <>
      {rack.target && rack.rackCode && createPortal(
        <a href={`/api/stock-export?scope=rack&rackCode=${encodeURIComponent(rack.rackCode)}`} className={buttonClass} title={`Скачать остатки стеллажа ${rack.rackCode} в Excel`}>
          <FileSpreadsheet size={16} /> Остатки Excel
        </a>,
        rack.target,
      )}
      {cell.target && cell.cellCode && createPortal(
        <a href={`/api/stock-export?scope=cell&cellCode=${encodeURIComponent(cell.cellCode)}`} className={buttonClass} title={`Скачать остатки ячейки ${cell.cellCode} в Excel`}>
          <FileSpreadsheet size={15} /> Excel ячейки
        </a>,
        cell.target,
      )}
    </>
  );
}
