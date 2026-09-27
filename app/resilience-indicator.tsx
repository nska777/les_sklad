"use client";

import { useEffect, useState } from "react";

type Status = {
  enabled?: boolean;
  pending?: number;
  mode?: "online" | "offline" | "syncing";
  forced?: boolean;
};

export function ResilienceIndicator() {
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch("/api/resilience/status", { cache: "no-store" });
        if (!response.ok) return;
        const body = await response.json() as Status;
        if (active) setStatus(body);
      } catch {
        if (active) setStatus((current) => ({ ...current, mode: "offline" }));
      }
    };
    void load();
    const timer = window.setInterval(load, 20_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  if (!status?.enabled) return null;

  const pending = Number(status.pending || 0);
  const offline = status.mode === "offline";
  const syncing = status.mode === "syncing" || pending > 0;
  const label = offline
    ? `Офлайн · работаем локально${pending ? ` · в очереди ${pending}` : ""}`
    : syncing
      ? `Синхронизация · в очереди ${pending}`
      : "Онлайн · всё синхронизировано";

  return (
    <div
      title={status.forced ? "Включён тестовый офлайн-режим" : label}
      className={`fixed left-1/2 top-3 z-[9998] -translate-x-1/2 rounded-full border px-3 py-1.5 text-xs font-semibold shadow-sm backdrop-blur-md ${
        offline
          ? "border-amber-300/70 bg-amber-50/95 text-amber-900"
          : syncing
            ? "border-sky-300/70 bg-sky-50/95 text-sky-900"
            : "border-emerald-300/70 bg-emerald-50/95 text-emerald-900"
      }`}
    >
      {label}
    </div>
  );
}
