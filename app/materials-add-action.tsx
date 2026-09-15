"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";

export function MaterialsAddAction() {
  const pathname = usePathname();
  if (pathname !== "/materials") return null;

  return (
    <Link
      href="/onec-materials"
      className="fixed right-6 top-6 z-[120] inline-flex items-center justify-center gap-2 rounded-xl bg-orange-500 px-5 py-3 text-sm font-bold text-white shadow-xl shadow-orange-200/70 transition hover:bg-orange-600 active:scale-[.98]"
      aria-label="Добавить материалы из 1С"
    >
      <Plus size={18} />
      Добавить материалы
    </Link>
  );
}
