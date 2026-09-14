"use client";

import { useEffect } from "react";

const tabRoutes: Record<string, string> = {
  "перемещение": "/transfer",
  "стеллажи": "/rack-layout",
  "материалы": "/materials",
  "этикетки": "/labels",
};

const secondaryRoutes = [
  "/transfer",
  "/rack-layout",
  "/materials",
  "/labels",
  "/onec-materials",
  "/issued",
  "/settings/users",
];

function isSecondaryRoute(href: string) {
  try {
    const url = new URL(href, window.location.origin);
    if (url.origin !== window.location.origin) return false;
    return secondaryRoutes.some((route) => url.pathname === route || url.pathname.startsWith(`${route}/`));
  } catch {
    return false;
  }
}

function openInNewTab(route: string) {
  const anchor = document.createElement("a");
  anchor.href = route;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export function RackTabRouter() {
  useEffect(() => {
    const applyTargets = () => {
      document.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((anchor) => {
        if (!isSecondaryRoute(anchor.href)) return;
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
      });
    };

    applyTargets();

    const observer = new MutationObserver(() => applyTargets());
    observer.observe(document.documentElement, { childList: true, subtree: true });

    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;

      // Для обычных ссылок браузер сам откроет новую вкладку благодаря target=_blank.
      const anchor = target.closest<HTMLAnchorElement>("a[href]");
      if (anchor && isSecondaryRoute(anchor.href)) {
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        return;
      }

      // Часть пунктов главного меню сделана как Radix Tabs, а не как ссылки.
      // Для них явно создаём настоящий target=_blank переход.
      const tab = target.closest<HTMLElement>("[role='tab']");
      if (!tab) return;

      const label = (tab.textContent || "").trim().toLowerCase();
      const route = tabRoutes[label];
      if (!route) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      openInNewTab(route);
    };

    document.addEventListener("click", onClick, true);

    return () => {
      observer.disconnect();
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  return null;
}
