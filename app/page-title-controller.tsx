"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const TITLES: Array<[string, string]> = [
  ["/materials/excess", "Излишки"],
  ["/rack-layout", "Стеллажи"],
  ["/transfer", "Перемещение"],
  ["/materials", "Материалы"],
  ["/labels", "Этикетки"],
  ["/onec-materials", "Материалы из 1С"],
  ["/issued", "Выданные товары"],
  ["/settings/users", "Пользователи"],
  ["/warehouse", "Склад"],
  ["/login", "Вход"],
  ["/", "Склад"],
];

function titleFor(pathname: string) {
  const match = TITLES.find(([route]) => route === "/" ? pathname === "/" : pathname === route || pathname.startsWith(`${route}/`));
  return match?.[1] || "Склад";
}

export function PageTitleController() {
  const pathname = usePathname();

  useEffect(() => {
    document.title = titleFor(pathname);
  }, [pathname]);

  return null;
}
