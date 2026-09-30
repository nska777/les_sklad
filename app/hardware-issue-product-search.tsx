"use client";

import { useEffect } from "react";

type Product = {
  id: string;
  name: string;
  sku: string;
  barcode: string;
  unit: string;
};

type Snapshot = {
  products?: Product[];
};

const normalize = (value: string) => value.trim().toLocaleLowerCase("ru-RU");

function selectedLabel(select: HTMLSelectElement) {
  const option = Array.from(select.options).find((item) => item.value === select.value);
  return option?.value ? option.textContent?.trim() || "" : "";
}

export function HardwareIssueProductSearch() {
  useEffect(() => {
    if (window.location.pathname !== "/warehouse") return;

    let products: Product[] = [];
    let stopped = false;

    const readProducts = (snapshot?: Snapshot) => {
      if (Array.isArray(snapshot?.products)) products = snapshot.products;
    };

    void fetch("/api/warehouse", { cache: "no-store" })
      .then((response) => response.json() as Promise<Snapshot>)
      .then((snapshot) => { if (!stopped) readProducts(snapshot); })
      .catch(() => undefined);

    const onSnapshot = (event: Event) => readProducts((event as CustomEvent<Snapshot>).detail);
    window.addEventListener("hardware:live-snapshot", onSnapshot as EventListener);

    const enhance = (select: HTMLSelectElement) => {
      if (select.dataset.hwSearchEnhanced === "1") return;
      select.dataset.hwSearchEnhanced = "1";
      select.required = false;

      const nativeWrapper = select.closest<HTMLElement>("[data-slot='native-select-wrapper']");
      if (nativeWrapper) {
        nativeWrapper.style.width = "100%";
        nativeWrapper.style.maxWidth = "760px";
        const nativeIcon = nativeWrapper.querySelector<HTMLElement>("[data-slot='native-select-icon']");
        if (nativeIcon) nativeIcon.style.display = "none";
      }

      const host = document.createElement("div");
      host.dataset.hwProductSearch = "1";
      host.className = "relative w-full max-w-[760px]";

      const inputWrap = document.createElement("div");
      inputWrap.className = "relative w-full";

      const input = document.createElement("input");
      input.type = "text";
      input.autocomplete = "off";
      input.spellcheck = false;
      input.placeholder = "Начните писать название, артикул или штрихкод…";
      input.className = "flex h-10 w-full rounded-xl border border-input bg-transparent px-3 py-2 pr-10 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";
      input.value = selectedLabel(select);

      const arrow = document.createElement("button");
      arrow.type = "button";
      arrow.setAttribute("aria-label", "Открыть список материалов");
      arrow.setAttribute("aria-expanded", "false");
      arrow.className = "absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus:outline-none";

      const hint = document.createElement("div");
      hint.className = "mt-1 text-[11px] text-slate-500";
      hint.textContent = "Поиск по названию, RL-артикулу или штрихкоду";

      const list = document.createElement("div");
      list.className = "absolute left-0 right-0 z-[90] mt-1 hidden max-h-80 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl";

      const setArrowState = (opened: boolean) => {
        arrow.setAttribute("aria-expanded", opened ? "true" : "false");
        arrow.setAttribute("aria-label", opened ? "Закрыть список материалов" : "Открыть список материалов");
        arrow.innerHTML = opened
          ? '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true" class="h-4 w-4"><path d="M6 12l4-4 4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
          : '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true" class="h-4 w-4"><path d="M6 8l4 4 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      };

      const close = () => {
        list.classList.add("hidden");
        setArrowState(false);
      };

      const render = () => {
        const query = normalize(input.value);
        const optionRows = Array.from(select.options).filter((option) => option.value);
        const matches = optionRows.filter((option) => {
          if (!query) return true;
          const product = products.find((item) => item.id === option.value);
          const haystack = normalize([
            option.textContent || "",
            product?.name || "",
            product?.sku || "",
            product?.barcode || "",
          ].join(" "));
          return haystack.includes(query);
        }).slice(0, 40);

        list.replaceChildren();
        if (!matches.length) {
          const empty = document.createElement("div");
          empty.className = "px-3 py-4 text-center text-sm text-slate-500";
          empty.textContent = "Материал не найден";
          list.appendChild(empty);
          return;
        }

        for (const option of matches) {
          const product = products.find((item) => item.id === option.value);
          const button = document.createElement("button");
          button.type = "button";
          button.className = "block w-full rounded-lg px-3 py-2.5 text-left hover:bg-blue-50 focus:bg-blue-50 focus:outline-none";

          const title = document.createElement("div");
          title.className = "text-sm font-semibold text-slate-900";
          title.textContent = product?.name || (option.textContent || "").split(" · остаток")[0] || "Материал";
          button.appendChild(title);

          const meta = document.createElement("div");
          meta.className = "mt-0.5 text-xs text-slate-500";
          const details = [product?.sku, product?.barcode].filter(Boolean).join(" · ");
          const stockText = (option.textContent || "").includes("остаток")
            ? (option.textContent || "").split("· остаток")[1]?.trim()
            : "";
          meta.textContent = [details, stockText ? `остаток ${stockText}` : ""].filter(Boolean).join(" · ");
          button.appendChild(meta);

          button.addEventListener("mousedown", (event) => event.preventDefault());
          button.addEventListener("click", () => {
            select.value = option.value;
            select.dispatchEvent(new Event("change", { bubbles: true }));
            input.value = option.textContent?.trim() || product?.name || "";
            close();
          });
          list.appendChild(button);
        }
      };

      const open = () => {
        render();
        list.classList.remove("hidden");
        setArrowState(true);
      };

      setArrowState(false);

      input.addEventListener("focus", () => {
        if (list.classList.contains("hidden")) open();
      });
      input.addEventListener("input", () => {
        if (select.value) {
          select.value = "";
          select.dispatchEvent(new Event("change", { bubbles: true }));
        }
        open();
      });
      input.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close();
        }
        if (event.key === "Enter") {
          const first = list.querySelector("button");
          if (first instanceof HTMLButtonElement) {
            event.preventDefault();
            first.click();
          }
        }
      });
      input.addEventListener("blur", () => {
        window.setTimeout(() => close(), 120);
      });
      arrow.addEventListener("mousedown", (event) => event.preventDefault());
      arrow.addEventListener("click", () => {
        if (list.classList.contains("hidden")) {
          input.focus();
          open();
        } else {
          close();
        }
      });
      select.addEventListener("change", () => {
        input.value = selectedLabel(select);
      });

      select.style.display = "none";

      select.parentElement?.insertBefore(host, select);
      inputWrap.appendChild(input);
      inputWrap.appendChild(arrow);
      host.appendChild(inputWrap);
      host.appendChild(list);
      host.appendChild(hint);
    };

    const mount = () => {
      if (window.location.pathname !== "/warehouse") return;
      const title = Array.from(document.querySelectorAll("h2")).find((node) => node.textContent?.trim() === "Сформировать документ");
      const form = title?.closest("form");
      if (!form) return;

      const selects = Array.from(form.querySelectorAll("select"))
        .map((node) => node as HTMLSelectElement)
        .filter((select) => Array.from(select.options).some((option) => option.textContent?.trim() === "Выберите материал"));
      selects.forEach(enhance);
    };

    mount();
    const observer = new MutationObserver(() => mount());
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = window.setInterval(mount, 1200);

    return () => {
      stopped = true;
      observer.disconnect();
      window.clearInterval(timer);
      window.removeEventListener("hardware:live-snapshot", onSnapshot as EventListener);
    };
  }, []);

  return null;
}
