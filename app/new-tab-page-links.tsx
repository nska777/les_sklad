"use client";

import { useEffect } from "react";

const additionalPageRoutes = new Set([
  "/transfer",
  "/rack-layout",
  "/materials",
  "/labels",
  "/onec-materials",
  "/issued",
  "/settings/users",
]);

function normalizePath(href: string) {
  try {
    return new URL(href, window.location.origin).pathname.replace(/\/$/, "") || "/";
  } catch {
    return "";
  }
}

export function NewTabPageLinks() {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      // Подразделения (краска/ЛДСП) имеют собственную навигацию и никогда
      // не должны открывать маршруты основного склада фурнитуры.
      if (window.location.pathname.startsWith("/department/")) return;

      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const target = event.target as Element | null;
      const anchor = target?.closest<HTMLAnchorElement>("a[href]");
      if (!anchor) return;
      if (anchor.hasAttribute("download")) return;
      if (anchor.dataset.sameTab === "true") return;

      const url = new URL(anchor.href, window.location.origin);
      if (url.origin !== window.location.origin) return;

      const path = normalizePath(url.href);
      if (!additionalPageRoutes.has(path)) return;

      event.preventDefault();
      event.stopPropagation();
      window.open(url.href, "_blank", "noopener,noreferrer");
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return null;
}
