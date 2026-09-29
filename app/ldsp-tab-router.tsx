"use client";

import { useEffect } from "react";

export function LdspTabRouter() {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!window.location.pathname.startsWith("/department/ldsp")) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const tab = target.closest<HTMLElement>("[role='tab'],button");
      if (!tab) return;
      const label = (tab.textContent || "").trim().toLowerCase();
      if (label !== "склад") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      window.location.assign("/department/ldsp/ldsp-layout");
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return null;
}
