"use client";

import { useEffect } from "react";

type Snapshot = {
  racks: unknown[];
  cells: unknown[];
  products: unknown[];
  stocks: unknown[];
  movements: unknown[];
  activities: unknown[];
  documents: unknown[];
};

export function HardwareLiveSync() {
  useEffect(() => {
    if (window.location.pathname !== "/warehouse") return;
    let stopped = false;

    const load = async () => {
      try {
        const response = await fetch("/api/warehouse", { cache: "no-store" });
        if (!response.ok) return;
        const snapshot = await response.json() as Snapshot;
        if (!stopped) window.dispatchEvent(new CustomEvent("hardware:live-snapshot", { detail: snapshot }));
      } catch {
        // Фоновая синхронизация не должна мешать текущей работе.
      }
    };

    void load();
    const timer = window.setInterval(() => void load(), 1500);
    const refresh = () => void load();
    window.addEventListener("hardware:refresh-now", refresh);

    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener("hardware:refresh-now", refresh);
    };
  }, []);

  return null;
}
