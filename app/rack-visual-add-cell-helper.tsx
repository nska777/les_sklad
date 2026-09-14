"use client";

import { useEffect } from "react";
import { toast } from "sonner";

const ROW_SELECTOR = "[data-rack-editor-row]";
const BUTTON_MARK = "data-rack-add-cell-button";

function getAnchorCode(row: HTMLElement) {
  const code = row.querySelector<HTMLElement>("[class*='font-mono']")?.textContent?.trim() || "";
  return code;
}

function mountButton(row: HTMLElement) {
  if (row.parentElement?.querySelector(`[${BUTTON_MARK}]`)) return;
  const parent = row.parentElement;
  if (!parent) return;

  parent.style.position = "relative";

  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute(BUTTON_MARK, "1");
  button.className = "absolute left-2 bottom-2 z-50 inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50/95 px-2.5 py-1.5 text-[11px] font-black text-emerald-700 shadow-sm backdrop-blur transition hover:bg-emerald-100 disabled:cursor-wait disabled:opacity-50";
  button.innerHTML = '<span class="text-base leading-none">＋</span><span>Добавить ячейку</span>';

  button.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
  });

  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();

    const anchorCode = getAnchorCode(row);
    if (!anchorCode) {
      toast.error("Не удалось определить полку");
      return;
    }

    button.disabled = true;
    const previous = button.innerHTML;
    button.textContent = "Добавляю…";

    try {
      const response = await fetch("/api/rack-layout/visual/add-cell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anchorCode, operator: "Визуальный редактор" }),
      });
      const body = await response.json() as { error?: string; cell?: { code?: string } };
      if (!response.ok) throw new Error(body.error || "Не удалось добавить ячейку");

      toast.success(`Ячейка ${body.cell?.code || "добавлена"}`, {
        description: "Схема обновляется…",
      });
      window.setTimeout(() => window.location.reload(), 250);
    } catch (error) {
      button.disabled = false;
      button.innerHTML = previous;
      toast.error(error instanceof Error ? error.message : "Не удалось добавить ячейку");
    }
  });

  parent.appendChild(button);
}

function scanRows() {
  document.querySelectorAll<HTMLElement>(ROW_SELECTOR).forEach(mountButton);
}

export function RackVisualAddCellHelper() {
  useEffect(() => {
    scanRows();
    const observer = new MutationObserver(() => scanRows());
    observer.observe(document.body, { subtree: true, childList: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
