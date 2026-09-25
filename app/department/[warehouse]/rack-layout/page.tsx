"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Box, Layers3, Loader2, MapPin, PackagePlus, Plus, QrCode, RotateCcw, RotateCw, Ruler, Trash2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DepartmentRoomThreeView } from "./department-room-three-view";

type Rack = { id: string; name: string; code: string; rows: number; columns: number; storageType: string; width: number; depth: number; posX?: number; posZ?: number; rotation?: number };
type Cell = { id: string; rackId: string; code: string; label: string; rowIndex: number; columnIndex: number; blocked: boolean; cellWidth?: number; cellHeight?: number; cellDepth?: number };
type Product = { id: string; name: string; sku: string; barcode: string; unit: string; color: string; packType: string; packSize: number };
type Stock = { productId: string; cellId: string; quantity: number };
type DimensionRow = { cellId: string; width: number; height: number; depth: number };
type Snapshot = { warehouse: { code: string; name: string }; racks: Rack[]; cells: Cell[]; products: Product[]; stocks: Stock[]; error?: string };
const fmt = (v: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(v);

function displayPosition(rack: Rack, racks: Rack[]) {
  const explicit = Math.abs(Number(rack.posX || 0)) > 0.01 || Math.abs(Number(rack.posZ || 0)) > 0.01;
  if (explicit) return { x: Number(rack.posX || 0), z: Number(rack.posZ || 0) };
  const sameType = racks.filter((r) => (r.storageType === "floor") === (rack.storageType === "floor"));
  const index = Math.max(0, sameType.findIndex((r) => r.id === rack.id));
  if (rack.storageType === "floor") {
    const col = index % 4; const row = Math.floor(index / 4);
    return { x: -8 + col * 5.2, z: 7 + row * 4.5 };
  }
  const col = index % 3; const row = Math.floor(index / 3);
  return { x: -8 + col * 8, z: -5 + row * 6.5 };
}

export default function PaintStorageRoomPage() {
  const params = useParams<{ warehouse: string }>();
  const warehouse = String(params?.warehouse || "paint");
  const base = `/department/${warehouse}`;
  const [data, setData] = useState<Snapshot>({ warehouse: { code: warehouse, name: "Склад краски" }, racks: [], cells: [], products: [], stocks: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Cell | null>(null);
  const [mode, setMode] = useState<"rack" | "floor" | null>(null);

  const load = useCallback(async () => {
    try {
      const [mainResponse, storageResponse] = await Promise.all([
        fetch("/api/department-warehouse", { cache: "no-store" }),
        fetch("/api/department-warehouse/storage", { cache: "no-store" }),
      ]);
      const body = await mainResponse.json() as Snapshot;
      if (!mainResponse.ok) throw new Error(body.error || "Не удалось загрузить склад");
      const storageBody = await storageResponse.json() as { dimensions?: DimensionRow[] };
      const dimensions = new Map((storageBody.dimensions || []).map((row) => [row.cellId, row]));
      const cells = body.cells.map((cell) => {
        const dim = dimensions.get(cell.id);
        const rack = body.racks.find((r) => r.id === cell.rackId);
        return {
          ...cell,
          cellWidth: Number(dim?.width || Math.max(0.4, Number(rack?.width || 4) / Math.max(1, Number(rack?.columns || 1)))),
          cellHeight: Number(dim?.height || 1.1),
          cellDepth: Number(dim?.depth || rack?.depth || 1.2),
        };
      });
      setData({ ...body, cells });
      setSelected((current) => current ? cells.find((cell) => cell.id === current.id) || null : null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка загрузки");
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const post = async (payload: Record<string, unknown>, success: string) => {
    setSaving(true);
    try {
      const response = await fetch("/api/department-warehouse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "Операция не выполнена");
      toast.success(success); await load(); return body;
    } catch (error) { toast.error(error instanceof Error ? error.message : "Ошибка"); throw error; }
    finally { setSaving(false); }
  };

  const postStorage = async (payload: Record<string, unknown>) => {
    const response = await fetch("/api/department-warehouse/storage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const body = await response.json() as { error?: string; hasStock?: boolean; positions?: number; totalQuantity?: number; removedPositions?: number; updated?: number };
    return { response, body };
  };

  const onCellClick = useCallback((cell: Cell) => setSelected(cell), []);
  const selectedStocks = useMemo(() => selected ? data.stocks.filter((s) => s.cellId === selected.id && Number(s.quantity) > 0) : [], [selected, data.stocks]);
  const richStocks = useMemo(() => data.stocks.map((s) => {
    const product = data.products.find((x) => x.id === s.productId);
    return { ...s, productName: product?.name || "Материал", unit: product?.unit || "", color: product?.color || "", packType: product?.packType || "", packSize: Number(product?.packSize || 0) };
  }), [data.stocks, data.products]);
  const selectedRack = selected ? data.racks.find((r) => r.id === selected.rackId) || null : null;

  const submitStorage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await post({ action: mode === "floor" ? "createFloorZone" : "createRack", ...Object.fromEntries(form.entries()) }, mode === "floor" ? "Напольная зона создана" : "Стеллаж создан");
    setMode(null);
  };

  const place = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!selected) return;
    const form = new FormData(event.currentTarget);
    await post({ action: "receive", cellId: selected.id, productId: form.get("productId"), quantity: form.get("quantity"), documentNumber: "3D-РАЗМЕЩЕНИЕ", sourceName: "Внутреннее размещение", sourceLocation: "Склад краски", comment: "Размещение через 3D-склад" }, "Материал размещён");
    event.currentTarget.reset();
  };

  const moveStorage = async (dx = 0, dz = 0, dr = 0) => {
    if (!selectedRack) return;
    const pos = displayPosition(selectedRack, data.racks);
    await post({ action: "updateRack", id: selectedRack.id, posX: pos.x + dx, posZ: pos.z + dz, rotation: Number(selectedRack.rotation || 0) + dr }, "Положение сохранено");
  };

  const saveCellDimensions = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!selected || !selectedRack) return;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    try {
      const { response, body } = await postStorage({
        action: "updateCellDimensions",
        cellId: selected.id,
        width: form.get("width"),
        height: form.get("height"),
        depth: form.get("depth"),
        scope: form.get("scope"),
      });
      if (!response.ok) throw new Error(body.error || "Не удалось сохранить размеры");
      toast.success(`Размеры сохранены · ячеек: ${body.updated || 1}`);
      await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось сохранить размеры"); }
    finally { setSaving(false); }
  };

  const deleteStorage = async () => {
    if (!selectedRack) return;
    const noun = selectedRack.storageType === "floor" ? "напольную зону" : "стеллаж";
    if (!window.confirm(`Удалить ${noun} ${selectedRack.code}?`)) return;
    setSaving(true);
    try {
      let { response, body } = await postStorage({ action: "deleteStorage", id: selectedRack.id, force: false });
      if (response.status === 409 && body.hasStock) {
        const confirmed = window.confirm(
          `В ${noun} есть материалы: ${body.positions || 0} позиций.\n\nОК — удалить ${noun} вместе с остатками. Остатки будут списаны, а история сохранится.\nОтмена — ничего не менять.`
        );
        if (!confirmed) return;
        ({ response, body } = await postStorage({ action: "deleteStorage", id: selectedRack.id, force: true }));
      }
      if (!response.ok) throw new Error(body.error || "Не удалось удалить место хранения");
      toast.success("Место хранения удалено", { description: body.removedPositions ? `Списано позиций: ${body.removedPositions}` : undefined });
      setSelected(null); await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось удалить"); }
    finally { setSaving(false); }
  };

  if (loading) return <main className="flex min-h-screen items-center justify-center"><Loader2 className="animate-spin text-orange-500" size={36} /></main>;

  return <main className="min-h-screen px-3 py-4 text-[var(--foreground)] sm:px-5 lg:px-7">
    <div className="mx-auto max-w-[1800px] space-y-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Link href={base} data-same-tab="true" className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-blue-700 hover:underline"><ArrowLeft size={16} /> Назад</Link>
          <p className="eyebrow">Склад краски · 3D-комната</p><h1 className="page-title">Склад</h1>
          <p className="page-description">Стеллажи, ячейки и напольные зоны в одной 3D-комнате. Ячейки можно конструировать по реальным размерам.</p>
        </div>
        <div className="flex flex-wrap gap-2"><Button onClick={() => setMode("rack")} className="accent-button"><Plus /> Стеллаж</Button><Button variant="outline" onClick={() => setMode("floor")}><MapPin /> Напольная зона</Button></div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <DepartmentRoomThreeView racks={data.racks} cells={data.cells} stocks={richStocks} selectedCellId={selected?.id} selectedRackId={selectedRack?.id} onCellClick={onCellClick} />
        <aside className="panel h-fit p-5 xl:sticky xl:top-4">
          {selected ? <>
            <div className="flex items-start justify-between gap-3"><div><p className="eyebrow">{selectedRack?.storageType === "floor" ? "Напольное хранение" : "Ячейка"}</p><h2 className="mt-1 text-2xl font-black">{selected.code}</h2><p className="mt-1 text-sm text-slate-500">{selectedRack?.name}</p></div><div className="rounded-xl bg-slate-950 p-2.5 text-white"><QrCode size={20} /></div></div>

            {selectedRack && <section className="mt-4 rounded-2xl border border-orange-200 bg-orange-50/70 p-4">
              <div className="font-black">Выбран объект: {selectedRack.code}</div><div className="mt-1 text-xs text-slate-500">Передвигайте и поворачивайте объект кнопками.</div>
              <div className="mt-3 grid grid-cols-3 gap-2"><div/><Button type="button" variant="outline" size="sm" onClick={() => void moveStorage(0,-1,0)} disabled={saving}><ArrowUp size={15}/></Button><div/><Button type="button" variant="outline" size="sm" onClick={() => void moveStorage(-1,0,0)} disabled={saving}><ArrowLeft size={15}/></Button><div className="flex items-center justify-center text-[10px] font-bold text-slate-400">1 м</div><Button type="button" variant="outline" size="sm" onClick={() => void moveStorage(1,0,0)} disabled={saving}><ArrowRight size={15}/></Button><div/><Button type="button" variant="outline" size="sm" onClick={() => void moveStorage(0,1,0)} disabled={saving}><ArrowDown size={15}/></Button><div/></div>
              <div className="mt-2 grid grid-cols-2 gap-2"><Button type="button" variant="outline" size="sm" onClick={() => void moveStorage(0,0,-Math.PI/12)} disabled={saving}><RotateCcw size={15}/> -15°</Button><Button type="button" variant="outline" size="sm" onClick={() => void moveStorage(0,0,Math.PI/12)} disabled={saving}><RotateCw size={15}/> +15°</Button></div>
            </section>}

            {selectedRack?.storageType !== "floor" && <form key={`${selected.id}-${selected.cellWidth}-${selected.cellHeight}-${selected.cellDepth}`} onSubmit={saveCellDimensions} className="mt-4 rounded-2xl border bg-slate-50 p-4">
              <div className="flex items-center gap-2"><Ruler size={17}/><div className="font-black">Конструктор ячейки</div></div>
              <div className="mt-1 text-xs text-slate-500">Размеры в метрах. Можно применить только к ячейке, ко всей полке или ко всему стеллажу.</div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <div><Label>Ширина</Label><Input name="width" type="number" min="0.2" max="8" step="0.05" defaultValue={Number(selected.cellWidth || 1).toFixed(2)} className="mt-1"/></div>
                <div><Label>Высота</Label><Input name="height" type="number" min="0.2" max="6" step="0.05" defaultValue={Number(selected.cellHeight || 1.1).toFixed(2)} className="mt-1"/></div>
                <div><Label>Глубина</Label><Input name="depth" type="number" min="0.2" max="6" step="0.05" defaultValue={Number(selected.cellDepth || 1.2).toFixed(2)} className="mt-1"/></div>
              </div>
              <div className="mt-3"><Label>Применить размер</Label><select name="scope" className="mt-1 h-10 w-full rounded-md border bg-white px-3 text-sm"><option value="cell">Только эта ячейка</option><option value="row">Вся полка / ряд</option><option value="rack">Весь стеллаж</option></select></div>
              <Button className="mt-3 w-full" variant="outline" disabled={saving}><Ruler size={15}/> Сохранить размеры</Button>
            </form>}

            <div className="mt-4 flex justify-center rounded-2xl border bg-white p-4"><QRCodeSVG value={`RL-CELL:${data.warehouse.code}:${selected.code}`} size={150}/></div><div className="mt-2 text-center text-xs font-mono text-slate-400">RL-CELL:{data.warehouse.code}:{selected.code}</div>
            <div className="mt-5 space-y-2">{selectedStocks.map((stock) => { const product = data.products.find((x) => x.id === stock.productId); return <div key={stock.productId} className="rounded-xl border bg-slate-50 p-3"><div className="font-bold">{product?.name}</div><div className="mt-1 text-sm text-slate-500">{fmt(Number(stock.quantity))} {product?.unit}{product?.packSize ? ` · ≈ ${fmt(Number(stock.quantity)/Number(product.packSize))} ${product.packType || "уп."}` : ""}</div></div>; })}{!selectedStocks.length && <div className="rounded-xl border border-dashed p-4 text-center text-sm text-slate-400">Место свободно</div>}</div>
            <form onSubmit={place} className="mt-5 space-y-3 border-t pt-5"><div className="font-black">Разместить материал</div><div><Label>Материал</Label><select name="productId" required className="mt-1.5 h-10 w-full rounded-md border bg-white px-3 text-sm"><option value="">Выберите...</option>{data.products.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.unit}</option>)}</select></div><div><Label>Количество</Label><Input name="quantity" required type="number" step="0.001" min="0.001" className="mt-1.5"/></div><Button disabled={saving} className="accent-button w-full"><PackagePlus/> Разместить</Button></form>
            <Button variant="outline" className="mt-3 w-full text-red-600" onClick={() => void deleteStorage()} disabled={saving}><Trash2/> Удалить вместе с содержимым</Button>
          </> : <div className="py-12 text-center"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100"><Box size={22}/></div><h3 className="mt-4 font-black">Выберите место</h3><p className="mt-2 text-sm leading-6 text-slate-500">Нажмите на ячейку или напольную зону. Для стеллажей здесь появится конструктор размеров.</p></div>}
        </aside>
      </div>

      {mode && <div className="fixed inset-0 z-[12000] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm"><form onSubmit={submitStorage} className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl"><div className="flex items-center gap-3"><div className="rounded-xl bg-slate-100 p-2"><Layers3 size={20}/></div><div><h2 className="text-xl font-black">{mode === "floor" ? "Новая напольная зона" : "Новый стеллаж"}</h2><p className="text-xs text-slate-500">Объект сразу появится в 3D-комнате</p></div></div><div className="mt-5 grid gap-3 sm:grid-cols-2"><div><Label>Название</Label><Input name="name" required className="mt-1.5"/></div><div><Label>Код</Label><Input name="code" required className="mt-1.5" placeholder={mode === "floor" ? "P-01" : "K1"}/></div>{mode === "rack" && <><div><Label>Полок</Label><Input name="rows" type="number" min="1" max="12" defaultValue="4" className="mt-1.5"/></div><div><Label>Ячеек на полке</Label><Input name="columns" type="number" min="1" max="20" defaultValue="4" className="mt-1.5"/></div></>}<div><Label>Ширина, м</Label><Input name="width" type="number" step="0.1" defaultValue={mode === "floor" ? 2 : 4} className="mt-1.5"/></div><div><Label>Глубина, м</Label><Input name="depth" type="number" step="0.1" defaultValue={mode === "floor" ? 2 : 1.2} className="mt-1.5"/></div></div><div className="mt-5 flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setMode(null)}>Отмена</Button><Button className="accent-button" disabled={saving}><Plus/> Создать</Button></div></form></div>}
    </div>
  </main>;
}
