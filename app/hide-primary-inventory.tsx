"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

export function HidePrimaryInventory() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname !== "/" && pathname !== "/warehouse") return;

    const apply = () => {
      const headings = Array.from(document.querySelectorAll<HTMLElement>("h1,h2"));
      const countHeading = headings.find((node) => node.textContent?.trim() === "Посчитайте то, что реально лежит");
      const saveHeading = headings.find((node) => node.textContent?.trim() === "Сохраните начальный остаток");

      const countCard = countHeading?.closest(".scan-console") as HTMLElement | null;
      const saveCard = saveHeading?.closest(".panel") as HTMLElement | null;

      if (countCard && saveCard) {
        const countSection = countCard.closest("section") as HTMLElement | null;
        const saveSection = saveCard.closest("section") as HTMLElement | null;

        if (countSection && countSection === saveSection) {
          countSection.style.display = "none";
          return;
        }
      }

      if (countCard) countCard.style.display = "none";
      if (saveCard) saveCard.style.display = "none";
    };

    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.body, { subtree: true, childList: true });

    return () => observer.disconnect();
  }, [pathname]);

  return null;
}
