"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { ArrowLeft, ArrowRightLeft, CheckCircle2, Loader2, MapPin, PackageSearch, QrCode, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { MobileBarcodeScanner } from "@/components/mobile-barcode-scanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Rack = { id: string; code: string; name: string; storageType: string };
type Cell = { id: string; rackId: string; code: string; blocked: boolean; rowIndex?: number; columnIndex?: number };
type Product = { id: string; name: string; sku: string; barcode: string; unit: string };
type Stock = { productId: string; cellId: string; quantity: number };
type ApiData = { racks: Rack[]; cells: Cell[]; products: Product[]; stocks: Stock[]; error?: string };

const fmt = (v: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 9 }).format(v);

export default function DepartmentTransferPage() {
  const params = useParams<{ warehouse: string }>();
  const warehouse = String(params?.warehouse || "paint");
  const base = `/department/${warehouse}`;

  const [data, setData] = useState<ApiData>({ racks: [], cells: [], products: [], stocks: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sourceCode, setSourceCode] = useState("");
  const [destinationCode, setDestinationCode] = useState("");
  const [fromCellId, setFromCellId] = useState("");
  const [toCellId, setToCellId] = useState("");
  const [productId, setProductId] = useState("");
  const [amount, setAmount] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/department-warehouse", { cache: "no-store" });
      const body = await response.json() as ApiData;
      if (!response.ok) throw new Error(body.error || "Не удалось загрузить склад");
      setData(body);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось загрузить склад");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const rackById = useMemo(() => new Map(data.racks.map((r) => [r.id, r])), [data.racks]);
  const productById = useMemo(() => new Map(data.products.map((p) => [p.id, p])), [data.products]);
  const sourceCell = data.cells.find((c) => c.id === fromCellId);
  const destinationCell = data.cells.find((c) => c.id === toCellId);
  const sourceStocks = useMemo(() => data.stocks.filter((s) => s.cellId === fromCellId && Number(s.quantity) > 0), [data.stocks, fromCellId]);
  const selectedStock = sourceStocks.find((s) => s.productId === productId);
  const selectedProduct = productById.get(productId);
  const destinationStocks = useMemo(() => data.stocks.filter((s) => s.cellId === toCellId && Number(s.quantity) > 0), [data.stocks, toCellId]);
  const destinationDistinct = new Set(destinationStocks.map((s) => s.productId));
  const destinationHasContent = destinationStocks.length > 0;
  const wouldExceedFive = Boolean(productId && !destinationDistinct.has(productId) && destinationDistinct.size >= 5);

  const cellDescription = (cell?: Cell) => {
    if (!cell) return "";
    const rack = rackById.get(cell.rackId);
    if (!rack) return cell.code;
    if (rack.storageType === "floor") return `Напольная зона ${rack.code}`;
    return `Стеллаж ${rack.code}${cell.rowIndex !== undefined ? ` · полка ${cell.rowIndex + 1}` : ""}`;
  };

  const reset = () => {
    setSourceCode(""); setDestinationCode(""); setFromCellId(""); setToCellId(""); setProductId(""); setAmount("");
  };

  const acceptSource = useCallback((raw: string) => {
    const value = raw.trim().toUpperCase();
    if (!value) return;
    const cell = data.cells.find((c) => c.code.trim().toUpperCase() === value);
    if (!cell || cell.blocked) return toast.error("Исходная ячейка не найдена или заблокирована");
    const stocks = data.stocks.filter((s) => s.cellId === cell.id && Number(s.quantity) > 0);
    if (!stocks.length) return toast.error(`Ячейка ${cell.code} пустая`);
    setFromCellId(cell.id); setSourceCode(cell.code); setToCellId(""); setDestinationCode(""); setAmount("");
    if (stocks.length === 1) {
      setProductId(stocks[0].productId); setAmount(String(stocks[0].quantity));
      const p = productById.get(stocks[0].productId);
      toast.success(`Ячейка ${cell.code} подтверждена`, { description: p?.name });
    } else {
      setProductId("");
      toast.success(`Ячейка ${cell.code} подтверждена`, { description: `В ячейке ${stocks.length} материалов — выберите нужный.` });
    }
  }, [data.cells, data.stocks, productById]);

  const acceptDestination = useCallback((raw: string) => {
    if (!fromCellId || !productId) return toast.error("Сначала отсканируйте исходную ячейку и выберите материал");
    const value = raw.trim().toUpperCase();
    if (!value) return;
    const cell = data.cells.find((c) => c.code.trim().toUpperCase() === value);
    if (!cell || cell.blocked) return toast.error("Ячейка назначения не найдена или заблокирована");
    if (cell.id === fromCellId) return toast.error("Нужно выбрать другую ячейку");
    const contents = data.stocks.filter((s) => s.cellId === cell.id && Number(s.quantity) > 0);
    const distinct = new Set(contents.map((s) => s.productId));
    if (!distinct.has(productId) && distinct.size >= 5) return toast.error("В этой ячейке уже 5 разных материалов — шестой добавить нельзя");
    setToCellId(cell.id); setDestinationCode(cell.code);
    if (contents.length) {
      toast.warning(`В ячейке ${cell.code} уже есть материалы`, { description: `Позиций: ${distinct.size}. Перемещение разрешено.` });
    } else {
      toast.success(`Ячейка ${cell.code} свободна и подтверждена`);
    }
  }, [data.cells, data.stocks, fromCellId, productId]);

  const chooseProduct = (stock: Stock) => {
    setProductId(stock.productId); setAmount(String(stock.quantity)); setToCellId(""); setDestinationCode("");
  };

  const value = Number(String(amount).replace(",", "."));
  const amountValid = Boolean(selectedStock && Number.isFinite(value) && value > 0 && value <= Number(selectedStock.quantity));
  const ready = Boolean(fromCellId && productId && amountValid && toCellId && !wouldExceedFive);
  const progress = !fromCellId ? 0 : !productId ? 25 : !amountValid ? 50 : !toCellId ? 75 : 100;

  const transfer = async () => {
    if (!ready || !selectedStock || !selectedProduct || !sourceCell || !destinationCell) return toast.error("Пройдите все шаги перемещения");
    setSaving(true);
    try {
      const response = await fetch("/api/department-warehouse-controls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "moveProduct", productId, fromCellId, toCellId, quantity: Number(value.toFixed(9)), comment: `Скан-перемещение ${sourceCell.code} → ${destinationCell.code}` }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "Не удалось переместить материал");
      toast.success("Материал перемещён", { description: `${selectedProduct.name}: ${fmt(value)} ${selectedProduct.unit} · ${sourceCell.code} → ${destinationCell.code}` });
      reset(); await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось переместить материал");
      await load();
    } finally { setSaving(false); }
  };

  return <main className="min-h-screen px-3 py-4 text-[var(--foreground)] sm:px-5 lg:px-7">
    <div className="mx-auto max-w-[1250px] space-y-4">
      <div>
        <Link href={base} data-same-tab="true" className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-blue-700 hover:underline"><ArrowLeft size={16}/> Назад в склад</Link>
        <p className="eyebrow">Сканирование по факту · склад краски</p>
        <h1 className="page-title">Перемещение материала</h1>
        <p className="page-description">Исходная ячейка → выбор материала и количества → новая ячейка → подтверждение.</p>
      </div>

      <section className="panel p-4 sm:p-6">
        <div className="flex items-center justify-between"><div><div className="text-xs font-bold uppercase tracking-[.14em] text-slate-400">Прогресс перемещения</div><div className="mt-1 text-lg font-extrabold">{progress}%</div></div>{ready && <div className="flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700"><CheckCircle2 size={18}/> Готово</div>}</div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }}/></div>
      </section>

      {loading ? <div className="panel flex min-h-72 items-center justify-center"><Loader2 className="animate-spin"/></div> : <div className="grid gap-4 lg:grid-cols-2">
        <section className={`panel p-4 sm:p-6 ${fromCellId ? "ring-1 ring-emerald-200" : ""}`}>
          <div className="flex items-start justify-between"><div><div className="text-xs font-bold uppercase tracking-[.14em] text-slate-400">Шаг 1</div><h2 className="mt-1 text-xl font-extrabold">Откуда забираем</h2></div>{fromCellId ? <CheckCircle2 className="text-emerald-600"/> : <QrCode className="text-blue-600"/>}</div>
          <p className="mt-2 text-sm text-slate-500">Отсканируйте QR исходной ячейки или введите её код вручную.</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]"><form onSubmit={(e: FormEvent)=>{e.preventDefault();acceptSource(sourceCode);}}><Input value={sourceCode} onChange={(e)=>setSourceCode(e.target.value)} placeholder="Код ячейки, например K11B" className="h-11"/></form><MobileBarcodeScanner label="Сканировать QR" onDetected={acceptSource}/></div>
          {sourceCell && <div className="mt-4 rounded-2xl bg-slate-50 p-4"><div className="flex items-center gap-2 font-mono text-xl font-black"><MapPin size={18}/>{sourceCell.code}</div><div className="mt-1 text-sm text-slate-500">{cellDescription(sourceCell)}</div></div>}
        </section>

        <section className={`panel p-4 sm:p-6 ${productId && amountValid ? "ring-1 ring-emerald-200" : ""}`}>
          <div className="flex items-start justify-between"><div><div className="text-xs font-bold uppercase tracking-[.14em] text-slate-400">Шаг 2</div><h2 className="mt-1 text-xl font-extrabold">Что и сколько</h2></div>{productId && amountValid ? <CheckCircle2 className="text-emerald-600"/> : <PackageSearch className="text-blue-600"/>}</div>
          {!fromCellId ? <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Сначала отсканируйте исходную ячейку.</div> : <>
            <div className="mt-4 space-y-2">{sourceStocks.map((stock)=>{const p=productById.get(stock.productId); return <button key={stock.productId} type="button" onClick={()=>chooseProduct(stock)} className={`w-full rounded-xl border p-3 text-left transition ${productId===stock.productId?"border-blue-500 bg-blue-50":"bg-white hover:bg-slate-50"}`}><div className="font-bold">{p?.name || "Материал"}</div><div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500"><span>Штрихкод: <b className="font-mono">{p?.barcode || "—"}</b></span><span>Артикул: <b>{p?.sku || "—"}</b></span><span>В ячейке: <b>{fmt(Number(stock.quantity))} {p?.unit}</b></span></div></button>})}</div>
            {selectedStock && selectedProduct && <div className="mt-4"><label className="text-sm font-bold">Количество для перемещения · максимум {fmt(Number(selectedStock.quantity))} {selectedProduct.unit}</label><Input value={amount} onChange={(e)=>setAmount(e.target.value)} inputMode="decimal" className="mt-2 h-12 text-lg font-bold"/></div>}
          </>}
        </section>

        <section className={`panel p-4 sm:p-6 ${toCellId ? "ring-1 ring-emerald-200" : ""}`}>
          <div className="flex items-start justify-between"><div><div className="text-xs font-bold uppercase tracking-[.14em] text-slate-400">Шаг 3</div><h2 className="mt-1 text-xl font-extrabold">Куда переносим</h2></div>{toCellId ? <CheckCircle2 className="text-emerald-600"/> : <QrCode className="text-blue-600"/>}</div>
          <p className="mt-2 text-sm text-slate-500">Отсканируйте QR новой ячейки. Если в ней уже есть материалы — перемещение разрешено, система покажет предупреждение.</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]"><form onSubmit={(e: FormEvent)=>{e.preventDefault();acceptDestination(destinationCode);}}><Input value={destinationCode} onChange={(e)=>setDestinationCode(e.target.value)} disabled={!productId} placeholder="QR / код новой ячейки" className="h-11"/></form><MobileBarcodeScanner label="Сканировать QR" onDetected={acceptDestination} disabled={!productId}/></div>
          {destinationCell && <div className={`mt-4 rounded-2xl p-4 ${destinationHasContent ? "border border-amber-200 bg-amber-50" : "bg-slate-50"}`}><div className="flex items-center gap-2 font-mono text-xl font-black"><MapPin size={18}/>{destinationCell.code}</div><div className="mt-1 text-sm text-slate-500">{cellDescription(destinationCell)}</div>{destinationHasContent && <div className="mt-3"><div className="flex items-center gap-2 text-sm font-bold text-amber-800"><TriangleAlert size={16}/> В ячейке уже есть материалы — перемещение всё равно разрешено</div><div className="mt-2 space-y-1">{destinationStocks.map((s)=>{const p=productById.get(s.productId);return <div key={s.productId} className="flex justify-between gap-3 text-xs"><span>{p?.name || "Материал"}</span><b>{fmt(Number(s.quantity))} {p?.unit}</b></div>})}</div><div className="mt-2 text-xs text-amber-700">Сейчас разных материалов: {destinationDistinct.size}/5</div></div>}</div>}
        </section>

        <section className={`panel p-4 sm:p-6 ${ready ? "ring-1 ring-emerald-200" : ""}`}>
          <div className="text-xs font-bold uppercase tracking-[.14em] text-slate-400">Шаг 4</div><h2 className="mt-1 text-xl font-extrabold">Подтверждение</h2>
          {!ready ? <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">После прохождения первых трёх шагов здесь появится итоговый маршрут.</div> : <div className="mt-4 space-y-3"><div className="rounded-2xl bg-slate-50 p-4 text-sm"><div><b>Материал:</b> {selectedProduct?.name}</div><div className="mt-1"><b>Штрихкод:</b> <span className="font-mono">{selectedProduct?.barcode || "—"}</span></div><div className="mt-1"><b>Количество:</b> {fmt(value)} {selectedProduct?.unit}</div><div className="mt-1"><b>Маршрут:</b> {sourceCell?.code} → {destinationCell?.code}</div></div><Button onClick={()=>void transfer()} disabled={saving} className="h-12 w-full bg-orange-500 font-black text-white hover:bg-orange-600"><ArrowRightLeft size={18}/>{saving ? "Перемещение..." : "Подтвердить перемещение"}</Button></div>}
        </section>
      </div>}
    </div>
  </main>;
}
