"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Search } from "lucide-react";

type ProductOption = { value: string; label: string };

function findAddMaterialSection() {
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'));
  for (const dialog of dialogs) {
    const heading = Array.from(dialog.querySelectorAll<HTMLElement>("h1,h2,h3")).find((node) =>
      node.textContent?.includes("Добавить материал в эту ячейку"),
    );
    if (!heading) continue;

    const section = heading.closest("section") as HTMLElement | null;
    if (!section) continue;

    const select = section.querySelector<HTMLSelectElement>("select");
    if (!select) continue;

    const parent = select.parentElement;
    return { section, select, parent };
  }

  return { section: null as HTMLElement | null, select: null as HTMLSelectElement | null, parent: null as HTMLElement | null };
}

export function RackProductSearchEnhancer() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [select, setSelect] = useState<HTMLSelectElement | null>(null);
  const [options, setOptions] = useState<ProductOption[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState("");

  useEffect(() => {
    const resolve = () => {
      const found = findAddMaterialSection();
      if (!found.select || !found.parent) {
        setTarget(null);
        setSelect(null);
        return;
      }

      found.select.style.display = "none";
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
    <div className="relative w-full">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
        <input
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && filtered[0]) {
              event.preventDefault();
              choose(filtered[0]);
            }
            if (event.key === "Escape") setOpen(false);
          }}
          placeholder={selectedLabel || "Поиск материала по названию или RL-коду"}
          className="h-10 w-full rounded-xl border border-black/10 bg-white pl-10 pr-3 text-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
        />
      </div>

      {selectedLabel && !query && (
        <div className="mt-1.5 truncate text-xs font-medium text-slate-500">Выбрано: {selectedLabel}</div>
      )}

      {open && (
        <div className="absolute left-0 right-0 top-[46px] z-[220] max-h-72 overflow-y-auto rounded-xl border border-black/10 bg-white p-1.5 shadow-2xl">
          {filtered.length ? filtered.map((option) => (
            <button
              type="button"
              key={option.value}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(option)}
              className="block w-full rounded-lg px-3 py-2.5 text-left text-sm hover:bg-blue-50"
            >
              {option.label}
            </button>
          )) : (
            <div className="px-3 py-4 text-center text-sm text-slate-500">Материал не найден</div>
          )}
        </div>
      )}
    </div>,
    target,
  );
}
