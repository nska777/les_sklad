"use client";

import { useEffect } from "react";

const CATEGORIES = ["Дерево", "ДСП", "ЛДСП", "МДФ", "ЛМДФ", "ДВП", "Фанера", "Шпон"];
const UNIT_SUGGESTIONS = ["м²", "шт.", "лист"];

function generatedSku() {
  const now = new Date();
  const date = `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const tail = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `LDSP-${date}-${tail}`;
}

function wrapOf(el: Element | null) {
  return el?.closest("div") as HTMLElement | null;
}

function setLabel(form: HTMLFormElement, name: string, text: string) {
  const field = form.elements.namedItem(name);
  if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement)) return;
  const label = wrapOf(field)?.querySelector("label");
  if (label) label.textContent = text;
}

function removeField(form: HTMLFormElement, name: string) {
  const field = form.elements.namedItem(name);
  if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement) wrapOf(field)?.remove();
}

function replaceCategory(form: HTMLFormElement) {
  const current = form.elements.namedItem("category");
  if (!(current instanceof HTMLInputElement)) return;
  const select = document.createElement("select");
  select.name = "category";
  select.className = current.className;
  select.required = true;
  select.innerHTML = `<option value="">Выберите категорию</option>${CATEGORIES.map((x) => `<option value="${x}">${x}</option>`).join("")}`;
  current.replaceWith(select);
}

function replaceUnit(form: HTMLFormElement) {
  const current = form.elements.namedItem("unit");
  if (!(current instanceof HTMLSelectElement || current instanceof HTMLInputElement)) return;
  const input = document.createElement("input");
  input.name = "unit";
  input.required = true;
  input.className = current.className;
  input.setAttribute("list", "ldsp-unit-suggestions");
  input.placeholder = "м², шт., лист или своё";
  input.value = current instanceof HTMLSelectElement ? "" : current.value;

  let list = document.getElementById("ldsp-unit-suggestions") as HTMLDataListElement | null;
  if (!list) {
    list = document.createElement("datalist");
    list.id = "ldsp-unit-suggestions";
    UNIT_SUGGESTIONS.forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      list!.appendChild(option);
    });
    document.body.appendChild(list);
  }
  current.replaceWith(input);
}

function tuneSku(form: HTMLFormElement) {
  const sku = form.elements.namedItem("sku");
  if (!(sku instanceof HTMLInputElement)) return;
  sku.placeholder = "Сгенерируйте артикул кнопкой справа";
  const old = wrapOf(sku)?.querySelector<HTMLButtonElement>('button[aria-label="Сгенерировать артикул"]');
  if (!old) return;
  const button = old.cloneNode(true) as HTMLButtonElement;
  old.replaceWith(button);
  button.addEventListener("click", () => {
    sku.value = generatedSku();
    sku.dispatchEvent(new Event("input", { bubbles: true }));
    sku.focus();
  });
}

function enhanceLdspForm(form: HTMLFormElement) {
  if (form.dataset.ldspEnhanced === "1") return;
  const title = form.querySelector("h3")?.textContent?.trim();
  if (title !== "Добавить материал вручную") return;
  form.dataset.ldspEnhanced = "1";

  // Убираем поля, относящиеся к складу краски и начальному остатку.
  ["oneCId", "subcategory", "imageUrl", "packSize", "minStock", "packType", "initialQuantity"].forEach((name) => removeField(form, name));

  replaceCategory(form);
  replaceUnit(form);

  setLabel(form, "name", "Название *");
  setLabel(form, "sku", "Артикул");
  setLabel(form, "category", "Категория *");
  setLabel(form, "brand", "Поставщик");
  setLabel(form, "ral", "Материал");
  setLabel(form, "color", "Цвет");
  setLabel(form, "unit", "Единица измерения *");
  setLabel(form, "comment", "Комментарий *");

  const placeholders: Record<string, string> = {
    name: "Например: ЛДСП дуб сонома 16 мм",
    brand: "Название поставщика",
    ral: "Например: древесная плита / берёза / дуб",
    color: "Например: дуб сонома",
    comment: "Краткий комментарий к материалу",
  };
  Object.entries(placeholders).forEach(([name, value]) => {
    const field = form.elements.namedItem(name);
    if (field instanceof HTMLInputElement) field.placeholder = value;
  });

  const comment = form.elements.namedItem("comment");
  if (comment instanceof HTMLInputElement) comment.required = true;
  const name = form.elements.namedItem("name");
  if (name instanceof HTMLInputElement) name.required = true;

  tuneSku(form);
}

function isLdspPath() {
  return window.location.pathname.startsWith("/department/ldsp");
}

export function DepartmentLdspMaterialsEnhancer() {
  useEffect(() => {
    if (!isLdspPath()) return;

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const isDepartmentApi = url.includes("/api/department-warehouse") || url.includes("/api/department-warehouse-controls") || url.includes("/api/department-warehouse-receipt") || url.includes("/api/department-warehouse-maintenance") || url.includes("/api/department-ldsp-layout");
      if (!isDepartmentApi) return originalFetch(input, init);

      const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
      headers.set("x-warehouse-code", "ldsp");
      return originalFetch(input, { ...init, headers });
    };

    const run = () => document.querySelectorAll<HTMLFormElement>("form").forEach(enhanceLdspForm);
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
