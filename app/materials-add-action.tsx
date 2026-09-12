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
      className="fixed bottom-5 right-4 z-[120] inline-flex items-center justify-center gap-2 rounded-2xl bg-orange-500 px-5 py-3.5 text-sm font-bold text-white shadow-xl shadow-orange-200/70 transition hover:bg-orange-600 active:scale-[.98] sm:bottom-6 sm:right-6 sm:px-6 sm:text-base"
      aria-label="Добавить материалы из 1С"
    >
      <Plus size={20} />
      Добавить материалы
    </Link>
  );
}
