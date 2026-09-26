"use client";

import { useEffect } from "react";
import { toast } from "sonner";

export function PlacementWarningClient() {
  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const response = await originalFetch(...args);
      try {
        const input = args[0];
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes("/api/department-onec/place") && response.ok) {
          const clone = response.clone();
          void clone.json().then((body: { warning?: string; excessAdded?: number; excessUnit?: string }) => {
            if (body.warning) {
              toast.warning("Количество выше остатка 1С", {
                description: body.warning,
                duration: 9000,
              });
            }
          }).catch(() => undefined);
        }
      } catch { /* не мешаем обычному fetch */ }
      return response;
    };
    return () => { window.fetch = originalFetch; };
  }, []);
  return null;
}
