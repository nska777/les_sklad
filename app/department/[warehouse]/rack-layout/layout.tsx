"use client";

import { useEffect } from "react";
import { createRoot, Root } from "react-dom/client";
import { QRCodeSVG } from "qrcode.react";
import "./rack-layout.css";

export default function PaintRackLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    const patched: typeof window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = String(init?.method || "GET").toUpperCase();
      if (method === "POST" && typeof init?.body === "string") {
        try {
          const body = JSON.parse(init.body) as { action?: string; id?: string };
          if (url.endsWith("/api/department-warehouse/storage") && body.action === "deleteStorage" && body.id) {
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

    const roots = new Map<Element, Root>();
    const simplifyQr = () => {
      const labels = Array.from(document.querySelectorAll("div"));
      for (const label of labels) {
        const raw = (label.textContent || "").trim();
        let code = "";
        if (/^RL-CELL:[^:]+:.+$/.test(raw)) code = raw.split(":").pop() || "";
        else if (/^[A-ZА-Я0-9_-]{2,20}$/i.test(raw) && label.previousElementSibling?.querySelector("svg")) code = raw;
        if (!code) continue;
        const qrBox = label.previousElementSibling;
        if (!qrBox || !qrBox.querySelector("svg")) continue;
        if (label.textContent !== code) label.textContent = code;
        if (qrBox.getAttribute("data-simple-qr") === code) continue;
        roots.get(qrBox)?.unmount();
        qrBox.replaceChildren();
        const root = createRoot(qrBox);
        roots.set(qrBox, root);
        qrBox.setAttribute("data-simple-qr", code);
        root.render(<QRCodeSVG value={code} size={165}/>);
      }
    };
    simplifyQr();
    let scheduled = 0;
    const observer = new MutationObserver(() => {
      window.clearTimeout(scheduled);
      scheduled = window.setTimeout(simplifyQr, 30);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    return () => {
      observer.disconnect(); window.clearTimeout(scheduled);
      roots.forEach((root) => root.unmount()); roots.clear();
      window.fetch = originalFetch;
    };
  }, []);

  return <div className="paint-rack-layout-page">{children}</div>;
}
