"use client";

import { useEffect, useRef } from "react";

function isRackAddStock(input: RequestInfo | URL, init?: RequestInit) {
  if ((init?.method || "GET").toUpperCase() !== "POST") return false;
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  return url === "/api/rack-layout" || url.endsWith("/api/rack-layout");
}

/**
 * Фактический склад — источник истины. 1С используется только как ориентир.
 * Старый /api/rack-layout всё ещё возвращает 409 при превышении остатка 1С,
 * поэтому здесь такой ответ автоматически переводится в дополнительное
 * оприходование. Пользователь больше не упирается в лимит и не должен
 * подтверждать излишек отдельным диалогом.
 */
export function AddStockExceptionHelper() {
  const originalFetchRef = useRef<typeof window.fetch | null>(null);

  useEffect(() => {
    if (originalFetchRef.current) return;
    const originalFetch = window.fetch.bind(window);
    originalFetchRef.current = originalFetch;

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!isRackAddStock(input, init) || typeof init?.body !== "string") {
        return originalFetch(input, init);
      }

      let body: Record<string, unknown> | null = null;
      try {
        body = JSON.parse(init.body) as Record<string, unknown>;
      } catch {
        return originalFetch(input, init);
      }

      if (body.action !== "addStock") return originalFetch(input, init);

      const response = await originalFetch(input, init);
      if (response.status !== 409) return response;

      let details: { available1c?: number; currentTotal?: number } = {};
      try {
        details = await response.clone().json() as typeof details;
      } catch {
        return response;
      }

      const isOnecLimit = typeof details.available1c === "number" && typeof details.currentTotal === "number";
      if (!isOnecLimit) return response;

      return originalFetch("/api/rack-layout/add-stock-exception", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cellId: body.cellId,
          productId: body.productId,
          quantity: body.quantity,
          operator: body.operator,
          reason: "Фактический излишек относительно остатка 1С",
        }),
      });
    };

    return () => {
      if (originalFetchRef.current) window.fetch = originalFetchRef.current;
      originalFetchRef.current = null;
    };
  }, []);

  return null;
}
