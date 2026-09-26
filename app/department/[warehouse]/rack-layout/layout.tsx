"use client";

import { useEffect } from "react";
import "./rack-layout.css";

export default function PaintRackLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    const patched: typeof window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/api/department-warehouse/storage") && String(init?.method || "GET").toUpperCase() === "POST" && typeof init?.body === "string") {
        try {
          const body = JSON.parse(init.body) as { action?: string; id?: string };
          if (body.action === "deleteStorage" && body.id) {
            return originalFetch("/api/department-warehouse-maintenance", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "hardDeleteRack", id: body.id }),
            });
          }
        } catch { /* use original request */ }
      }
      return originalFetch(input, init);
    };
    window.fetch = patched;

    void originalFetch("/api/department-warehouse-maintenance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "purgeArchived" }),
    }).catch(() => undefined);

    return () => { window.fetch = originalFetch; };
  }, []);

  return <div className="paint-rack-layout-page">{children}</div>;
}
