"use client";

import { useEffect } from "react";

type RackOrderResponse = { racks?: Array<{ id: string; code: string }> };

export function RackOrderFix() {
  useEffect(() => {
    let cancelled = false;
    let order = new Map<string, number>();

    const apply = () => {
      const list = document.querySelector("main > div > section.panel > div.grid > div:nth-child(2) > div.flex");
      if (!list) return;
      const buttons = Array.from(list.children).filter((node): node is HTMLButtonElement => node instanceof HTMLButtonElement);
      for (const button of buttons) {
        const code = button.querySelector("div")?.textContent?.trim() || "";
        const position = order.get(code);
        button.style.order = String(position ?? 999999);
      }
    };

    void fetch("/api/rack-order", { cache: "no-store" })
      .then(async (response): Promise<RackOrderResponse | null> => {
        if (!response.ok) return null;
        return await response.json() as RackOrderResponse;
      })
      .then((data) => {
        if (cancelled || !data?.racks) return;
        order = new Map(data.racks.map((rack, index) => [rack.code, index]));
        apply();
      })
      .catch(() => {
        // Порядок — косметика; при ошибке API оставляем серверный порядок.
      });

    const observer = new MutationObserver(() => apply());
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, []);

  return null;
}
