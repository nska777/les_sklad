"use client";

import { useEffect } from "react";

type Cell = { id: string; code: string };
type Stock = { cellId: string; quantity: number; productName: string; sku: string; unit: string };
type RackLayoutResult = { cells?: Cell[]; stocks?: Stock[] };

type Occupancy = {
  productName: string;
  sku: string;
  quantity: number;
  unit: string;
};

function qty(value: number) {
  return Number(value || 0).toLocaleString("ru-RU", { maximumFractionDigits: 3 });
}

export function OnecCellOccupancyGuard() {
  useEffect(() => {
    let stopped = false;
    let timer = 0;
    let loading = false;
    let lastPath = window.location.pathname;

    const apply = async () => {
      if (stopped || loading || window.location.pathname !== "/onec-materials") return;

      const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'));
      const dialog = dialogs.find((node) =>
        node.textContent?.includes("Разместить материал") ||
        node.textContent?.includes("Материал размещён"),
      );
      if (!dialog) return;

      loading = true;
      try {
        const response = await fetch("/api/rack-layout", { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json() as RackLayoutResult;
        const cellByCode = new Map((data.cells || []).map((cell) => [cell.code, cell]));
        const occupied = new Map<string, Occupancy[]>();

        for (const stock of data.stocks || []) {
          if (Number(stock.quantity) <= 0) continue;
          const rows = occupied.get(stock.cellId) || [];
          rows.push({
            productName: stock.productName,
            sku: stock.sku,
            quantity: Number(stock.quantity),
            unit: stock.unit || "шт.",
          });
          occupied.set(stock.cellId, rows);
        }

        const buttons = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button"));
        let freeCount = 0;
        let occupiedCount = 0;

        for (const button of buttons) {
          const codeNode = button.querySelector<HTMLElement>("b.font-mono");
          const code = codeNode?.textContent?.trim();
          if (!code) continue;
          const cell = cellByCode.get(code);
          if (!cell) continue;

          button.querySelector('[data-occupancy-note="true"]')?.remove();
          button.disabled = false;
          button.removeAttribute("aria-disabled");
          button.classList.remove("cursor-not-allowed", "border-red-300", "bg-red-50", "text-red-900", "opacity-80");
          button.title = "Свободная ячейка";

          const contents = occupied.get(cell.id) || [];
          if (!contents.length) {
            freeCount += 1;
            const note = document.createElement("div");
            note.dataset.occupancyNote = "true";
            note.className = "mt-1 text-[10px] font-semibold leading-tight text-emerald-700";
            note.textContent = "Свободна";
            button.appendChild(note);
            continue;
          }

          occupiedCount += 1;
          button.disabled = true;
          button.setAttribute("aria-disabled", "true");
          button.classList.add("cursor-not-allowed", "border-red-300", "bg-red-50", "text-red-900", "opacity-80");
          button.title = `Ячейка занята: ${contents.map((item) => `${item.productName} — ${qty(item.quantity)} ${item.unit}`).join(", ")}`;

          const note = document.createElement("div");
          note.dataset.occupancyNote = "true";
          note.className = "mt-1 text-[10px] font-semibold leading-tight text-red-700";
          note.textContent = `Занята: ${contents.map((item) => `${item.productName} · ${qty(item.quantity)} ${item.unit}`).join(", ")}`;
          button.appendChild(note);
        }

        const cellLabel = Array.from(dialog.querySelectorAll<HTMLElement>("label")).find((node) => node.textContent?.trim() === "Ячейка");
        if (cellLabel) {
          let legend = dialog.querySelector<HTMLElement>('[data-occupancy-legend="true"]');
          if (!legend) {
            legend = document.createElement("div");
            legend.dataset.occupancyLegend = "true";
            legend.className = "mt-2 flex flex-wrap gap-2 text-[11px] font-semibold";
            cellLabel.parentElement?.insertBefore(legend, cellLabel.nextSibling);
          }
          legend.innerHTML = `<span class="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700">Свободно: ${freeCount}</span><span class="rounded-full bg-red-50 px-2 py-1 text-red-700">Занято: ${occupiedCount}</span>`;
        }
      } catch {
        // Сервер всё равно повторно проверяет занятость перед размещением.
      } finally {
        loading = false;
      }
    };

    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void apply(), 120);
    };

    const observer = new MutationObserver(() => {
      const path = window.location.pathname;
      if (path !== lastPath) lastPath = path;
      schedule();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const navigationPoll = window.setInterval(() => {
      const path = window.location.pathname;
      if (path !== lastPath) {
        lastPath = path;
        schedule();
      }
    }, 250);

    schedule();

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      window.clearInterval(navigationPoll);
      observer.disconnect();
    };
  }, []);

  return null;
}
