"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { ArrowLeft, Boxes, Layers3, Loader2, MapPin, Pencil, Plus, QrCode, Search, Trash2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DepartmentRackThreeView } from "./department-rack-three-view";

type Rack = { id: string; warehouseCode: string; name: string; code: string; rows: number; columns: number };
type Cell = { id: string; warehouseCode: string; rackId: string; code: string; label: string; rowIndex: number; columnIndex: number; blocked: boolean };
type Product = { id: string; name: string; sku: string; barcode: string; unit: string };
type Stock = { warehouseCode: string; productId: string; cellId: string; quantity: number };
type Snapshot = { warehouse: { code: string; name: string }; racks: Rack[]; cells: Cell[]; products: Product[]; stocks: Stock[]; error?: string };

type RichStock = Stock & { productName: string; unit: string };

const emptyData: Snapshot = { warehouse: { code: "", name: "Склад" }, racks: [], cells: [], products: [], stocks: [] };
const fmt = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(value);

export default function DepartmentRackLayoutPage() {
  const params = useParams<{ warehouse: string }>();
  const warehouse = String(params?.warehouse || "paint");
  const base = `/department/${encodeURIComponent(warehouse)}`;
  const [data, setData] = useState<Snapshot>(emptyData);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeRackId, setActiveRackId] = useState("");
  const [selectedCell, setSelectedCell] = useState<Cell | null>(null);
  const [highlightCellId, setHighlightCellId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/department-warehouse", { cache: "no-store" });
      const body = await response.json() as Snapshot;
      if (!response.ok) throw new Error(body.error || "Не удалось загрузить стеллажи");
      setData(body);
      setActiveRackId((current) => body.racks.some((rack) => rack.id === current) ? current : body.racks[0]?.id || "");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось загрузить стеллажи");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const activeRack = data.racks.find((rack) => rack.id === activeRackId) || data.racks[0];
  const activeCells = useMemo(() => data.cells.filter((cell) => cell.rackId === activeRack?.id), [data.cells, activeRack?.id]);
  const productById = useMemo(() => new Map(data.products.map((product) => [product.id, product])), [data.products]);
  const richStocks = useMemo<RichStock[]>(() => data.stocks.map((stock) => ({
    ...stock,
    productName: productById.get(stock.productId)?.name || "Материал",
    unit: productById.get(stock.productId)?.unit || "",
  })), [data.stocks, productById]);

  const selectedStocks = useMemo(() => selectedCell ? richStocks.filter((stock) => stock.cellId === selectedCell.id && Number(stock.quantity) > 0) : [], [richStocks, selectedCell]);

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length < 2) return [];
    return data.products
      .filter((product) => `${product.name} ${product.sku} ${product.barcode}`.toLowerCase().includes(q))
      .map((product) => ({ product, stocks: data.stocks.filter((stock) => stock.productId === product.id && Number(stock.quantity) > 0) }))
      .filter((row) => row.stocks.length)
      .slice(0, 8);
  }, [data.products, data.stocks, search]);

  const locateCell = (cellId: string, open = true) => {
    const cell = data.cells.find((item) => item.id === cellId);
    if (!cell) return;
    setActiveRackId(cell.rackId);
    setHighlightCellId(cell.id);
    if (open) setSelectedCell(cell);
    window.setTimeout(() => document.getElementById("department-rack-3d")?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
  };

  const post = async (body: Record<string, unknown>) => {
    const response = await fetch("/api/department-warehouse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json() as { error?: string; rackId?: string };
    if (!response.ok) throw new Error(result.error || "Операция не выполнена");
    return result;
  };

  const createRack = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    try {
      const result = await post({ action: "createRack", name: form.get("name"), code: form.get("code"), rows: form.get("rows"), columns: form.get("columns") });
      await load();
      if (result.rackId) setActiveRackId(result.rackId);
      setCreateOpen(false);
      toast.success("Стеллаж создан");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось создать стеллаж");
    } finally { setSaving(false); }
  };

  const renameRack = async () => {
    if (!activeRack) return;
    const name = window.prompt("Название стеллажа", activeRack.name)?.trim();
    if (!name || name === activeRack.name) return;
    setSaving(true);
    try {
      await post({ action: "updateRack", id: activeRack.id, name });
      await load();
      toast.success("Стеллаж переименован");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось изменить стеллаж");
    } finally { setSaving(false); }
  };

  const deleteRack = async () => {
    if (!activeRack || !window.confirm(`Удалить стеллаж ${activeRack.code} · ${activeRack.name}?`)) return;
    setSaving(true);
    try {
      await post({ action: "deleteRack", id: activeRack.id });
      setSelectedCell(null);
      setHighlightCellId(null);
      await load();
      toast.success("Стеллаж удалён");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось удалить стеллаж");
    } finally { setSaving(false); }
  };

  if (loading) return <main className="flex min-h-screen items-center justify-center"><Loader2 className="animate-spin text-orange-500" size={34} /></main>;

  return <main className="min-h-screen px-3 py-4 text-[var(--foreground)] sm:px-5 lg:px-7">
    <div className="mx-auto max-w-[1750px] space-y-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Link href={base} data-same-tab="true" className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-blue-700 hover:underline"><ArrowLeft size={16} /> Назад в {data.warehouse.name.toLowerCase()}</Link>
          <p className="eyebrow">Адресное хранение · 3D · {data.warehouse.name}</p>
          <h1 className="page-title">Стеллажи склада краски</h1>
          <p className="page-description">Те же 3D-принципы, но данные, материалы и ячейки относятся только к складу краски.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setCreateOpen(true)} className="accent-button"><Plus /> Создать стеллаж</Button>
          <Button variant="outline" onClick={() => void renameRack()} disabled={!activeRack || saving}><Pencil size={15} /> Переименовать</Button>
          <Button variant="outline" onClick={() => void deleteRack()} disabled={!activeRack || saving} className="text-red-600"><Trash2 size={15} /> Удалить</Button>
        </div>
      </div>

      <section className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="panel p-4 sm:p-5">
          <div className="grid gap-4 xl:grid-cols-[360px_1fr] xl:items-end">
            <div>
              <Label>Найти материал на складе краски</Label>
              <div className="relative mt-2"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17} /><Input value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" placeholder="Название, артикул или штрихкод" /></div>
              {searchResults.length > 0 && <div className="mt-2 overflow-hidden rounded-xl border bg-white shadow-lg">{searchResults.map(({ product, stocks }) => <div key={product.id} className="border-b p-3 last:border-b-0"><div className="font-bold">{product.name}</div><div className="mt-1 flex flex-wrap gap-1.5">{stocks.map((stock) => { const cell = data.cells.find((item) => item.id === stock.cellId); return <button key={stock.cellId} type="button" onClick={() => locateCell(stock.cellId)} className="rounded-lg bg-orange-50 px-2.5 py-1.5 text-xs font-bold text-orange-800 hover:bg-orange-100">{cell?.code || "Ячейка"} · {fmt(stock.quantity)} {product.unit}</button>; })}</div></div>)}</div>}
            </div>
            <div>
              <Label>Стеллаж</Label>
              <div className="mt-2 flex flex-wrap gap-2">{data.racks.map((rack) => <button key={rack.id} type="button" onClick={() => { setActiveRackId(rack.id); setSelectedCell(null); setHighlightCellId(null); }} className={`rounded-xl border px-4 py-2 text-sm font-bold transition ${activeRack?.id === rack.id ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-white hover:border-slate-400"}`}>{rack.code} · {rack.name}</button>)}{!data.racks.length && <span className="text-sm text-slate-400">Стеллажей пока нет</span>}</div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 lg:grid-cols-1">
          <div className="panel p-4"><div className="text-xs font-semibold text-slate-500">Стеллажей</div><div className="mt-1 text-2xl font-black">{data.racks.length}</div></div>
          <div className="panel p-4"><div className="text-xs font-semibold text-slate-500">Ячеек</div><div className="mt-1 text-2xl font-black">{data.cells.length}</div></div>
          <div className="panel p-4"><div className="text-xs font-semibold text-slate-500">Материалов</div><div className="mt-1 text-2xl font-black">{data.products.length}</div></div>
        </div>
      </section>

      {activeRack ? <section id="department-rack-3d" className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <DepartmentRackThreeView
          rack={activeRack}
          cells={activeCells}
          stocks={richStocks}
          highlightCellId={highlightCellId}
          onCellClick={(cell) => { setSelectedCell(cell); setHighlightCellId(cell.id); }}
        />

        <aside className="panel h-fit p-5 xl:sticky xl:top-4">
          {selectedCell ? <>
            <div className="flex items-start justify-between gap-3"><div><p className="eyebrow">Ячейка</p><h2 className="mt-1 text-2xl font-black">{selectedCell.code}</h2><p className="mt-1 text-sm text-slate-500">{selectedCell.label}</p></div><div className="rounded-xl bg-slate-950 p-2.5 text-white"><MapPin size={20} /></div></div>
            <div className="mt-5 flex justify-center rounded-2xl border bg-white p-4"><QRCodeSVG value={`RL-CELL:${data.warehouse.code}:${selectedCell.code}`} size={180} level="M" /></div>
            <div className="mt-4 text-center text-xs font-mono text-slate-500">RL-CELL:{data.warehouse.code}:{selectedCell.code}</div>
            <div className="mt-5 space-y-2">
              {selectedStocks.map((stock) => <div key={stock.productId} className="rounded-xl border bg-slate-50 p-3"><div className="font-bold">{stock.productName}</div><div className="mt-1 text-sm text-slate-500">{fmt(stock.quantity)} {stock.unit}</div></div>)}
              {!selectedStocks.length && <div className="rounded-xl border border-dashed p-4 text-center text-sm text-slate-400">Ячейка свободна</div>}
            </div>
            <div className={`mt-4 rounded-xl px-3 py-2 text-sm font-semibold ${selectedCell.blocked ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>{selectedCell.blocked ? "Ячейка заблокирована" : "Ячейка активна"}</div>
          </> : <div className="py-10 text-center"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100"><QrCode size={22} /></div><h3 className="mt-4 font-black">Выберите ячейку</h3><p className="mt-2 text-sm leading-6 text-slate-500">Нажмите на ячейку в 3D-модели. Здесь появятся QR, материал и фактический остаток.</p></div>}
        </aside>
      </section> : <section className="panel p-14 text-center"><Layers3 className="mx-auto text-slate-300" size={42} /><h2 className="mt-4 text-xl font-black">Стеллажей пока нет</h2><p className="mt-2 text-sm text-slate-500">Создайте первый стеллаж для склада краски.</p><Button onClick={() => setCreateOpen(true)} className="accent-button mt-5"><Plus /> Создать стеллаж</Button></section>}
    </div>

    {createOpen && <div className="fixed inset-0 z-[12000] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setCreateOpen(false); }}>
      <div className="w-full max-w-md rounded-3xl border border-white/30 bg-white p-6 shadow-2xl">
        <div className="flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-950 text-white"><Layers3 size={20} /></div><div><h2 className="text-xl font-black">Новый стеллаж</h2><p className="text-xs text-slate-500">Только для {data.warehouse.name.toLowerCase()}</p></div></div>
        <form onSubmit={createRack} className="mt-6 space-y-4">
          <div><Label>Название</Label><Input name="name" required className="mt-1.5" placeholder="Стеллаж краски №1" /></div>
          <div><Label>Код</Label><Input name="code" required className="mt-1.5 uppercase" placeholder="K1" /></div>
          <div className="grid grid-cols-2 gap-3"><div><Label>Полок</Label><Input name="rows" type="number" min="1" max="12" defaultValue="4" className="mt-1.5" /></div><div><Label>Ячеек на полке</Label><Input name="columns" type="number" min="1" max="20" defaultValue="4" className="mt-1.5" /></div></div>
          <div className="flex gap-2 pt-2"><Button type="button" variant="outline" className="flex-1" onClick={() => setCreateOpen(false)} disabled={saving}>Отмена</Button><Button className="accent-button flex-1" disabled={saving}>{saving ? <Loader2 className="animate-spin" /> : <Plus />} Создать</Button></div>
        </form>
      </div>
    </div>}
  </main>;
}
