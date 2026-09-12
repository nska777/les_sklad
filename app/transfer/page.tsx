"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRightLeft, Boxes, Loader2, MapPin, Search, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

type Rack = { id: string; name: string; code: string; rows: number; columns: number };
type Cell = { id: string; rackId: string; code: string; rowIndex: number; columnIndex: number; blocked: boolean; side: "front" | "back" };
type Stock = { productId: string; cellId: string; quantity: number; productName: string; sku: string; barcode: string; unit: string };
type Product = { id: string; name: string; sku: string; barcode: string; unit: string };
type User = { name: string; role: "admin" | "manager" | "storekeeper" | "viewer" };
type ApiResult = { racks: Rack[]; cells: Cell[]; stocks: Stock[]; products: Product[]; error?: string };

const qty = (value: number) => value.toLocaleString("ru-RU", { maximumFractionDigits: 3 });

export default function TransferPage() {
  const [data, setData] = useState<ApiResult>({ racks: [], cells: [], stocks: [], products: [] });
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [productId, setProductId] = useState("");
  const [fromCellId, setFromCellId] = useState("");
  const [rackId, setRackId] = useState("");
  const [side, setSide] = useState<"front" | "back">("front");
  const [shelf, setShelf] = useState("");
  const [toCellId, setToCellId] = useState("");
  const [amount, setAmount] = useState("");

  const load = useCallback(async () => {
    try {
      const [warehouseResponse, meResponse] = await Promise.all([fetch("/api/rack-layout", { cache: "no-store" }), fetch("/api/auth/me", { cache: "no-store" })]);
      const result = await warehouseResponse.json() as ApiResult;
      if (!warehouseResponse.ok) throw new Error(result.error || "Не удалось загрузить склад");
      setData(result);
      if (meResponse.ok) setUser(((await meResponse.json()) as { user?: User }).user || null);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось загрузить склад"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const products = useMemo(() => {
    const q = query.trim().toLowerCase();
    const stockedIds = new Set(data.stocks.filter((stock) => stock.quantity > 0).map((stock) => stock.productId));
    return data.products.filter((product) => stockedIds.has(product.id) && (!q || `${product.name} ${product.sku} ${product.barcode}`.toLowerCase().includes(q))).slice(0, 40);
  }, [data.products, data.stocks, query]);
  const product = data.products.find((item) => item.id === productId);
  const sourceStocks = data.stocks.filter((stock) => stock.productId === productId && stock.quantity > 0);
  const sourceStock = sourceStocks.find((stock) => stock.cellId === fromCellId);
  const rackCells = data.cells.filter((cell) => cell.rackId === rackId && !cell.blocked);
  const hasBack = rackCells.some((cell) => cell.side === "back");
  const sideCells = rackCells.filter((cell) => cell.side === side);
  const shelves = useMemo(() => Array.from(new Set(sideCells.map((cell) => cell.rowIndex + 1))).sort((a, b) => a - b), [sideCells]);
  const destinationCells = sideCells.filter((cell) => String(cell.rowIndex + 1) === shelf && cell.id !== fromCellId).sort((a, b) => a.columnIndex - b.columnIndex);

  useEffect(() => { if (side === "back" && !hasBack) setSide("front"); }, [hasBack, side]);
  useEffect(() => { if (!shelves.includes(Number(shelf))) setShelf(shelves[0] ? String(shelves[0]) : ""); setToCellId(""); }, [rackId, side, shelves.join(",")]);
  useEffect(() => { setFromCellId(""); setAmount(""); setToCellId(""); }, [productId]);

  const selectSource = (cellId: string, quantity: number) => {
    setFromCellId(cellId);
    setAmount(String(quantity));
    setToCellId("");
    const source = data.cells.find((cell) => cell.id === cellId);
    const alternative = data.racks.find((rack) => rack.id !== source?.rackId) || data.racks[0];
    setRackId(alternative?.id || "");
    setSide("front");
  };

  const transfer = async () => {
    if (!productId || !fromCellId || !toCellId || !sourceStock) return toast.error("Заполните маршрут перемещения");
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0 || value > sourceStock.quantity) return toast.error(`Доступно максимум ${qty(sourceStock.quantity)}`);
    setSaving(true);
    try {
      const response = await fetch("/api/rack-layout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "moveStock", productId, fromCellId, toCellId, quantity: value, operator: user?.name || "Кладовщик" }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "Не удалось переместить");
      toast.success("Перемещение сохранено");
      setProductId(""); setFromCellId(""); setToCellId(""); setAmount(""); setQuery("");
      await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось переместить"); }
    finally { setSaving(false); }
  };

  const canWrite = user?.role !== "viewer";

  return <main className="min-h-screen px-3 py-4 text-[var(--foreground)] sm:px-5 lg:px-7"><div className="mx-auto max-w-[1550px] space-y-4">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><Link href="/" className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-blue-700 hover:underline"><ArrowLeft size={16} /> Назад в склад</Link><p className="eyebrow">Физический маршрут</p><h1 className="page-title">Перемещение материала</h1><p className="page-description">Материал → текущее место → новый стеллаж → сторона → полка → ячейка.</p></div>{user && <div className="flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm"><ShieldCheck size={16} className="text-blue-600" /><b>{user.name}</b></div>}</div>

    {!canWrite && <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-800">У роли «Просмотр» нет права выполнять перемещения.</div>}

    <section className="grid gap-4 xl:grid-cols-[.9fr_1.1fr]">
      <div className="panel overflow-hidden"><div className="border-b p-4"><Label>1. Материал</Label><div className="relative mt-2"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Название, RL-код, штрихкод" className="pl-10" /></div></div><div className="max-h-[60vh] divide-y overflow-y-auto">{products.map((item) => <button key={item.id} type="button" onClick={() => setProductId(item.id)} className={`w-full p-4 text-left transition ${productId === item.id ? "bg-blue-50 ring-1 ring-inset ring-blue-300" : "hover:bg-slate-50"}`}><div className="font-semibold">{item.name}</div><div className="mt-1 font-mono text-xs text-slate-500">{item.sku}</div></button>)}</div></div>

      <div className="panel p-4 sm:p-5"><div className="flex items-center gap-2 font-bold"><ArrowRightLeft size={20} className="text-blue-600" /> 2. Маршрут</div>{!product ? <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Сначала выберите материал слева.</div> : <div className="mt-5 space-y-5">
        <div><Label>Откуда забрать</Label><div className="mt-2 grid gap-2 sm:grid-cols-2">{sourceStocks.map((stock) => { const cell = data.cells.find((item) => item.id === stock.cellId); return cell ? <button type="button" key={stock.cellId} onClick={() => selectSource(stock.cellId, stock.quantity)} className={`rounded-xl border p-3 text-left ${fromCellId === stock.cellId ? "border-blue-500 bg-blue-600 text-white" : "bg-white hover:bg-blue-50"}`}><div className="flex items-center gap-1 font-mono font-bold"><MapPin size={14} />{cell.code}</div><div className="mt-1 text-sm opacity-75">Доступно {qty(stock.quantity)} {product.unit}</div></button> : null; })}</div></div>
        {fromCellId && <><div><Label>Новый стеллаж</Label><NativeSelect value={rackId} onChange={(event) => setRackId(event.target.value)} className="mt-2 w-full"><NativeSelectOption value="">Выберите</NativeSelectOption>{data.racks.map((rack) => <NativeSelectOption key={rack.id} value={rack.id}>{rack.code} · {rack.name}</NativeSelectOption>)}</NativeSelect></div><div className="grid gap-4 sm:grid-cols-2"><div><Label>Сторона</Label><NativeSelect value={side} onChange={(event) => setSide(event.target.value as "front" | "back")} className="mt-2 w-full"><NativeSelectOption value="front">Лицевая</NativeSelectOption>{hasBack && <NativeSelectOption value="back">Задняя</NativeSelectOption>}</NativeSelect></div><div><Label>Полка</Label><NativeSelect value={shelf} onChange={(event) => setShelf(event.target.value)} className="mt-2 w-full">{shelves.map((number) => <NativeSelectOption key={number} value={String(number)}>Полка {number}</NativeSelectOption>)}</NativeSelect></div></div><div><Label>Новая ячейка</Label><div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">{destinationCells.map((cell) => <button key={cell.id} type="button" onClick={() => setToCellId(cell.id)} className={`rounded-xl border p-3 text-left ${toCellId === cell.id ? "border-blue-500 bg-blue-600 text-white" : "bg-white hover:bg-blue-50"}`}><div className="text-xs opacity-70">Место {String.fromCharCode(65 + cell.columnIndex)}</div><b className="font-mono">{cell.code}</b></button>)}</div></div><div><Label>Количество · максимум {qty(sourceStock?.quantity || 0)}</Label><Input className="mt-2" type="number" min="0.001" max={sourceStock?.quantity} step="any" value={amount} onChange={(event) => setAmount(event.target.value)} /></div><Button disabled={!canWrite || saving || !toCellId || Number(amount) <= 0} onClick={() => void transfer()} className="accent-button h-12 w-full">{saving ? <Loader2 className="animate-spin" /> : <ArrowRightLeft />} Переместить</Button></>}
      </div>}</div>
    </section>
  </div></main>;
}
