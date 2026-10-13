"use client";

import { useEffect, useState } from "react";

type QueueItem = { warehouse: string; action: string; status: string; error: string };
type Status = {
  enabled?: boolean;
  pending?: number;
  errors?: number;
  operations?: QueueItem[];
  mode?: "online" | "offline" | "syncing" | "error";
  forced?: boolean;
};

const names: Record<string, string> = {
  hardware: "Склад фурнитуры",
  paint: "Склад краски",
  ldsp: "Склад ЛДСП",
  semi: "Склад полуфабрикатов",
};

export function ResilienceIndicator() {
  const [status, setStatus] = useState<Status | null>(null);
  const [expanded, setExpanded] = useState(false);

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
  const errors = Number(status.errors || 0);
  const offline = status.mode === "offline";
  const hasError = errors > 0;
  const syncing = !hasError && pending > 0;
  const label = offline
    ? `Офлайн · в очереди ${pending}`
    : hasError
      ? `Ошибка синхронизации · ${errors}`
      : syncing
        ? `Синхронизация · в очереди ${pending}`
        : "Онлайн · всё синхронизировано";
  const color = offline ? "border-amber-300 bg-amber-50 text-amber-900"
    : hasError ? "border-red-300 bg-red-50 text-red-900"
      : syncing ? "border-sky-300 bg-sky-50 text-sky-900"
        : "border-emerald-300 bg-emerald-50 text-emerald-900";

  return (
    <div className="fixed left-1/2 top-3 z-[9998] flex -translate-x-1/2 flex-col items-center gap-2">
      <button type="button" onClick={() => setExpanded((value) => !value)}
        title="Нажмите, чтобы увидеть операции синхронизации"
        className={`rounded-full border px-3 py-1.5 text-xs font-semibold shadow-sm backdrop-blur-md ${color}`}>
        {label} {pending > 0 ? "⌄" : ""}
      </button>
      {expanded && pending > 0 && (
        <div className="max-h-64 w-[min(92vw,520px)] overflow-auto rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-900 shadow-xl">
          {(status.operations || []).map((item, index) => (
            <div key={index} className="border-b border-slate-100 py-2 last:border-0">
              <strong>{names[item.warehouse] || item.warehouse}</strong>
              <div>{item.action === "receive" ? "Приход" : item.action} · {item.status === "error" ? "Ошибка" : item.status === "pending" ? "Ожидает отправки" : "Отправляется"}</div>
              {item.error && <div className="mt-1 text-red-700">{item.error}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
