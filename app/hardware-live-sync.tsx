"use client";

import { useEffect } from "react";

type SnapshotDocument = {
  id?: string;
  lineId?: string;
  processedQuantity?: number;
};

type Snapshot = {
  racks: unknown[];
  cells: unknown[];
  products: unknown[];
  stocks: unknown[];
  movements: unknown[];
  activities: unknown[];
  documents: SnapshotDocument[];
};

function processedTotal(documents: SnapshotDocument[] | undefined) {
  if (!Array.isArray(documents)) return 0;
  return documents.reduce((sum, row) => sum + Number(row.processedQuantity || 0), 0);
}

function styleIssueDialogClose() {
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>("[data-slot='dialog-content']"));
  const dialog = dialogs.find((node) => (node.textContent || "").includes("Выдача материала"));
  if (!dialog) return;

  const close = dialog.querySelector<HTMLButtonElement>("[data-slot='dialog-close']");
  if (!close) return;

  close.setAttribute("aria-label", "Закрыть окно выдачи");
  close.title = "Закрыть";
  Object.assign(close.style, {
    position: "absolute",
    top: "14px",
    right: "14px",
    width: "36px",
    height: "36px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "9999px",
    border: "1px solid rgba(255,255,255,.28)",
    background: "rgba(255,255,255,.12)",
    color: "#ffffff",
    opacity: "1",
    zIndex: "40",
    cursor: "pointer",
    boxShadow: "0 2px 8px rgba(0,0,0,.18)",
  });

  const svg = close.querySelector<SVGElement>("svg");
  if (svg) {
    svg.style.width = "18px";
    svg.style.height = "18px";
    svg.style.strokeWidth = "2.2";
  }
}

function closeIssueDialogAfterIssuedLine() {
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>("[data-slot='dialog-content']"));
  const dialog = dialogs.find((node) => (node.textContent || "").includes("Выдача материала"));
  if (!dialog) return;

  const close = dialog.querySelector<HTMLButtonElement>("[data-slot='dialog-close']");
  close?.click();
}

export function HardwareLiveSync() {
  useEffect(() => {
    if (window.location.pathname !== "/warehouse") return;
    let stopped = false;
    let previousProcessedTotal: number | null = null;

    const load = async () => {
      try {
        const response = await fetch("/api/warehouse", { cache: "no-store" });
        if (!response.ok) return;
        const snapshot = await response.json() as Snapshot;
        if (stopped) return;

        const currentProcessedTotal = processedTotal(snapshot.documents);
        if (previousProcessedTotal !== null && currentProcessedTotal > previousProcessedTotal) {
          // После успешной выдачи одной позиции закрываем мастер.
          // Следующая позиция всегда откроется с чистыми шагами проверки,
          // без зелёных подтверждений от предыдущего материала.
          window.setTimeout(closeIssueDialogAfterIssuedLine, 80);
        }
        previousProcessedTotal = currentProcessedTotal;

        window.dispatchEvent(new CustomEvent("hardware:live-snapshot", { detail: snapshot }));
        window.setTimeout(styleIssueDialogClose, 0);
      } catch {
        // Фоновая синхронизация не должна мешать текущей работе.
      }
    };

    const observer = new MutationObserver(() => styleIssueDialogClose());
    observer.observe(document.body, { childList: true, subtree: true });

    void load();
    styleIssueDialogClose();
    const timer = window.setInterval(() => void load(), 1500);
    const refresh = () => void load();
    window.addEventListener("hardware:refresh-now", refresh);

    return () => {
      stopped = true;
      observer.disconnect();
      window.clearInterval(timer);
      window.removeEventListener("hardware:refresh-now", refresh);
    };
  }, []);

  return null;
}
