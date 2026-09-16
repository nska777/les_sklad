"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { FileSpreadsheet } from "lucide-react";

function findRackTarget() {
  const scene = document.getElementById("rack-3d-scene");
  if (!scene) return { target: null as HTMLElement | null, rackCode: "" };

  const header = scene.firstElementChild as HTMLElement | null;
  if (!header) return { target: null as HTMLElement | null, rackCode: "" };

  // В заголовке стеллажа первый блок слева имеет структуру:
  // <div><div>Стеллаж CODE</div><h2>NAME</h2>...</div>
  // Берём код только из внутренней строки "Стеллаж CODE", чтобы название
  // стеллажа не склеивалось с кодом (например FB + FB4 => F BFB4).
  const infoBlock = header.firstElementChild as HTMLElement | null;
  const label = infoBlock?.querySelector<HTMLElement>(":scope > div");
  const labelText = label?.textContent?.trim() || "";
  const rackMatch = labelText.match(/^Стеллаж\s+([^\s]+)/i);
  const rackCode = rackMatch?.[1]?.trim() || "";

  const children = Array.from(header.children).filter((node): node is HTMLElement => node instanceof HTMLElement);
  const target = children.length > 1 ? children[children.length - 1] : null;
  return { target, rackCode };
}

function findCellTarget() {
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'));
  for (const dialog of dialogs) {
    const title = Array.from(dialog.querySelectorAll<HTMLElement>("h1,h2,h3")).find((node) => /^Ячейка\s+/i.test(node.textContent?.trim() || ""));
    if (!title) continue;

    const cellCode = title.textContent?.trim().replace(/^Ячейка\s+/i, "").split(/\s+/)[0] || "";
    const contentButton = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes("Содержимое"));
    const target = contentButton?.parentElement instanceof HTMLElement ? contentButton.parentElement : null;
    return { target, cellCode };
  }
  return { target: null as HTMLElement | null, cellCode: "" };
}

const buttonClass = "inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100 active:scale-[.98]";

export function RackStockExportActions() {
  const pathname = usePathname();
  const [rackTarget, setRackTarget] = useState<HTMLElement | null>(null);
  const [rackCode, setRackCode] = useState("");
  const [cellTarget, setCellTarget] = useState<HTMLElement | null>(null);
  const [cellCode, setCellCode] = useState("");

  useEffect(() => {
    if (pathname !== "/rack-layout") {
      setRackTarget(null);
      setCellTarget(null);
      return;
    }

    const resolve = () => {
      const rack = findRackTarget();
      const cell = findCellTarget();
      setRackTarget(rack.target);
      setRackCode(rack.rackCode);
      setCellTarget(cell.target);
      setCellCode(cell.cellCode);
    };

    resolve();
    const observer = new MutationObserver(resolve);
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    const timer = window.setInterval(resolve, 700);

    return () => {
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, [pathname]);

  if (pathname !== "/rack-layout") return null;

  return (
    <>
      {rackTarget && rackCode && createPortal(
        <a
          href={`/api/rack-stock-export?rackCode=${encodeURIComponent(rackCode)}`}
          className={buttonClass}
          title={`Скачать весь стеллаж ${rackCode}: все ячейки и содержимое`}
        >
          <FileSpreadsheet size={16} /> Excel стеллажа {rackCode}
        </a>,
        rackTarget,
      )}
      {cellTarget && cellCode && createPortal(
        <a
          href={`/api/stock-export?scope=cell&cellCode=${encodeURIComponent(cellCode)}`}
          className={buttonClass}
          title={`Скачать остатки ячейки ${cellCode} в Excel`}
        >
          <FileSpreadsheet size={15} /> Excel ячейки {cellCode}
        </a>,
        cellTarget,
      )}
    </>
  );
}
