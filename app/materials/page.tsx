"use client";

import Link from "next/link";
import { useCallback, useMemo, useState, useEffect } from "react";
import { ArrowLeft, ArrowRightLeft, Boxes, Layers3, Loader2, MapPin, Search, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

type Rack = { id: string; name: string; code: string; rows: number; columns: number };
type Cell = { id: string; rackId: string; code: string; rowIndex: number; columnIndex: number; blocked: boolean; side: "front" | "back" };
type Stock = { productId: string; cellId: string; quantity: number; productName: string; sku: string; barcode: string; unit: string };
type Product = { id: string; name: string; sku: string; barcode: string; unit: string };
type ApiResult = { racks: Rack[]; cells: Cell[]; stocks: Stock[]; products: Product[]; error?: string };
type User = { username: string; name: string; role: "admin" | "manager" | "storekeeper" | "viewer" };
type MoveState = { product: Product; fromCellId: string; max: number } | null;

const qty = (value: number) => value.toLocaleString("ru-RU", { maximumFractionDigits: 3 });
const roleName = (role?: User["role"]) => role === "admin" ? "Администратор" : role === "manager" ? "Заведующий" : role === "storekeeper" ? "Кладовщик" : "Просмотр";

export default function MaterialsPage() {
  const [data, setData] = useState<ApiResult>({ racks: [], cells: [], stocks: [], products: [] });
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [move, setMove] = useState<MoveState>(null);
  const [rackId, setRackId] = useState("");
  const [side, setSide] = useState<"front" | "back">("front");
  const [shelf, setShelf] = useState("");
  const [cellId, setCellId] = useState("");
  const [amount, setAmount] = useState("");

  const load = useCallback(async () => {
    try {
      const [warehouseResponse, meResponse] = await Promise.all([
        fetch("/api/rack-layout", { cache: "no-store" }),
        fetch("/api/auth/me", { cache: "no-store" }),
      ]);
      const result = await warehouseResponse.json() as ApiResult;
      if (!warehouseResponse.ok) throw new Error(result.error || "Не удалось загрузить материалы");
      setData(result);
      if (meResponse.ok) {
        const me = await meResponse.json() as { user?: User };
        setUser(me.user || null);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось загрузить материалы");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const canWrite = user?.role !== "viewer";
  const operator = user?.name || "Кладовщик";
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return data.products;
    return data.products.filter((product) => `${product.name} ${product.sku} ${product.barcode}`.toLowerCase().includes(q));
  }, [data.products, query]);

  const rackCells = useMemo(() => data.cells.filter((cell) => cell.rackId === rackId && !cell.blocked), [data.cells, rackId]);
  const hasBack = rackCells.some((cell) => cell.side === "back");
  const sideCells = rackCells.filter((cell) => cell.side === side);
  const shelves = useMemo(() => Array.from(new Set(sideCells.map((cell) => cell.rowIndex + 1))).sort((a, b) => a - b), [sideCells]);
  const destinationCells = sideCells.filter((cell) => String(cell.rowIndex + 1) === shelf).sort((a, b) => a.columnIndex - b.columnIndex);

  useEffect(() => {
    if (side === "back" && !hasBack) setSide("front");
  }, [hasBack, side]);
  useEffect(() => {
    if (!shelves.includes(Number(shelf))) setShelf(shelves[0] ? String(shelves[0]) : "");
    setCellId("");
  }, [rackId, side, shelves.join(",")]);

  const openMove = (product: Product, fromCellId: string, max: number) => {
    if (!canWrite) return toast.error("Для роли «Просмотр» перемещения недоступны");
    setMove({ product, fromCellId, max });
    const firstRack = data.racks.find((rack) => data.cells.some((cell) => cell.rackId === rack.id && cell.id !== fromCellId && !cell.blocked));
    setRackId(firstRack?.id || "");
    setSide("front");
    setShelf("");
    setCellId("");
    setAmount(String(max));
  };

  const saveMove = async () => {
    if (!canWrite) return toast.error("Недостаточно прав");
    if (!move || !cellId) return toast.error("Выберите новую ячейку");
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0 || value > move.max) return toast.error(`Количество должно быть от 0 до ${qty(move.max)}`);
    if (cellId === move.fromCellId) return toast.error("Выберите другую ячейку");
    setSaving(true);
    try {
      const response = await fetch("/api/rack-layout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "moveStock", productId: move.product.id, fromCellId: move.fromCellId, toCellId: cellId, quantity: value, operator }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Не удалось переместить материал");
      toast.success("Материал перемещён");
      setMove(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось переместить материал");
    } finally { setSaving(false); }
  };

  return <main className="min-h-screen px-3 py-4 text-[var(--foreground)] sm:px-5 lg:px-7">
    <div className="mx-auto max-w-[1650px] space-y-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Link href="/" className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-blue-700 hover:underline"><ArrowLeft size={16} /> Назад в склад</Link>
          <p className="eyebrow">Карта хранения</p>
          <h1 className="page-title">Материалы склада</h1>
          <p className="page-description">Общий остаток, все места хранения и переход к конкретной ячейке в 3D.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {user && <div className="flex items-center gap-2 rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"><ShieldCheck size={16} className="text-blue-600" /><div><b>{user.name}</b><div className="text-xs text-slate-500">{roleName(user.role)}</div></div></div>}
          <Button asChild variant="outline"><Link href="/rack-layout"><Layers3 /> 3D-стеллажи</Link></Button>
        </div>
      </div>

      <section className="panel overflow-hidden">
        <div className="border-b border-black/10 p-3 sm:p-4">
          <div className="relative max-w-3xl"><Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Название, RL-код или штрихкод" className="h-11 pl-11" /></div>
        </div>

        {loading ? <div className="flex min-h-80 items-center justify-center"><Loader2 className="animate-spin" /></div> : <div className="divide-y divide-black/10">
          {filtered.map((product) => {
            const stocks = data.stocks.filter((stock) => stock.productId === product.id && stock.quantity > 0);
            const total = stocks.reduce((sum, stock) => sum + stock.quantity, 0);
            return <article key={product.id} className="grid gap-4 p-4 sm:p-5 xl:grid-cols-[minmax(260px,1.5fr)_140px_minmax(340px,2fr)] xl:items-start">
              <div className="min-w-0"><div className="flex items-start gap-3"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700"><Boxes size={20} /></div><div className="min-w-0"><div className="break-words font-bold">{product.name}</div><div className="mt-1 font-mono text-xs text-slate-500">{product.sku} · {product.barcode}</div></div></div></div>
              <div className="rounded-2xl bg-slate-50 p-3 xl:text-right"><div className="text-xs text-slate-500">Всего на складе</div><div className="mt-1 text-2xl font-bold">{qty(total)} <span className="text-sm font-medium text-slate-500">{product.unit}</span></div></div>
              <div><div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Места хранения</div>{stocks.length ? <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">{stocks.map((stock) => {
                const cell = data.cells.find((item) => item.id === stock.cellId);
                const rack = data.racks.find((item) => item.id === cell?.rackId);
                if (!cell) return null;
                return <div key={stock.cellId} className="rounded-2xl border border-black/10 bg-white p-3"><div className="flex items-start justify-between gap-2"><div><div className="flex items-center gap-1.5 font-mono font-bold"><MapPin size={14} />{cell.code}</div><div className="mt-1 text-xs text-slate-500">{rack?.name || rack?.code || "Стеллаж"} · {cell.side === "front" ? "лицевая" : "задняя"} · полка {cell.rowIndex + 1}</div></div><b>{qty(stock.quantity)}</b></div><div className="mt-3 grid grid-cols-2 gap-2"><Button asChild size="sm" variant="outline"><Link href={`/rack-layout?cell=${encodeURIComponent(cell.id)}`}><Layers3 /> 3D</Link></Button><Button size="sm" disabled={!canWrite} onClick={() => openMove(product, cell.id, stock.quantity)}><ArrowRightLeft /> Переместить</Button></div></div>;
              })}</div> : <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Материал пока не размещён.</div>}</div>
            </article>;
          })}
          {!filtered.length && <div className="p-12 text-center text-slate-500">Материалы не найдены</div>}
        </div>}
      </section>
    </div>

    <Dialog open={!!move} onOpenChange={(open) => !open && setMove(null)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        {move && <><DialogHeader><DialogTitle>Переместить материал</DialogTitle><DialogDescription>{move.product.name} · доступно в исходной ячейке {qty(move.max)} {move.product.unit}. Выберите новое место по физической архитектуре.</DialogDescription></DialogHeader>
        <div className="mt-5 space-y-5">
          <div><Label>Стеллаж</Label><NativeSelect value={rackId} onChange={(event) => setRackId(event.target.value)} className="mt-2 w-full"><NativeSelectOption value="">Выберите стеллаж</NativeSelectOption>{data.racks.map((rack) => <NativeSelectOption key={rack.id} value={rack.id}>{rack.code} · {rack.name}</NativeSelectOption>)}</NativeSelect></div>
          <div className="grid gap-4 sm:grid-cols-2"><div><Label>Сторона</Label><NativeSelect value={side} onChange={(event) => setSide(event.target.value as "front" | "back")} className="mt-2 w-full"><NativeSelectOption value="front">Лицевая</NativeSelectOption>{hasBack && <NativeSelectOption value="back">Задняя</NativeSelectOption>}</NativeSelect></div><div><Label>Полка</Label><NativeSelect value={shelf} onChange={(event) => { setShelf(event.target.value); setCellId(""); }} className="mt-2 w-full"><NativeSelectOption value="">Выберите полку</NativeSelectOption>{shelves.map((number) => <NativeSelectOption key={number} value={String(number)}>Полка {number}</NativeSelectOption>)}</NativeSelect></div></div>
          <div><Label>Новая ячейка</Label><div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">{destinationCells.filter((cell) => cell.id !== move.fromCellId).map((cell) => <button type="button" key={cell.id} onClick={() => setCellId(cell.id)} className={`rounded-xl border px-3 py-3 text-left transition ${cellId === cell.id ? "border-blue-500 bg-blue-600 text-white shadow" : "border-black/10 bg-white hover:border-blue-300 hover:bg-blue-50"}`}><div className="text-xs opacity-70">Место {String.fromCharCode(65 + cell.columnIndex)}</div><b className="font-mono">{cell.code}</b></button>)}</div></div>
          <div><Label>Количество</Label><Input className="mt-2" type="number" min="0.001" max={move.max} step="any" value={amount} onChange={(event) => setAmount(event.target.value)} /></div>
        </div>
        <DialogFooter className="mt-6"><Button variant="outline" onClick={() => setMove(null)}>Отмена</Button><Button disabled={saving || !cellId || Number(amount) <= 0 || Number(amount) > move.max} onClick={() => void saveMove()}>{saving ? <Loader2 className="animate-spin" /> : <ArrowRightLeft />} Переместить</Button></DialogFooter></>}
      </DialogContent>
    </Dialog>
  </main>;
}
