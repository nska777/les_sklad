"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Plus } from "lucide-react";

export function MaterialsAddAction() {
  const pathname = usePathname();
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (pathname !== "/materials") {
      setTarget(null);
      return;
    }

    const actionBar = document.querySelector<HTMLElement>("main > div > div.flex.flex-col.gap-4 > div.flex.flex-wrap.items-center.gap-2");
    setTarget(actionBar);
  }, [pathname]);

  if (pathname !== "/materials") return null;

  const button = (
    <Link
      href="/onec-materials"
      className="inline-flex items-center justify-center gap-2 rounded-xl bg-orange-500 px-5 py-3 text-sm font-bold text-white shadow-md shadow-orange-200/60 transition hover:bg-orange-600 active:scale-[.98]"
      aria-label="Добавить материалы из 1С"
    >
      <Plus size={18} />
      Добавить материалы
    </Link>
  );

  if (target) return createPortal(button, target);

  return (
    <div className="fixed right-6 top-6 z-[120]">
      {button}
    </div>
  );
}
