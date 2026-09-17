"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

export function HidePrimaryInventory() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname !== "/") return;

    const apply = () => {
      const triggers = Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]'));
      const primary = triggers.find((node) => node.textContent?.includes("Первичный учёт"));
      const receipt = triggers.find((node) => node.textContent?.includes("Приёмка"));

      if (primary) {
        primary.style.display = "none";
        primary.setAttribute("aria-hidden", "true");
      }

      const scanPanel = document.querySelector<HTMLElement>('[role="tabpanel"][data-state="active"]');
      if (scanPanel && primary?.getAttribute("data-state") === "active" && receipt) {
        receipt.click();
      }
    };

    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-state"] });

    return () => observer.disconnect();
  }, [pathname]);

  return null;
}
