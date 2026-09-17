"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search } from "lucide-react";

type ProductOption = { value: string; label: string };

type SearchTarget = {
  select: HTMLSelectElement | null;
  parent: HTMLElement | null;
};

function findAddMaterialSection(): SearchTarget {
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));

  for (const dialogNode of dialogs) {
    if (!(dialogNode instanceof HTMLElement)) continue;

    const headings = Array.from(dialogNode.querySelectorAll("h1,h2,h3"));
    const heading = headings.find(
      (node) => node instanceof HTMLElement && node.textContent?.includes("Добавить материал в эту ячейку"),
    );
    if (!(heading instanceof HTMLElement)) continue;

    const section = heading.closest("section");
    if (!(section instanceof HTMLElement)) continue;

    const selectNode = section.querySelector("select");
    if (!(selectNode instanceof HTMLSelectElement)) continue;

    const parent = selectNode.parentElement;
    if (!(parent instanceof HTMLElement)) continue;

    return { select: selectNode, parent };
  }

  return { select: null, parent: null };
}

export function RackProductSearchEnhancer() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [select, setSelect] = useState<HTMLSelectElement | null>(null);
  const [options, setOptions] = useState<ProductOption[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState("");
  const searchRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const resolve = () => {
      const found = findAddMaterialSection();
      if (!found.select || !found.parent) {
        setTarget(null);
        setSelect(null);
        return;
      }

      found.select.style.display = "none";
      found.parent.style.gridColumn = "1 / -1";
      found.parent.style.width = "100%";
      setTarget(found.parent);
      setSelect(found.select);
      setOptions(
        Array.from(found.select.options)
          .filter((option) => option.value)
          .map((option) => ({ value: option.value, label: option.textContent?.trim() || option.value })),
      );

      const current = found.select.options[found.select.selectedIndex];
      setSelectedLabel(current?.value ? current.textContent?.trim() || "" : "");
    };

    resolve();
    const observer = new MutationObserver(resolve);
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    const timer = window.setInterval(resolve, 700);

    return () => {
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const node = event.target as Node | null;
      if (node && searchRef.current?.contains(node)) return;
      setOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [open]);

  if (!target || !select) return null;

  const normalized = query.trim().toLowerCase();
  const filtered = options
    .filter((option) => !normalized || option.label.toLowerCase().includes(normalized))
    .slice(0, 40);

  const choose = (option: ProductOption) => {
    select.value = option.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    setSelectedLabel(option.label);
    setQuery("");
    setOpen(false);
  };

  return createPortal(
    <div ref={searchRef} className="relative w-full min-w-0">
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
        <input
          value={query}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && filtered[0]) {
              event.preventDefault();
              choose(filtered[0]);
            }
            if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
            }
          }}
          placeholder={selectedLabel || "Поиск материала по названию, RL-коду или штрихкоду"}
          className="h-12 w-full rounded-xl border border-black/10 bg-white pl-11 pr-4 text-base outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          autoComplete="off"
        />
      </div>

      {selectedLabel && !query && (
        <div className="mt-2 truncate text-sm font-medium text-slate-500">Выбрано: {selectedLabel}</div>
      )}

      {open && (
        <div className="absolute left-0 right-0 top-[54px] z-[260] max-h-80 overflow-y-auto rounded-xl border border-black/10 bg-white p-2 shadow-2xl">
          {filtered.length ? filtered.map((option) => (
            <button
              type="button"
              key={option.value}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => choose(option)}
              className="block w-full rounded-lg px-4 py-3 text-left text-sm hover:bg-blue-50"
            >
              {option.label}
            </button>
          )) : (
            <div className="px-4 py-5 text-center text-sm text-slate-500">Материал не найден</div>
          )}
        </div>
      )}
    </div>,
    target,
  );
}
