"use client";

import { useEffect } from "react";

const routes: Record<string, string> = {
  "перемещение": "/transfer",
  "стеллажи": "/rack-layout",
  "материалы": "/materials",
  "этикетки": "/labels",
};

export function RackTabRouter() {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const tab = target?.closest<HTMLElement>("[role='tab']");
      if (!tab) return;
      const label = (tab.textContent || "").trim().toLowerCase();
      const route = routes[label];
      if (!route) return;

      event.preventDefault();
      event.stopPropagation();
      window.open(route, "_blank", "noopener,noreferrer");
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return null;
}
