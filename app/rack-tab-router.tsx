"use client";

import { useEffect } from "react";

export function RackTabRouter() {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const tab = target?.closest<HTMLElement>("[role='tab']");
      if (!tab) return;
      const label = (tab.textContent || "").trim().toLowerCase();
      if (!label.includes("стеллаж")) return;
      event.preventDefault();
      event.stopPropagation();
      window.location.assign("/rack-layout");
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return null;
}
