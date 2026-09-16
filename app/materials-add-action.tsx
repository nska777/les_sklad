"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, FileSpreadsheet, Plus } from "lucide-react";

function findMaterialsActionBar() {
  const headings = Array.from(document.querySelectorAll<HTMLElement>("h1"));
  const heading = headings.find((node) => node.textContent?.trim() === "Материалы склада");
  if (!heading) return null;

  const headerRow = heading.parentElement?.parentElement;
  if (!headerRow) return null;

  const children = Array.from(headerRow.children).filter((node): node is HTMLElement => node instanceof HTMLElement);
  return children.length > 1 ? children[children.length - 1] : null;
}

export function MaterialsAddAction() {
  const pathname = usePathname();
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (pathname !== "/materials") {
      setTarget(null);
      return;
    }

    const resolve = () => setTarget(findMaterialsActionBar());
    resolve();

    const observer = new MutationObserver(resolve);
    observer.observe(document.body, { subtree: true, childList: true });
    const timer = window.setTimeout(resolve, 250);

    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [pathname]);

  if (pathname !== "/materials") return null;

  const buttons = (
    <>
      <Link
        href="/materials/excess"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-orange-200 bg-orange-50 px-4 py-2.5 text-sm font-bold text-orange-800 transition hover:bg-orange-100 active:scale-[.98]"
      >
        <AlertTriangle size={17} />
        Излишки
      </Link>
      <a
        href="/api/stock-export?scope=all"
        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-bold text-emerald-800 transition hover:bg-emerald-100 active:scale-[.98]"
        title="Скачать Excel с фактическими остатками всего склада"
      >
        <FileSpreadsheet size={17} />
        Остатки Excel
      </a>
      <Link
        href="/onec-materials"
        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-orange-500 px-5 py-2.5 text-sm font-bold text-white shadow-md shadow-orange-200/60 transition hover:bg-orange-600 active:scale-[.98]"
        aria-label="Добавить материалы из 1С"
      >
        <Plus size={18} />
        Добавить материалы
      </Link>
    </>
  );

  if (target) return createPortal(buttons, target);

  return null;
}
