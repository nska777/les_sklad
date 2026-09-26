"use client";

import { useEffect } from "react";
import WarehouseFullUiV3 from "./warehouse-full-ui-v3";

export default function WarehouseFullUiV4() {
  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/api/department-warehouse") && String(init?.method || "GET").toUpperCase() === "POST" && typeof init?.body === "string") {
        try {
          const body = JSON.parse(init.body) as Record<string, unknown>;
          if (body.action === "receive" && String(body.documentNumber || "").includes("РАЗМЕЩЕНИЕ")) {
            return originalFetch("/api/department-warehouse-maintenance", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "placeProduct", productId: body.productId, cellId: body.cellId, quantity: body.quantity, documentNumber: body.documentNumber, comment: body.comment }),
            });
          }
        } catch {}
      }
      return originalFetch(input, init);
    };
    return () => { window.fetch = originalFetch; };
  }, []);

  return <WarehouseFullUiV3 />;
}
