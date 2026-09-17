"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type Rack = { id: string; name: string; code: string };
type Cell = {
  id: string;
  rackId: string;
  code: string;
  rowIndex: number;
  columnIndex: number;
  blocked: boolean;
  side: "front" | "back";
};
type RackData = { racks: Rack[]; cells: Cell[] };
type RackApiPayload = { racks?: unknown; cells?: unknown };

type MoveTarget = {
  parent: HTMLElement | null;
  select: HTMLSelectElement | null;
  sourceCellCode: string;
};

function findMoveDestination(): MoveTarget {
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));

  for (const dialogNode of dialogs) {
    if (!(dialogNode instanceof HTMLElement)) continue;

    const headings = Array.from(dialogNode.querySelectorAll("h1,h2,h3"));
    const heading = headings.find(
      (node) => node instanceof HTMLElement && /^Переместить из\s+/i.test(node.textContent?.trim() || ""),
    );
    if (!(heading instanceof HTMLElement)) continue;

    const section = heading.closest("section");
    if (!(section instanceof HTMLElement)) continue;

    const labels = Array.from(section.querySelectorAll("label"));
    const destinationLabel = labels.find((node) => node.textContent?.trim() === "Новая ячейка");
    if (!(destinationLabel instanceof HTMLElement)) continue;

    const wrapper = destinationLabel.parentElement;
    if (!(wrapper instanceof HTMLElement)) continue;

    const selectNode = wrapper.querySelector("select");
    if (!(selectNode instanceof HTMLSelectElement)) continue;

    const sourceCellCode = heading.textContent?.trim().replace(/^Переместить из\s+/i, "") || "";
    return { parent: wrapper, select: selectNode, sourceCellCode };
  }

  return { parent: null, select: null, sourceCellCode: "" };
}

export function RackMoveDestinationEnhancer() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [nativeSelect, setNativeSelect] = useState<HTMLSelectElement | null>(null);
  const [sourceCellCode, setSourceCellCode] = useState("");
  const [data, setData] = useState<RackData>({ racks: [], cells: [] });
  const [rackId, setRackId] = useState("");
  const [rowIndex, setRowIndex] = useState("");
  const [cellId, setCellId] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/rack-layout", { cache: "no-store" })
      .then((response) => response.json() as Promise<unknown>)
      .then((result) => {
        if (!active) return;
        const payload = result as RackApiPayload;
        setData({
          racks: Array.isArray(payload.racks) ? payload.racks as Rack[] : [],
          cells: Array.isArray(payload.cells) ? payload.cells as Cell[] : [],
        });
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const resolve = () => {
      const found = findMoveDestination();
      if (!found.parent || !found.select) {
        setTarget(null);
        setNativeSelect(null);
        return;
      }

      found.select.style.display = "none";
      setTarget(found.parent);
      setNativeSelect(found.select);
      setSourceCellCode(found.sourceCellCode);
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
    setRackId("");
    setRowIndex("");
    setCellId("");
  }, [sourceCellCode]);

  const sourceCell = useMemo(
    () => data.cells.find((cell) => cell.code.toLowerCase() === sourceCellCode.toLowerCase()),
    [data.cells, sourceCellCode],
  );

  const availableCells = useMemo(
    () => data.cells.filter((cell) => !cell.blocked && cell.id !== sourceCell?.id),
    [data.cells, sourceCell?.id],
  );

  const availableRacks = useMemo(
    () => data.racks.filter((rack) => availableCells.some((cell) => cell.rackId === rack.id)),
    [data.racks, availableCells],
  );

  const shelves = useMemo(() => {
    if (!rackId) return [] as number[];
    return Array.from(new Set(availableCells.filter((cell) => cell.rackId === rackId).map((cell) => cell.rowIndex))).sort((a, b) => a - b);
  }, [rackId, availableCells]);

  const destinationCells = useMemo(() => {
    if (!rackId || rowIndex === "") return [] as Cell[];
    const row = Number(rowIndex);
    return availableCells
      .filter((cell) => cell.rackId === rackId && cell.rowIndex === row)
      .sort((a, b) => {
        if (a.side !== b.side) return a.side === "front" ? -1 : 1;
        return a.columnIndex - b.columnIndex;
      });
  }, [rackId, rowIndex, availableCells]);

  if (!target || !nativeSelect) return null;

  const chooseCell = (value: string) => {
    setCellId(value);
    nativeSelect.value = value;
    nativeSelect.dispatchEvent(new Event("change", { bubbles: true }));
  };

  return createPortal(
    <div className="mt-2 grid gap-3 sm:grid-cols-3 sm:col-span-2">
      <div>
        <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">1. Стеллаж</div>
        <select
          value={rackId}
          onChange={(event) => {
            setRackId(event.target.value);
            setRowIndex("");
            chooseCell("");
          }}
          className="h-11 w-full rounded-xl border border-black/10 bg-white px-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
        >
          <option value="">Выберите стеллаж</option>
          {availableRacks.map((rack) => <option key={rack.id} value={rack.id}>{rack.code} · {rack.name}</option>)}
        </select>
      </div>

      <div>
        <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">2. Полка</div>
        <select
          value={rowIndex}
          disabled={!rackId}
          onChange={(event) => {
            setRowIndex(event.target.value);
            chooseCell("");
          }}
          className="h-11 w-full rounded-xl border border-black/10 bg-white px-3 text-sm outline-none disabled:bg-slate-100 disabled:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
        >
          <option value="">{rackId ? "Выберите полку" : "Сначала стеллаж"}</option>
          {shelves.map((row) => <option key={row} value={row}>Полка {row + 1}</option>)}
        </select>
      </div>

      <div>
        <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">3. Ячейка</div>
        <select
          value={cellId}
          disabled={!rackId || rowIndex === ""}
          onChange={(event) => chooseCell(event.target.value)}
          className="h-11 w-full rounded-xl border border-black/10 bg-white px-3 text-sm outline-none disabled:bg-slate-100 disabled:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
        >
          <option value="">{rowIndex === "" ? "Сначала полка" : "Выберите ячейку"}</option>
          {destinationCells.map((cell) => (
            <option key={cell.id} value={cell.id}>
              {cell.code} · {cell.side === "front" ? "Лицевая" : "Задняя"} · место {String.fromCharCode(65 + cell.columnIndex)}
            </option>
          ))}
        </select>
      </div>

      <div className="sm:col-span-3 rounded-xl bg-blue-50 px-3 py-2 text-xs text-blue-800">
        Показываются только существующие и доступные ячейки выбранного стеллажа и полки.
      </div>
    </div>,
    target,
  );
}
