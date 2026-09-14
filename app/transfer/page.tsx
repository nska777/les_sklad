"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRightLeft, CheckCircle2, Loader2, MapPin, PackageSearch, QrCode, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { MobileBarcodeScanner } from "@/components/mobile-barcode-scanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Rack = { id: string; name: string; code: string; rows: number; columns: number };
type Cell = { id: string; rackId: string; code: string; rowIndex: number; columnIndex: number; blocked: boolean; side: "front" | "back" };
type Stock = { productId: string; cellId: string; quantity: number; productName: string; sku: string; barcode: string; unit: string };
type Product = { id: string; name: string; sku: string; barcode: string; unit: string };
type User = { name: string; role: "admin" | "manager" | "storekeeper" | "viewer" };
type ApiResult = { racks: Rack[]; cells: Cell[]; stocks: Stock[]; products: Product[]; error?: string };

const qty = (value: number) => Number(value || 0).toLocaleString("ru-RU", { maximumFractionDigits: 3 });

export default function TransferPage() {
  const [data, setData] = useState<ApiResult>({ racks: [], cells: [], stocks: [], products: [] });
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sourceCode, setSourceCode] = useState("");
  const [destinationCode, setDestinationCode] = useState("");
  const [fromCellId, setFromCellId] = useState("");
  const [productId, setProductId] = useState("");
  const [amount, setAmount] = useState("");
  const [toCellId, setToCellId] = useState("");

  const load = useCallback(async () => {
    try {
      const [warehouseResponse, meResponse] = await Promise.all([
        fetch("/api/rack-layout", { cache: "no-store" }),
        fetch("/api/auth/me", { cache: "no-store" }),
      ]);
      const result = await warehouseResponse.json() as ApiResult;
      if (!warehouseResponse.ok) throw new Error(result.error || "Не удалось загрузить склад");
      setData(result);
      if (meResponse.ok) setUser(((await meResponse.json()) as { user?: User }).user || null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось загрузить склад");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const sourceCell = data.cells.find((cell) => cell.id === fromCellId);
  const targetCell = data.cells.find((cell) => cell.id === toCellId);
  const sourceStocks = useMemo(() => data.stocks.filter((stock) => stock.cellId === fromCellId && stock.quantity > 0), [data.stocks, fromCellId]);
  const selectedStock = sourceStocks.find((stock) => stock.productId === productId);
  const product = data.products.find((item) => item.id === productId);
  const targetStocks = data.stocks.filter((stock) => stock.cellId === toCellId && stock.quantity > 0);
  const foreignTargetStock = targetStocks.find((stock) => stock.productId !== productId);

  const cellDescription = (cell?: Cell) => {
    if (!cell) return "";
    const rack = data.racks.find((item) => item.id === cell.rackId);
    return `${rack?.code || "Стеллаж"} · ${cell.side === "back" ? "Задняя" : "Лицевая"} · Полка ${cell.rowIndex + 1}`;
  };

  const resetAll = () => {
    setSourceCode("");
    setDestinationCode("");
    setFromCellId("");
    setProductId("");
    setAmount("");
    setToCellId("");
  };

  const acceptSourceCell = useCallback((raw: string) => {
    const value = raw.trim().toUpperCase();
    if (!value) return;
    const cell = data.cells.find((item) => item.code.trim().toUpperCase() === value);
    if (!cell || cell.blocked) return toast.error("Исходная ячейка не найдена или заблокирована");
    const stocks = data.stocks.filter((stock) => stock.cellId === cell.id && stock.quantity > 0);
    if (!stocks.length) return toast.error(`Ячейка ${cell.code} пустая`);

    setFromCellId(cell.id);
    setSourceCode(cell.code);
    setToCellId("");
    setDestinationCode("");
    setAmount("");

    if (stocks.length === 1) {
      setProductId(stocks[0].productId);
      setAmount(String(stocks[0].quantity));
      toast.success(`Ячейка ${cell.code} подтверждена`, { description: stocks[0].productName });
    } else {
      setProductId("");
      toast.success(`Ячейка ${cell.code} подтверждена`, { description: `Материалов: ${stocks.length}. Выберите нужный.` });
    }
  }, [data.cells, data.stocks]);

  const submitSource = (event: FormEvent) => {
    event.preventDefault();
    acceptSourceCell(sourceCode);
  };

  const chooseProduct = (stock: Stock) => {
    setProductId(stock.productId);
    setAmount(String(stock.quantity));
    setToCellId("");
    setDestinationCode("");
    toast.success("Материал выбран", { description: `${stock.productName} · доступно ${qty(stock.quantity)} ${stock.unit}` });
  };

  const acceptDestinationCell = useCallback((raw: string) => {
    if (!fromCellId || !productId) return toast.error("Сначала отсканируйте исходную ячейку и выберите материал");
    const value = raw.trim().toUpperCase();
    if (!value) return;
    const cell = data.cells.find((item) => item.code.trim().toUpperCase() === value);
    if (!cell || cell.blocked) return toast.error("Новая ячейка не найдена или заблокирована");
    if (cell.id === fromCellId) return toast.error("Нужно выбрать другую ячейку");

    const occupiedByOther = data.stocks.find((stock) => stock.cellId === cell.id && stock.quantity > 0 && stock.productId !== productId);
    if (occupiedByOther) {
      return toast.error(`Ячейка ${cell.code} занята другим материалом`, { description: occupiedByOther.productName });
    }

    setToCellId(cell.id);
    setDestinationCode(cell.code);
    toast.success(`Новая ячейка ${cell.code} подтверждена`);
  }, [data.cells, data.stocks, fromCellId, productId]);

  const submitDestination = (event: FormEvent) => {
    event.preventDefault();
    acceptDestinationCell(destinationCode);
  };

  const value = Number(amount);
  const amountValid = Boolean(selectedStock && Number.isFinite(value) && value > 0 && value <= selectedStock.quantity);
  const ready = Boolean(fromCellId && productId && amountValid && toCellId && !foreignTargetStock);
  const progress = !fromCellId ? 0 : !productId ? 25 : !amountValid ? 50 : !toCellId ? 75 : 100;
  const canWrite = user?.role !== "viewer";

  const transfer = async () => {
    if (!ready || !selectedStock || !sourceCell || !targetCell) return toast.error("Пройдите все шаги перемещения");
    setSaving(true);
    try {
      const response = await fetch("/api/rack-layout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "moveStock",
          productId,
          fromCellId,
          toCellId,
          quantity: value,
          operator: user?.name || "Кладовщик",
        }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "Не удалось переместить");

      toast.success("Материал перемещён", {
        description: `${selectedStock.productName}: ${qty(value)} ${selectedStock.unit} · ${sourceCell.code} → ${targetCell.code}`,
      });
      resetAll();
      await load();
      window.dispatchEvent(new CustomEvent("warehouse-data-refresh"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось переместить");
      await load();
    } finally {
      setSaving(false);
    }
  };

  return <main className="min-h-screen px-3 py-4 text-[var(--foreground)] sm:px-5 lg:px-7">
    <div className="mx-auto max-w-[1250px] space-y-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Link href="/" className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-blue-700 hover:underline"><ArrowLeft size={16} /> Назад в склад</Link>
          <p className="eyebrow">Сканирование по факту</p>
          <h1 className="page-title">Перемещение материала</h1>
          <p className="page-description">Исходная ячейка → материал и количество → новая ячейка → подтверждение.</p>
        </div>
        {user && <div className="flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm"><ShieldCheck size={16} className="text-blue-600" /><b>{user.name}</b></div>}
      </div>

      {!canWrite && <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-800">У роли «Просмотр» нет права выполнять перемещения.</div>}

      <section className="panel overflow-hidden p-4 sm:p-6">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-bold uppercase tracking-[.14em] text-slate-400">Прогресс перемещения</div>
            <div className="mt-1 text-lg font-extrabold">{progress}%</div>
          </div>
          {ready && <div className="flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700"><CheckCircle2 size={18} /> Готово к перемещению</div>}
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500 transition-all duration-300" style={{ width: `${progress}%` }} /></div>
      </section>

      {loading ? <div className="panel flex min-h-72 items-center justify-center"><Loader2 className="animate-spin" /></div> : <div className="grid gap-4 lg:grid-cols-2">
        <section className={`panel p-4 sm:p-6 ${fromCellId ? "ring-1 ring-emerald-200" : ""}`}>
          <div className="flex items-start justify-between gap-3">
            <div><div className="text-xs font-bold uppercase tracking-[.14em] text-slate-400">Шаг 1</div><h2 className="mt-1 text-xl font-extrabold">Откуда забираем</h2></div>
            {fromCellId ? <CheckCircle2 className="text-emerald-600" /> : <QrCode className="text-blue-600" />}
          </div>
          <p className="mt-2 text-sm text-slate-500">Подойдите к физической ячейке и отсканируйте её QR.</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
            <form onSubmit={submitSource}><Input value={sourceCode} onChange={(e) => setSourceCode(e.target.value)} placeholder="Код ячейки, например ST11A" className="h-11" /></form>
            <MobileBarcodeScanner label="Сканировать QR" onDetected={acceptSourceCell} />
          </div>
          {sourceCell && <div className="mt-4 rounded-2xl bg-slate-50 p-4"><div className="flex items-center gap-2 font-mono text-xl font-black"><MapPin size={18} /> {sourceCell.code}</div><div className="mt-1 text-sm text-slate-500">{cellDescription(sourceCell)}</div></div>}
        </section>

        <section className={`panel p-4 sm:p-6 ${productId && amountValid ? "ring-1 ring-emerald-200" : ""}`}>
          <div className="flex items-start justify-between gap-3">
            <div><div className="text-xs font-bold uppercase tracking-[.14em] text-slate-400">Шаг 2</div><h2 className="mt-1 text-xl font-extrabold">Что и сколько</h2></div>
            {productId && amountValid ? <CheckCircle2 className="text-emerald-600" /> : <PackageSearch className="text-blue-600" />}
          </div>
          {!fromCellId ? <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Сначала отсканируйте исходную ячейку.</div> : <>
            <div className="mt-4 space-y-2">
              {sourceStocks.map((stock) => <button key={stock.productId} type="button" onClick={() => chooseProduct(stock)} className={`w-full rounded-xl border p-3 text-left transition ${productId === stock.productId ? "border-blue-500 bg-blue-50" : "bg-white hover:bg-slate-50"}`}>
                <div className="font-bold">{stock.productName}</div>
                <div className="mt-1 text-xs text-slate-500"><span className="font-mono">{stock.sku}</span> · В ячейке {qty(stock.quantity)} {stock.unit}</div>
              </button>)}
            </div>
            {selectedStock && <div className="mt-4"><Label>Количество для перемещения · максимум {qty(selectedStock.quantity)} {selectedStock.unit}</Label><Input type="number" min="0.001" max={selectedStock.quantity} step="any" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-2 h-12 text-lg font-bold" /></div>}
          </>}
        </section>

        <section className={`panel p-4 sm:p-6 ${toCellId ? "ring-1 ring-emerald-200" : ""}`}>
          <div className="flex items-start justify-between gap-3">
            <div><div className="text-xs font-bold uppercase tracking-[.14em] text-slate-400">Шаг 3</div><h2 className="mt-1 text-xl font-extrabold">Куда переносим</h2></div>
            {toCellId ? <CheckCircle2 className="text-emerald-600" /> : <QrCode className="text-blue-600" />}
          </div>
          <p className="mt-2 text-sm text-slate-500">Подойдите к новой ячейке и отсканируйте её QR. Занятую другим материалом ячейку система не примет.</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
            <form onSubmit={submitDestination}><Input disabled={!productId || !amountValid} value={destinationCode} onChange={(e) => setDestinationCode(e.target.value)} placeholder="QR новой ячейки" className="h-11" /></form>
            <MobileBarcodeScanner disabled={!productId || !amountValid} label="Сканировать QR" onDetected={acceptDestinationCell} />
          </div>
          {targetCell && <div className="mt-4 rounded-2xl bg-emerald-50 p-4"><div className="flex items-center gap-2 font-mono text-xl font-black text-emerald-900"><MapPin size={18} /> {targetCell.code}</div><div className="mt-1 text-sm text-emerald-700">{cellDescription(targetCell)}</div></div>}
        </section>

        <section className={`panel p-4 sm:p-6 ${ready ? "ring-2 ring-emerald-300" : ""}`}>
          <div className="text-xs font-bold uppercase tracking-[.14em] text-slate-400">Шаг 4</div>
          <h2 className="mt-1 text-xl font-extrabold">Подтверждение</h2>
          {ready && selectedStock && sourceCell && targetCell ? <div className="mt-4 space-y-3">
            <div className="rounded-2xl bg-slate-50 p-4"><div className="font-bold">{selectedStock.productName}</div><div className="mt-1 text-sm text-slate-500">{qty(value)} {selectedStock.unit}</div><div className="mt-3 flex items-center gap-2 font-mono font-black"><span>{sourceCell.code}</span><ArrowRightLeft size={18} className="text-blue-600" /><span>{targetCell.code}</span></div></div>
            <Button disabled={!canWrite || saving} onClick={() => void transfer()} className="accent-button h-13 w-full text-base">{saving ? <Loader2 className="animate-spin" /> : <ArrowRightLeft />} Переместить</Button>
          </div> : <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">После подтверждения трёх шагов здесь появится итоговый маршрут.</div>}
        </section>
      </div>}
    </div>
  </main>;
}
