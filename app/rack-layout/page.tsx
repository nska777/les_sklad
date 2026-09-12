"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Boxes, Layers3, Loader2, MapPin, Plus, QrCode, Rotate3D } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Rack = { id: string; name: string; code: string; rows: number; columns: number };
type Cell = { id: string; rackId: string; code: string; label: string; rowIndex: number; columnIndex: number; blocked: boolean; side: "front" | "back" };
type Stock = { productId: string; cellId: string; quantity: number; productName: string; sku: string; barcode: string; unit: string };
type ApiResult = { racks: Rack[]; cells: Cell[]; stocks: Stock[]; error?: string };

const qty = (value: number) => value.toLocaleString("ru-RU", { maximumFractionDigits: 3 });

export default function RackLayoutPage() {
  const [data, setData] = useState<ApiResult>({ racks: [], cells: [], stocks: [] });
  const [activeRackId, setActiveRackId] = useState("");
  const [side, setSide] = useState<"front" | "back">("front");
  const [selectedCell, setSelectedCell] = useState<Cell | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/rack-layout", { cache: "no-store" });
      const result = await response.json() as ApiResult;
      if (!response.ok) throw new Error(result.error || "Ошибка загрузки");
      setData(result);
      setActiveRackId((current) => result.racks.some((rack) => rack.id === current) ? current : result.racks[0]?.id || "");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось загрузить стеллажи");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const activeRack = data.racks.find((rack) => rack.id === activeRackId) || data.racks[0];
  const rackCells = useMemo(() => data.cells.filter((cell) => cell.rackId === activeRack?.id), [data.cells, activeRack?.id]);
  const sideCells = rackCells.filter((cell) => cell.side === side);
  const hasBack = rackCells.some((cell) => cell.side === "back");
  const shelves = activeRack ? Array.from({ length: activeRack.rows }, (_, index) => activeRack.rows - index - 1) : [];
  const selectedStocks = selectedCell ? data.stocks.filter((stock) => stock.cellId === selectedCell.id) : [];

  const enableBack = async () => {
    if (!activeRack) return;
    setSaving(true);
    try {
      const response = await fetch("/api/rack-layout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "enableBackSide", rackId: activeRack.id, operator: "Кладовщик" }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Не удалось добавить заднюю сторону");
      await load();
      setSide("back");
      toast.success("Задняя сторона стеллажа создана");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось добавить заднюю сторону");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="min-h-screen px-3 py-4 text-[var(--foreground)] sm:px-5 lg:px-7">
      <div className="mx-auto max-w-[1700px] space-y-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Link href="/" className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-blue-700 hover:underline"><ArrowLeft size={16} /> Назад в склад</Link>
            <p className="eyebrow">Адресное хранение · новый вид</p>
            <h1 className="page-title">Стеллажи склада</h1>
            <p className="page-description">Стеллажи выбираются сверху. У каждого отдельно лицевая и задняя сторона, полки и ячейки.</p>
          </div>
          <div className="flex items-center gap-2 rounded-2xl border border-black/10 bg-white/70 px-4 py-3 text-sm shadow-sm">
            <Rotate3D size={20} className="text-blue-600" />
            <span>Основа под полноценный вращаемый 3D-режим уже разделена на две стороны.</span>
          </div>
        </div>

        <section className="panel p-3 sm:p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-[.14em] text-slate-500">Стеллажи</div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {data.racks.map((rack) => {
              const cells = data.cells.filter((cell) => cell.rackId === rack.id);
              const occupied = new Set(data.stocks.filter((stock) => cells.some((cell) => cell.id === stock.cellId)).map((stock) => stock.cellId)).size;
              return <button key={rack.id} type="button" onClick={() => { setActiveRackId(rack.id); setSide("front"); }} className={`min-w-[180px] cursor-pointer rounded-2xl border px-4 py-3 text-left transition ${activeRack?.id === rack.id ? "border-blue-500 bg-blue-600 text-white shadow-lg shadow-blue-200" : "border-black/10 bg-white/80 hover:border-blue-300 hover:bg-blue-50"}`}>
                <div className="text-xs opacity-70">{rack.code}</div>
                <div className="mt-1 truncate font-bold">{rack.name}</div>
                <div className="mt-2 text-xs opacity-75">{rack.rows} полок · {rack.columns} мест · занято {occupied}</div>
              </button>;
            })}
          </div>
        </section>

        {loading ? <div className="panel flex min-h-[460px] items-center justify-center"><Loader2 className="animate-spin" /></div> : !activeRack ? <div className="panel p-12 text-center text-slate-500">Стеллажей пока нет</div> : <>
          <section className="panel overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-black/10 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
              <div>
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.14em] text-slate-500"><Layers3 size={15} /> Стеллаж {activeRack.code}</div>
                <h2 className="mt-1 text-2xl font-bold">{activeRack.name}</h2>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="rounded-xl border border-black/10 bg-slate-100 p-1">
                  <button type="button" onClick={() => setSide("front")} className={`cursor-pointer rounded-lg px-4 py-2 text-sm font-semibold transition ${side === "front" ? "bg-white text-blue-700 shadow" : "text-slate-500"}`}>Лицевая сторона</button>
                  <button type="button" disabled={!hasBack} onClick={() => setSide("back")} className={`cursor-pointer rounded-lg px-4 py-2 text-sm font-semibold transition ${side === "back" ? "bg-white text-blue-700 shadow" : "text-slate-500 disabled:cursor-not-allowed disabled:opacity-40"}`}>Задняя сторона</button>
                </div>
                {!hasBack && <Button disabled={saving} variant="outline" onClick={() => void enableBack()}><Plus /> Добавить заднюю сторону</Button>}
              </div>
            </div>

            <div className="overflow-x-auto p-3 sm:p-6">
              <div className="mx-auto min-w-[720px] max-w-[1350px] [perspective:1600px]">
                <div className={`relative rounded-[26px] border-[10px] border-slate-800 bg-slate-900 p-3 shadow-2xl transition-transform duration-500 ${side === "front" ? "[transform:rotateX(1deg)_rotateY(-2deg)]" : "[transform:rotateX(1deg)_rotateY(2deg)]"}`}>
                  <div className="mb-3 flex items-center justify-center rounded-xl bg-gradient-to-b from-slate-700 to-slate-900 py-3 font-bold tracking-[.2em] text-white shadow-inner">{activeRack.code} · {side === "front" ? "ЛИЦЕВАЯ" : "ЗАДНЯЯ"} СТОРОНА</div>
                  <div className="space-y-3">
                    {shelves.map((rowIndex) => {
                      const rowCells = sideCells.filter((cell) => cell.rowIndex === rowIndex).sort((a, b) => a.columnIndex - b.columnIndex);
                      return <div key={rowIndex} className="grid grid-cols-[70px_1fr] gap-2 rounded-xl bg-slate-800 p-2 shadow-inner">
                        <div className="flex flex-col items-center justify-center rounded-lg bg-slate-700 text-white"><span className="text-[10px] uppercase tracking-widest text-slate-300">Полка</span><b className="text-2xl">{rowIndex + 1}</b></div>
                        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${activeRack.columns}, minmax(0, 1fr))` }}>
                          {Array.from({ length: activeRack.columns }, (_, columnIndex) => {
                            const cell = rowCells.find((item) => item.columnIndex === columnIndex);
                            if (!cell) return <div key={columnIndex} className="min-h-[125px] rounded-xl border border-dashed border-slate-600 bg-slate-900/60" />;
                            const cellStocks = data.stocks.filter((stock) => stock.cellId === cell.id);
                            const occupied = cellStocks.length > 0;
                            return <button key={cell.id} type="button" onClick={() => setSelectedCell(cell)} className={`group min-h-[125px] cursor-pointer rounded-xl border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-xl ${occupied ? "border-blue-300 bg-gradient-to-br from-blue-50 to-indigo-100" : "border-slate-200 bg-gradient-to-br from-white to-slate-100"}`}>
                              <div className="flex items-start justify-between gap-2"><div><div className="text-[10px] font-semibold uppercase tracking-[.12em] text-slate-400">Ячейка</div><b className="font-mono text-sm">{cell.code}</b></div><QrCode size={15} className="text-slate-500" /></div>
                              {occupied ? <div className="mt-4 space-y-2">{cellStocks.slice(0, 2).map((stock) => <div key={stock.productId} className="rounded-lg bg-white/80 px-2 py-1.5"><div className="line-clamp-1 text-xs font-semibold">{stock.productName}</div><div className="mt-0.5 text-xs font-bold text-blue-700">{qty(stock.quantity)} {stock.unit}</div></div>)}{cellStocks.length > 2 && <div className="text-[10px] text-slate-500">+ ещё {cellStocks.length - 2}</div>}</div> : <div className="mt-7 text-xs font-medium text-slate-400">Свободно</div>}
                            </button>;
                          })}
                        </div>
                      </div>;
                    })}
                  </div>
                  <div className="mt-3 h-4 rounded-b-xl bg-gradient-to-b from-slate-700 to-slate-950" />
                </div>
              </div>
            </div>
          </section>
        </>}
      </div>

      <Dialog open={!!selectedCell} onOpenChange={(open) => !open && setSelectedCell(null)}>
        <DialogContent className="sm:max-w-xl">
          {selectedCell && <>
            <DialogHeader><DialogTitle>Ячейка {selectedCell.code}</DialogTitle><DialogDescription>{selectedCell.side === "front" ? "Лицевая" : "Задняя"} сторона · полка {selectedCell.rowIndex + 1} · место {String.fromCharCode(65 + selectedCell.columnIndex)}</DialogDescription></DialogHeader>
            <div className="mt-4 grid gap-4 sm:grid-cols-[140px_1fr]">
              <div className="flex items-center justify-center rounded-2xl border border-black/10 bg-white p-3"><QRCodeSVG value={selectedCell.code} size={116} /></div>
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">Содержимое</div>
                {selectedStocks.length ? <div className="space-y-2">{selectedStocks.map((stock) => <div key={stock.productId} className="rounded-xl border border-black/10 bg-slate-50 p-3"><div className="font-semibold">{stock.productName}</div><div className="mt-1 flex items-center justify-between text-sm"><span className="font-mono text-slate-500">{stock.sku}</span><b>{qty(stock.quantity)} {stock.unit}</b></div></div>)}</div> : <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Ячейка свободна</div>}
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2 rounded-xl bg-blue-50 px-3 py-2 text-sm text-blue-900"><MapPin size={16} /><span>Адрес ячейки и QR всегда относятся только к этому физическому месту.</span></div>
            <DialogFooter><Button onClick={() => setSelectedCell(null)}>Закрыть</Button></DialogFooter>
          </>}
        </DialogContent>
      </Dialog>
    </main>
  );
}
