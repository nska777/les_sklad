"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Layers3, Loader2, MapPin, Pencil, Plus, QrCode, Rotate3D, Trash2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
  const [createOpen, setCreateOpen] = useState(false);
  const [editRack, setEditRack] = useState<Rack | null>(null);
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
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const activeRack = data.racks.find((rack) => rack.id === activeRackId) || data.racks[0];
  const rackCells = useMemo(() => data.cells.filter((cell) => cell.rackId === activeRack?.id), [data.cells, activeRack?.id]);
  const sideCells = rackCells.filter((cell) => cell.side === side);
  const hasBack = rackCells.some((cell) => cell.side === "back");
  const shelves = activeRack ? Array.from({ length: activeRack.rows }, (_, index) => activeRack.rows - index - 1) : [];
  const selectedStocks = selectedCell ? data.stocks.filter((stock) => stock.cellId === selectedCell.id) : [];

  const apiAction = async (body: Record<string, unknown>) => {
    const response = await fetch("/api/rack-layout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json() as { error?: string; rackId?: string };
    if (!response.ok) throw new Error(result.error || "Операция не выполнена");
    return result;
  };

  const createRack = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    try {
      const result = await apiAction({ action: "createRack", name: form.get("name"), code: form.get("code"), rows: form.get("rows"), columns: form.get("columns"), twoSided: form.get("twoSided") === "on", operator: "Кладовщик" });
      await load();
      if (result.rackId) setActiveRackId(result.rackId);
      setCreateOpen(false); setSide("front"); toast.success("Стеллаж создан");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Ошибка создания"); }
    finally { setSaving(false); }
  };

  const updateRack = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!editRack) return;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    try {
      await apiAction({ action: "updateRack", rackId: editRack.id, name: form.get("name"), code: form.get("code"), rows: form.get("rows"), columns: form.get("columns"), twoSided: form.get("twoSided") === "on", operator: "Кладовщик" });
      await load(); setEditRack(null); setSide("front"); toast.success("Стеллаж обновлён");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Ошибка редактирования"); }
    finally { setSaving(false); }
  };

  const deleteRack = async () => {
    if (!activeRack || !confirm(`Удалить стеллаж ${activeRack.name} (${activeRack.code})?`)) return;
    setSaving(true);
    try { await apiAction({ action: "deleteRack", rackId: activeRack.id, operator: "Кладовщик" }); await load(); setSide("front"); toast.success("Стеллаж удалён"); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось удалить"); }
    finally { setSaving(false); }
  };

  const enableBack = async () => {
    if (!activeRack) return;
    setSaving(true);
    try { await apiAction({ action: "enableBackSide", rackId: activeRack.id, operator: "Кладовщик" }); await load(); setSide("back"); toast.success("Задняя сторона создана"); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось добавить заднюю сторону"); }
    finally { setSaving(false); }
  };

  return <main className="min-h-screen px-3 py-4 text-[var(--foreground)] sm:px-5 lg:px-7">
    <div className="mx-auto max-w-[1700px] space-y-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div><Link href="/" className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-blue-700 hover:underline"><ArrowLeft size={16} /> Назад в склад</Link><p className="eyebrow">Адресное хранение</p><h1 className="page-title">Стеллажи склада</h1><p className="page-description">Стеллаж → сторона → полка → ячейка. Лицевая и задняя стороны считаются отдельными физическими местами.</p></div>
        <div className="flex flex-wrap gap-2"><Button onClick={() => setCreateOpen(true)} className="accent-button"><Plus /> Создать стеллаж</Button><div className="flex items-center gap-2 rounded-2xl border border-black/10 bg-white/70 px-4 py-3 text-sm shadow-sm"><Rotate3D size={20} className="text-blue-600" /><span>Готово под вращаемый 3D</span></div></div>
      </div>

      <section className="panel p-3 sm:p-4"><div className="mb-2 text-xs font-semibold uppercase tracking-[.14em] text-slate-500">Стеллажи</div><div className="flex gap-2 overflow-x-auto pb-1">{data.racks.map((rack) => { const cells = data.cells.filter((cell) => cell.rackId === rack.id); const occupied = new Set(data.stocks.filter((stock) => cells.some((cell) => cell.id === stock.cellId)).map((stock) => stock.cellId)).size; return <button key={rack.id} type="button" onClick={() => { setActiveRackId(rack.id); setSide("front"); }} className={`min-w-[190px] cursor-pointer rounded-2xl border px-4 py-3 text-left transition ${activeRack?.id === rack.id ? "border-blue-500 bg-blue-600 text-white shadow-lg shadow-blue-200" : "border-black/10 bg-white/80 hover:border-blue-300 hover:bg-blue-50"}`}><div className="text-xs opacity-70">{rack.code}</div><div className="mt-1 truncate font-bold">{rack.name}</div><div className="mt-2 text-xs opacity-75">{rack.rows} полок · {rack.columns} мест · занято {occupied}</div></button>; })}</div></section>

      {loading ? <div className="panel flex min-h-[460px] items-center justify-center"><Loader2 className="animate-spin" /></div> : !activeRack ? <div className="panel p-12 text-center text-slate-500">Стеллажей пока нет</div> : <section className="panel overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-black/10 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"><div><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.14em] text-slate-500"><Layers3 size={15} /> Стеллаж {activeRack.code}</div><h2 className="mt-1 text-2xl font-bold">{activeRack.name}</h2></div><div className="flex flex-wrap items-center gap-2"><div className="rounded-xl border border-black/10 bg-slate-100 p-1"><button type="button" onClick={() => setSide("front")} className={`cursor-pointer rounded-lg px-4 py-2 text-sm font-semibold ${side === "front" ? "bg-white text-blue-700 shadow" : "text-slate-500"}`}>Лицевая</button><button type="button" disabled={!hasBack} onClick={() => setSide("back")} className={`cursor-pointer rounded-lg px-4 py-2 text-sm font-semibold ${side === "back" ? "bg-white text-blue-700 shadow" : "text-slate-500 disabled:opacity-40"}`}>Задняя</button></div>{!hasBack && <Button disabled={saving} variant="outline" onClick={() => void enableBack()}><Plus /> Задняя сторона</Button>}<Button variant="outline" onClick={() => setEditRack(activeRack)}><Pencil /> Изменить</Button><Button variant="outline" className="text-red-600" onClick={() => void deleteRack()}><Trash2 /> Удалить</Button></div></div>
        <div className="overflow-x-auto p-3 sm:p-6"><div className="mx-auto min-w-[720px] max-w-[1350px] [perspective:1600px]"><div className={`relative rounded-[26px] border-[10px] border-slate-800 bg-slate-900 p-3 shadow-2xl transition-transform duration-500 ${side === "front" ? "[transform:rotateX(1deg)_rotateY(-2deg)]" : "[transform:rotateX(1deg)_rotateY(2deg)]"}`}><div className="mb-3 flex items-center justify-center rounded-xl bg-gradient-to-b from-slate-700 to-slate-900 py-3 font-bold tracking-[.2em] text-white">{activeRack.code} · {side === "front" ? "ЛИЦЕВАЯ" : "ЗАДНЯЯ"} СТОРОНА</div><div className="space-y-3">{shelves.map((rowIndex) => { const rowCells = sideCells.filter((cell) => cell.rowIndex === rowIndex).sort((a,b) => a.columnIndex-b.columnIndex); return <div key={rowIndex} className="grid grid-cols-[70px_1fr] gap-2 rounded-xl bg-slate-800 p-2"><div className="flex flex-col items-center justify-center rounded-lg bg-slate-700 text-white"><span className="text-[10px] uppercase tracking-widest text-slate-300">Полка</span><b className="text-2xl">{rowIndex+1}</b></div><div className="grid gap-2" style={{gridTemplateColumns:`repeat(${activeRack.columns},minmax(0,1fr))`}}>{Array.from({length:activeRack.columns},(_,columnIndex)=>{const cell=rowCells.find((item)=>item.columnIndex===columnIndex); if(!cell)return <div key={columnIndex} className="min-h-[125px] rounded-xl border border-dashed border-slate-600 bg-slate-900/60"/>; const cellStocks=data.stocks.filter((stock)=>stock.cellId===cell.id); return <button key={cell.id} onClick={()=>setSelectedCell(cell)} className={`min-h-[125px] cursor-pointer rounded-xl border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-xl ${cellStocks.length?"border-blue-300 bg-gradient-to-br from-blue-50 to-indigo-100":"border-slate-200 bg-gradient-to-br from-white to-slate-100"}`}><div className="flex items-start justify-between"><div><div className="text-[10px] font-semibold uppercase tracking-[.12em] text-slate-400">Ячейка</div><b className="font-mono text-sm">{cell.code}</b></div><QrCode size={15}/></div>{cellStocks.length?<div className="mt-4 space-y-2">{cellStocks.slice(0,2).map((stock)=><div key={stock.productId} className="rounded-lg bg-white/80 px-2 py-1.5"><div className="line-clamp-1 text-xs font-semibold">{stock.productName}</div><div className="text-xs font-bold text-blue-700">{qty(stock.quantity)} {stock.unit}</div></div>)}</div>:<div className="mt-7 text-xs font-medium text-slate-400">Свободно</div>}</button>})}</div></div>})}</div><div className="mt-3 h-4 rounded-b-xl bg-gradient-to-b from-slate-700 to-slate-950"/></div></div></div>
      </section>}
    </div>

    <RackFormDialog open={createOpen} onOpenChange={setCreateOpen} title="Новый стеллаж" submitText="Создать стеллаж" saving={saving} onSubmit={createRack}/>
    <RackFormDialog open={!!editRack} onOpenChange={(open)=>!open&&setEditRack(null)} title="Редактировать стеллаж" submitText="Сохранить" saving={saving} rack={editRack || undefined} hasBack={editRack ? data.cells.some((c)=>c.rackId===editRack.id&&c.side==="back") : false} onSubmit={updateRack}/>

    <Dialog open={!!selectedCell} onOpenChange={(open)=>!open&&setSelectedCell(null)}><DialogContent className="sm:max-w-xl">{selectedCell&&<><DialogHeader><DialogTitle>Ячейка {selectedCell.code}</DialogTitle><DialogDescription>{selectedCell.side==="front"?"Лицевая":"Задняя"} сторона · полка {selectedCell.rowIndex+1} · место {String.fromCharCode(65+selectedCell.columnIndex)}</DialogDescription></DialogHeader><div className="mt-4 grid gap-4 sm:grid-cols-[140px_1fr]"><div className="flex items-center justify-center rounded-2xl border bg-white p-3"><QRCodeSVG value={selectedCell.code} size={116}/></div><div><div className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">Содержимое</div>{selectedStocks.length?<div className="space-y-2">{selectedStocks.map((stock)=><div key={stock.productId} className="rounded-xl border bg-slate-50 p-3"><div className="font-semibold">{stock.productName}</div><div className="mt-1 flex justify-between text-sm"><span className="font-mono text-slate-500">{stock.sku}</span><b>{qty(stock.quantity)} {stock.unit}</b></div></div>)}</div>:<div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Ячейка свободна</div>}</div></div><div className="mt-4 flex items-center gap-2 rounded-xl bg-blue-50 px-3 py-2 text-sm text-blue-900"><MapPin size={16}/>QR относится именно к этому физическому месту.</div><DialogFooter><Button onClick={()=>setSelectedCell(null)}>Закрыть</Button></DialogFooter></>}</DialogContent></Dialog>
  </main>;
}

function RackFormDialog({ open, onOpenChange, title, submitText, saving, rack, hasBack=false, onSubmit }:{ open:boolean; onOpenChange:(open:boolean)=>void; title:string; submitText:string; saving:boolean; rack?:Rack; hasBack?:boolean; onSubmit:(event:FormEvent<HTMLFormElement>)=>void }) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><form onSubmit={onSubmit}><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>Можно создать односторонний или двухсторонний стеллаж. На каждой стороне будет одинаковое число полок и ячеек.</DialogDescription></DialogHeader><div className="mt-5 grid gap-4 sm:grid-cols-2"><div className="sm:col-span-2"><Label>Название</Label><Input name="name" required defaultValue={rack?.name||""} placeholder="Например, Основной стеллаж" className="mt-2"/></div><div><Label>Код</Label><Input name="code" required defaultValue={rack?.code||""} placeholder="R023" className="mt-2"/></div><div className="flex items-end"><label className="flex h-10 w-full cursor-pointer items-center gap-3 rounded-xl border border-black/10 bg-white px-3"><input type="checkbox" name="twoSided" defaultChecked={hasBack}/><span className="text-sm font-semibold">Двухсторонний</span></label></div><div><Label>Полок</Label><Input name="rows" type="number" min="1" max="12" required defaultValue={rack?.rows||4} className="mt-2"/></div><div><Label>Ячеек на полке</Label><Input name="columns" type="number" min="1" max="12" required defaultValue={rack?.columns||4} className="mt-2"/></div></div><div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs text-slate-500">Адреса: лицевая — R0231A, R0231B… · задняя — R023-B-1A, R023-B-1B…</div><DialogFooter className="mt-6"><Button type="button" variant="outline" onClick={()=>onOpenChange(false)}>Отмена</Button><Button disabled={saving} className="accent-button">{saving?<Loader2 className="animate-spin"/>:<Plus/>}{submitText}</Button></DialogFooter></form></DialogContent></Dialog>;
}
