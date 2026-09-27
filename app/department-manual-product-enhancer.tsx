"use client";

import { useEffect } from "react";
import { toast } from "sonner";

const GENERATED_PREFIX = "PAINT";

function generatedSku() {
  const now = new Date();
  const date = `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const tail = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${GENERATED_PREFIX}-${date}-${tail}`;
}

function fieldWrap(input: HTMLInputElement | HTMLSelectElement) {
  return input.closest("div");
}

function enhance(form: HTMLFormElement) {
  if (form.dataset.manualProductEnhanced === "1") return;
  const title = form.querySelector("h3")?.textContent?.trim();
  if (title !== "Добавить материал вручную") return;

  form.dataset.manualProductEnhanced = "1";

  const removeNames = ["oneCId", "subcategory", "imageUrl"];
  for (const name of removeNames) {
    const input = form.elements.namedItem(name);
    if (input instanceof HTMLInputElement || input instanceof HTMLSelectElement) fieldWrap(input)?.remove();
  }

  const placeholders: Record<string, string> = {
    name: "Например: Краска акриловая",
    sku: "Сгенерируйте артикул кнопкой справа",
    category: "Например: Лакокрасочные материалы",
    brand: "Например: Sayerlack",
    color: "Например: Белый",
    ral: "Например: 9016",
    packSize: "Например: 20",
    minStock: "Например: 5",
    comment: "Например: Добавлено после фактической приёмки",
  };

  for (const [name, placeholder] of Object.entries(placeholders)) {
    const input = form.elements.namedItem(name);
    if (input instanceof HTMLInputElement) input.placeholder = placeholder;
  }

  const comment = form.elements.namedItem("comment");
  if (comment instanceof HTMLInputElement) {
    comment.required = true;
    comment.setAttribute("aria-required", "true");
    const label = fieldWrap(comment)?.querySelector("label");
    if (label && !label.textContent?.includes("*")) label.textContent = "Комментарий *";
  }

  const sku = form.elements.namedItem("sku");
  if (sku instanceof HTMLInputElement) {
    sku.required = true;
    sku.setAttribute("aria-required", "true");
    sku.style.paddingRight = "3rem";

    const wrap = fieldWrap(sku);
    if (wrap) {
      wrap.style.position = "relative";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "absolute right-2 bottom-[7px] grid h-7 w-7 place-items-center rounded-lg border border-slate-200 bg-white text-sm font-black text-slate-600 shadow-sm transition hover:border-orange-300 hover:text-orange-600";
      button.title = "Сгенерировать артикул";
      button.setAttribute("aria-label", "Сгенерировать артикул");
      button.textContent = "↻";
      button.addEventListener("click", () => {
        sku.value = generatedSku();
        sku.dispatchEvent(new Event("input", { bubbles: true }));
        sku.focus();
      });
      wrap.appendChild(button);
    }
  }

  form.addEventListener("submit", (event) => {
    const name = form.elements.namedItem("name");
    const skuInput = form.elements.namedItem("sku");
    const commentInput = form.elements.namedItem("comment");
    if (!(name instanceof HTMLInputElement) || !name.value.trim()) return;
    if (!(skuInput instanceof HTMLInputElement) || !skuInput.value.trim()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      toast.error("Сгенерируйте или укажите артикул");
      skuInput instanceof HTMLInputElement && skuInput.focus();
      return;
    }
    if (!(commentInput instanceof HTMLInputElement) || !commentInput.value.trim()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      toast.error("Комментарий обязателен", { description: "Укажите причину добавления материала." });
      commentInput instanceof HTMLInputElement && commentInput.focus();
    }
  }, true);

  const submitButton = form.querySelector<HTMLButtonElement>('button[type="submit"], button:not([type])');
  if (submitButton) submitButton.title = "Добавление будет зафиксировано во вкладке «Движения»";
}

function cleanMaterialTable(root: ParentNode = document) {
  root.querySelectorAll("th").forEach((th) => {
    if (th.textContent?.trim() === "Артикул / 1С") th.textContent = "Артикул";
  });
  root.querySelectorAll("td").forEach((td) => {
    const lines = Array.from(td.querySelectorAll("div"));
    for (const line of lines) {
      const text = line.textContent?.trim() || "";
      if (text === "без ID 1С") line.remove();
    }
  });
}

export function DepartmentManualProductEnhancer() {
  useEffect(() => {
    const originalFetch = window.fetch.bind(window);

    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const response = await originalFetch(...args);
      try {
        const input = args[0];
        const init = args[1];
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes("/api/department-warehouse") && !url.includes("/api/department-warehouse-audit") && init?.method?.toUpperCase() === "POST" && response.ok && typeof init.body === "string") {
          const payload = JSON.parse(init.body) as Record<string, unknown>;
          if (payload.action === "createProduct") {
            const body = await response.clone().json() as { id?: string };
            if (body.id) {
              void originalFetch("/api/department-warehouse-audit", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "productCreated", productId: body.id, comment: payload.comment || "" }),
              });
            }
          }
          if (payload.action === "inventorySnapshot") {
            const body = await response.clone().json() as { id?: string };
            void originalFetch("/api/department-warehouse-audit", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "inventoryCreated", inventoryId: body.id || "", comment: payload.comment || "" }),
            });
          }
        }
      } catch {
        // Основная операция уже выполнена; ошибка аудита не должна останавливать склад.
      }
      return response;
    };

    const run = () => {
      if (!window.location.pathname.startsWith("/department/")) return;
      document.querySelectorAll<HTMLFormElement>("form").forEach(enhance);
      cleanMaterialTable();
    };
    run();
    const observer = new MutationObserver(run);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      window.fetch = originalFetch;
    };
  }, []);

  return null;
}
