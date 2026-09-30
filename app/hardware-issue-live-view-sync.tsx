"use client";

import { useEffect } from "react";

type Progress = {
  documentId: string;
  lineId: string;
  productVerified: boolean;
  cellId: string;
  cellCode: string;
  quantity: number;
  quantityVerified: boolean;
  updatedBy: string;
  updatedAt: string;
};

function findIssueDocumentId() {
  const title = Array.from(document.querySelectorAll("h2")).find((node) => node.textContent?.trim() === "Собрать и выдать");
  const panel = title?.closest("section.panel");
  const select = panel
    ? Array.from(panel.querySelectorAll("select"))
        .map((node) => node as HTMLSelectElement)
        .find((node) => Array.from(node.options).some((option) => option.textContent?.includes("поз.")))
    : null;
  return select?.value || "";
}

function findStep(dialog: HTMLElement, title: string) {
  const marker = Array.from(dialog.querySelectorAll<HTMLElement>("div")).find((node) => node.textContent?.trim() === title);
  return marker?.closest<HTMLElement>(".rounded-2xl") || null;
}

function badge(step: HTMLElement, key: string, text: string) {
  let node = step.querySelector<HTMLElement>(`[data-live-step="${key}"]`);
  if (!node) {
    node = document.createElement("div");
    node.dataset.liveStep = key;
    node.className = "mt-2 inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800";
    step.appendChild(node);
  }
  node.textContent = text;
}

function markDone(step: HTMLElement | null, key: string, text: string) {
  if (!step) return;
  step.style.opacity = "1";
  step.style.background = "#ecfdf5";
  step.style.borderColor = "#a7f3d0";
  step.style.color = "#065f46";
  badge(step, key, text);
}

export function HardwareIssueLiveViewSync() {
  useEffect(() => {
    if (window.location.pathname !== "/warehouse") return;
    let stopped = false;
    let lastFingerprint = "";

    const apply = (progress: Progress | null) => {
      if (!progress) return;
      const dialog = document.querySelector<HTMLElement>("[role='dialog']");
      if (!dialog) return;

      const product = findStep(dialog, "Отсканируйте штрихкод материала");
      const cell = findStep(dialog, "Отсканируйте QR ячейки");
      const quantity = findStep(dialog, "Подтвердите количество");

      if (progress.productVerified) markDone(product, "product", `Подтверждено${progress.updatedBy ? ` · ${progress.updatedBy}` : ""}`);
      if (progress.cellCode) markDone(cell, "cell", `Ячейка подтверждена: ${progress.cellCode}`);
      if (progress.quantityVerified) markDone(quantity, "quantity", `Количество подтверждено: ${Number(progress.quantity || 0).toLocaleString("ru-RU")}`);

      const ready = dialog.querySelector<HTMLElement>("[data-live-ready='1']");
      if (progress.productVerified && progress.cellCode && progress.quantityVerified) {
        if (!ready) {
          const button = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button")).find((node) => node.textContent?.includes("Выдать материал") || node.textContent?.includes("Ожидание проверок"));
          const holder = button?.parentElement;
          if (holder) {
            const note = document.createElement("div");
            note.dataset.liveReady = "1";
            note.className = "mb-3 rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800";
            note.textContent = `На другом устройстве все проверки пройдены${progress.updatedBy ? ` · ${progress.updatedBy}` : ""}`;
            holder.insertBefore(note, button || null);
          }
        }
      } else if (ready) {
        ready.remove();
      }
    };

    const load = async () => {
      const documentId = findIssueDocumentId();
      if (!documentId) return;
      try {
        const response = await fetch(`/api/warehouse/issues/live-progress?documentId=${encodeURIComponent(documentId)}`, { cache: "no-store" });
        if (!response.ok) return;
        const body = await response.json() as { progress?: Progress[] };
        const progress = body.progress?.[0] || null;
        if (!progress || stopped) return;
        const fingerprint = [progress.documentId, progress.lineId, progress.productVerified, progress.cellCode, progress.quantity, progress.quantityVerified, progress.updatedAt].join("|");
        if (fingerprint !== lastFingerprint) {
          lastFingerprint = fingerprint;
          apply(progress);
        } else {
          apply(progress);
        }
      } catch {
        // Наблюдение за вторым устройством не должно блокировать локальную выдачу.
      }
    };

    void load();
    const timer = window.setInterval(() => void load(), 650);
    const observer = new MutationObserver(() => void load());
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      stopped = true;
      window.clearInterval(timer);
      observer.disconnect();
    };
  }, []);

  return null;
}
