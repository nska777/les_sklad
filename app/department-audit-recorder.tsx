"use client";

import { useEffect } from "react";

const auditEndpoints = [
  "/api/department-warehouse",
  "/api/department-warehouse-controls",
  "/api/department-warehouse-maintenance",
  "/api/department-warehouse-inventory",
  "/api/department-onec/place",
  "/api/department-excess",
];

export function DepartmentAuditRecorder() {
  useEffect(() => {
    const previous = window.fetch.bind(window);
    const patched: typeof window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = String(init?.method || "GET").toUpperCase();
      let parsed: Record<string, unknown> | null = null;
      if (method === "POST" && typeof init?.body === "string" && auditEndpoints.some((path) => url.includes(path)) && !url.includes("/api/department-audit")) {
        try { parsed = JSON.parse(init.body) as Record<string, unknown>; } catch { parsed = null; }
      }

      const response = await previous(input, init);
      if (parsed && response.ok) {
        const action = String(parsed.action || "").trim();
        if (action) {
          void previous("/api/department-audit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action, endpoint: url, payload: parsed }),
            keepalive: true,
          }).catch(() => undefined);
        }
      }
      return response;
    };
    window.fetch = patched;
    return () => { window.fetch = previous; };
  }, []);

  return null;
}
