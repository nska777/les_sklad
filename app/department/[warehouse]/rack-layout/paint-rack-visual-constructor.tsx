"use client";

import { PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Rack = { id: string; name: string; code: string; rows: number; columns: number; width: number; depth: number };
type Cell = { id: string; rackId: string; code: string; rowIndex: number; columnIndex: number; cellWidth?: number; cellHeight?: number; cellDepth?: number };
type Stock = { productId: string; cellId: string; quantity: number };
type DraftCell = Cell & { width: number; height: number; depth: number };

type Props = {
  open: boolean;
  rack: Rack | null;
  cells: Cell[];
  stocks: Stock[];
  onClose: () => void;
  onChanged: () => Promise<void> | void;
};

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function PaintRackVisualConstructor({ open, rack, cells, stocks, onClose, onChanged }: Props) {
  const [draft, setDraft] = useState<DraftCell[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const rowRefs = useRef(new Map<number, HTMLDivElement>());

  useEffect(() => {
    if (!open || !rack) return;
    const rackCells = cells
      .filter((c) => c.rackId === rack.id)
      .map((c) => ({
        ...c,
        width: Number(c.cellWidth || Math.max(.4, rack.width / Math.max(1, rack.columns))),
        height: Number(c.cellHeight || 1.1),
        depth: Number(c.cellDepth || rack.depth || 1.2),
      }));
    setDraft(rackCells);
    setSelectedId("");
  }, [open, rack, cells]);

  const rows = useMemo(() => {
    const groups = new Map<number, DraftCell[]>();
    draft.forEach((cell) => {
      const row = groups.get(cell.rowIndex) || [];
      row.push(cell);
      groups.set(cell.rowIndex, row);
    });
    return [...groups.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([rowIndex, rowCells]) => ({ rowIndex, cells: rowCells.sort((a, b) => a.columnIndex - b.columnIndex) }));
  }, [draft]);

  const selected = draft.find((c) => c.id === selectedId) || null;
  const hasStock = (cellId: string) => stocks.some((s) => s.cellId === cellId && Number(s.quantity) > 0);

  const patchCell = (id: string, patch: Partial<Pick<DraftCell, "width" | "height" | "depth">>) => {
    setDraft((cur) => cur.map((c) => c.id === id ? { ...c, ...patch } : c));
  };

  const patchRowHeight = (rowIndex: number, height: number) => {
    setDraft((cur) => cur.map((c) => c.rowIndex === rowIndex ? { ...c, height } : c));
  };

  const beginWidthDrag = (event: PointerEvent<HTMLDivElement>, rowIndex: number, leftId: string, rightId: string) => {
    event.preventDefault();
    event.stopPropagation();
    const rowEl = rowRefs.current.get(rowIndex);
    const left = draft.find((c) => c.id === leftId);
    const right = draft.find((c) => c.id === rightId);
    if (!rowEl || !left || !right) return;
    const startX = event.clientX;
    const totalMeters = draft.filter((c) => c.rowIndex === rowIndex).reduce((s, c) => s + c.width, 0);
    const pxPerMeter = rowEl.getBoundingClientRect().width / Math.max(.2, totalMeters);
    const startLeft = left.width;
    const startRight = right.width;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const move = (e: globalThis.PointerEvent) => {
      const delta = (e.clientX - startX) / Math.max(1, pxPerMeter);
      const nextLeft = clamp(startLeft + delta, .2, startLeft + startRight - .2);
      const nextRight = startLeft + startRight - nextLeft;
      setDraft((cur) => cur.map((c) => c.id === leftId ? { ...c, width: nextLeft } : c.id === rightId ? { ...c, width: nextRight } : c));
    };
    const up = () => {
      target.removeEventListener("pointermove", move as EventListener);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
    };
    target.addEventListener("pointermove", move as EventListener);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  };

  const beginHeightDrag = (event: PointerEvent<HTMLDivElement>, rowIndex: number) => {
    event.preventDefault();
    event.stopPropagation();
    const row = draft.filter((c) => c.rowIndex === rowIndex);
    if (!row.length) return;
    const startY = event.clientY;
    const start = Math.max(...row.map((c) => c.height));
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const move = (e: globalThis.PointerEvent) => {
      const delta = (e.clientY - startY) / 80;
      patchRowHeight(rowIndex, clamp(start + delta, .2, 6));
    };
    const up = () => {
      target.removeEventListener("pointermove", move as EventListener);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
    };
    target.addEventListener("pointermove", move as EventListener);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  };

  const post = async (payload: Record<string, unknown>) => {
    const response = await fetch("/api/department-warehouse/storage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json() as { error?: string };
    if (!response.ok) throw new Error(body.error || "Операция не выполнена");
    return body;
  };

  const save = async () => {
    if (!rack) return;
    setSaving(true);
    try {
      await post({ action: "saveVisualLayout", rackId: rack.id, cells: draft.map((c) => ({ id: c.id, width: c.width, height: c.height, depth: c.depth })) });
      toast.success("Схема стеллажа сохранена");
      await onChanged();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось сохранить схему"); }
    finally { setSaving(false); }
  };

  const addCell = async (rowIndex: number) => {
    if (!rack) return;
    setSaving(true);
    try {
      await post({ action: "addVisualCell", rackId: rack.id, rowIndex });
      toast.success("Ячейка добавлена");
      await onChanged();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось добавить ячейку"); }
    finally { setSaving(false); }
  };

  const removeCell = async (cell: DraftCell) => {
    if (hasStock(cell.id)) return toast.error("Сначала переместите товар из этой ячейки");
    if (!window.confirm(`Удалить ячейку ${cell.code}?`)) return;
    setSaving(true);
    try {
      await post({ action: "deleteVisualCell", cellId: cell.id });
      toast.success("Ячейка удалена");
      setSelectedId("");
      await onChanged();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось удалить ячейку"); }
    finally { setSaving(false); }
  };

  if (!open || !rack) return null;

  const totalHeight = rows.reduce((sum, row) => sum + Math.max(...row.cells.map((c) => c.height), 0), 0);

  return <div className="fixed inset-0 z-[20000] flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="flex max-h-[94vh] w-full max-w-[1180px] flex-col overflow-hidden rounded-[28px] bg-white shadow-2xl">
      <div className="flex items-start justify-between border-b px-6 py-5">
        <div><div className="text-xs font-black uppercase tracking-[.18em] text-blue-600">Визуальный конструктор</div><h2 className="mt-1 text-2xl font-black">{rack.code} · {rack.name}</h2><p className="mt-1 text-sm text-slate-500">Тяните синие грани для ширины ячеек и оранжевые линии для высоты полок. Размеры сразу видны в схеме.</p></div>
        <Button type="button" variant="ghost" size="icon" onClick={onClose}><X /></Button>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 overflow-hidden p-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-h-0 overflow-auto rounded-2xl border-4 border-slate-800 bg-slate-50 p-2">
          <div className="min-w-[680px]">
            {rows.map((row) => {
              const total = row.cells.reduce((s, c) => s + c.width, 0);
              const rowHeight = Math.max(...row.cells.map((c) => c.height));
              return <div key={row.rowIndex} className="relative border-b-4 border-slate-700 last:border-b-0">
                <div ref={(el) => { if (el) rowRefs.current.set(row.rowIndex, el); }} className="flex" style={{ height: `${clamp(rowHeight * 112, 92, 260)}px` }}>
                  {row.cells.map((cell, index) => <div key={cell.id} className={`relative flex min-w-0 cursor-pointer flex-col items-center justify-center border-r-2 border-slate-300 px-2 text-center last:border-r-0 ${selectedId === cell.id ? "bg-blue-100 ring-2 ring-inset ring-blue-500" : "bg-white/70 hover:bg-blue-50"}`} style={{ width: `${(cell.width / Math.max(.01, total)) * 100}%` }} onClick={() => setSelectedId(cell.id)}>
                    <button type="button" className={`absolute right-2 top-2 rounded-full p-1.5 ${hasStock(cell.id) ? "cursor-not-allowed text-slate-300" : "text-red-500 hover:bg-red-50"}`} title={hasStock(cell.id) ? "В ячейке есть товар" : "Удалить ячейку"} onClick={(e) => { e.stopPropagation(); void removeCell(cell); }} disabled={saving || hasStock(cell.id)}><Trash2 size={14}/></button>
                    <div className="font-black text-slate-800">{cell.code}</div>
                    <div className="mt-1 text-xs text-slate-400">{Math.round((cell.width / Math.max(.01, total)) * 100)}% ширины</div>
                    {hasStock(cell.id) && <div className="mt-2 rounded-full bg-blue-100 px-2 py-1 text-[10px] font-bold text-blue-700">✓ Есть товар</div>}
                    {index < row.cells.length - 1 && <div className="absolute -right-[5px] top-1/2 z-20 h-12 w-[8px] -translate-y-1/2 cursor-ew-resize rounded-full bg-blue-500 shadow" onPointerDown={(e) => beginWidthDrag(e, row.rowIndex, cell.id, row.cells[index + 1].id)} />}
                  </div>)}
                </div>
                <button type="button" className="absolute bottom-3 left-3 z-20 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 shadow-sm hover:bg-emerald-100" onClick={() => void addCell(row.rowIndex)} disabled={saving}><Plus size={14} className="mr-1 inline"/>Добавить ячейку</button>
                <div className="absolute bottom-[-5px] left-1/2 z-30 h-[8px] w-24 -translate-x-1/2 cursor-ns-resize rounded-full bg-orange-500 shadow" onPointerDown={(e) => beginHeightDrag(e, row.rowIndex)} />
              </div>;
            })}
          </div>
        </div>

        <aside className="space-y-4 overflow-auto">
          <div className="rounded-2xl bg-blue-50 p-4 text-sm leading-6 text-slate-700"><b className="text-slate-900">Управление</b><br/>Синяя вертикальная грань — ширина соседних ячеек.<br/>Оранжевая горизонтальная грань — высота уровня.<br/>Корзина удаляет только пустую ячейку.</div>
          <div className="rounded-2xl border p-4"><div className="text-sm font-black">Стеллаж</div><dl className="mt-3 space-y-2 text-sm"><div><dt className="text-slate-400">Полок</dt><dd className="font-bold">{rows.length}</dd></div><div><dt className="text-slate-400">Активных ячеек</dt><dd className="font-bold">{draft.length}</dd></div><div><dt className="text-slate-400">Сумма высот</dt><dd className="font-bold">{totalHeight.toFixed(2)} м</dd></div></dl></div>

          {selected ? <div className="rounded-2xl border p-4">
            <div className="text-sm font-black">Ячейка {selected.code}</div>
            <div className="mt-3 grid gap-3">
              <div><Label>Ширина, м</Label><Input type="number" min="0.2" max="8" step="0.05" value={selected.width} onChange={(e) => patchCell(selected.id, { width: clamp(Number(e.target.value) || .2, .2, 8) })}/></div>
              <div><Label>Высота, м</Label><Input type="number" min="0.2" max="6" step="0.05" value={selected.height} onChange={(e) => patchRowHeight(selected.rowIndex, clamp(Number(e.target.value) || .2, .2, 6))}/></div>
              <div><Label>Глубина, м</Label><Input type="number" min="0.2" max="6" step="0.05" value={selected.depth} onChange={(e) => patchCell(selected.id, { depth: clamp(Number(e.target.value) || .2, .2, 6) })}/></div>
            </div>
          </div> : <div className="rounded-2xl border border-dashed p-5 text-center text-sm text-slate-400">Нажмите на ячейку для точных размеров</div>}

          <Button className="w-full bg-blue-600 hover:bg-blue-700" disabled={saving} onClick={() => void save()}><Save/> Сохранить схему</Button>
        </aside>
      </div>
    </div>
  </div>;
}
