"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Boxes, CheckCircle2, Layers3, Loader2, MapPin, PackagePlus, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

type Item = {
  id: string;
  name: string;
  quantity1c: number;
  available1c: number;
  placedQuantity: number;
  linkedProductId: string | null;
  internalCode: string | null;
};

type Rack = { id: string; name: string; code: string; rows: number; columns: number };
type Cell = {
  id: string;
  rackId: string;
  code: string;
  rowIndex: number;
  columnIndex: number;
  blocked: boolean;
  side: "front" | "back";
};

type OneCResult = {
  items: Item[];
  pagination: { filteredTotal: number };
  error?: string;
};

type RackResult = { racks: Rack[]; cells: Cell[]; error?: string };

type PlacementResult = {
  error?: string;
  internalCode?: string;
  barcode?: string;
  cellCode?: string;
  quantity?: number;
  remainingAfter?: number;
};

const qty = (value: number) => value.toLocaleString("ru-RU", { maximumFractionDigits: 3 });

export default function GuidedOneCPlacementPage() {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [racks, setRacks] = useState<Rack[]>([]);
  const [cells, setCells] = useState<Cell[]>([]);
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [rackId, setRackId] = useState("");
  const [side, setSide] = useState<"front" | "back">("front");
  const [shelf, setShelf] = useState("");
  const [cellId, setCellId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [operator, setOperator] = useState("Кладовщик");
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [placed, setPlaced] = useState<PlacementResult | null>(null);

  const loadLayout = useCallback(async () => {
    try {
      const response = await fetch("/api/rack-layout", { cache: "no-store" });
      const result = await response.json() as RackResult;
      if (!response.ok) throw new Error(result.error || "Не удалось загрузить стеллажи");
      setRacks(result.racks || []);
      setCells((result.cells || []).filter((cell) => !cell.blocked));
      setRackId((current) => result.racks?.some((rack) => rack.id === current) ? current : result.racks?.[0]?.id || "");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось загрузить стеллажи");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadLayout(); }, [loadLayout]);

  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) {
      setItems([]);
      setSearching(false);
      return;
    }
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const response = await fetch(`/api/onec-materials?q=${encodeURIComponent(text)}&page=1&pageSize=12`, { cache: "no-store" });
        const result = await response.json() as OneCResult;
        if (!response.ok) throw new Error(result.error || "Ошибка поиска");
        setItems(result.items || []);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Не удалось найти материал");
      } finally {
        setSearching(false);
      }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query]);

  const activeRack = racks.find((rack) => rack.id === rackId);
  const rackCells = cells.filter((cell) => cell.rackId === rackId);
  const hasBack = rackCells.some((cell) => cell.side === "back");
  const sideCells = rackCells.filter((cell) => cell.side === side);
  const shelfNumbers = useMemo(() => Array.from(new Set(sideCells.map((cell) => cell.rowIndex + 1))).sort((a, b) => a - b), [sideCells]);
  const shelfCells = sideCells.filter((cell) => String(cell.rowIndex + 1) === shelf).sort((a, b) => a.columnIndex - b.columnIndex);
  const chosenCell = cells.find((cell) => cell.id === cellId);
  const remaining = selectedItem ? Math.max(0, selectedItem.available1c - selectedItem.placedQuantity) : 0;

  useEffect(() => {
    if (!activeRack) return;
    const availableSides = new Set(rackCells.map((cell) => cell.side));
    const nextSide: "front" | "back" = side === "back" && !availableSides.has("back") ? "front" : side;
    if (nextSide !== side) setSide(nextSide);
  }, [activeRack?.id, rackCells.length, side]);

  useEffect(() => {
    const nextShelf = shelfNumbers[0] ? String(shelfNumbers[0]) : "";
    if (!shelfNumbers.includes(Number(shelf))) setShelf(nextShelf);
    setCellId("");
  }, [rackId, side, shelfNumbers.join(",")]);

  const chooseItem = (item: Item) => {
    const itemRemaining = Math.max(0, item.available1c - item.placedQuantity);
    if (itemRemaining <= 0) {
      toast.error("По этой позиции весь доступный остаток уже размещён");
      return;
    }
    setSelectedItem(item);
    setQuantity(String(itemRemaining));
    setPlaced(null);
  };

  const place = async () => {
    const amount = Number(quantity);
    if (!selectedItem) return toast.error("Сначала выберите материал");
    if (!chosenCell) return toast.error("Выберите ячейку");
    if (!Number.isFinite(amount) || amount <= 0) return toast.error("Введите количество");
    if (amount > remaining) return toast.error(`Можно разместить максимум ${qty(remaining)} шт.`);
    setSaving(true);
    try {
      const response = await fetch("/api/onec-materials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "place", onecMaterialId: selectedItem.id, cellId: chosenCell.id, quantity: amount, operator }),
      });
      const result = await response.json() as PlacementResult;
      if (!response.ok) throw new Error(result.error || "Не удалось разместить материал");
      setPlaced(result);
      setSelectedItem((current) => current ? { ...current, placedQuantity: current.placedQuantity + amount, internalCode: result.internalCode || current.internalCode } : current);
      toast.success("Материал размещён", { description: `${result.cellCode || chosenCell.code} · ${qty(amount)} шт.` });
      await loadLayout();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось разместить материал");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="min-h-screen px-3 py-4 text-[var(--foreground)] sm:px-5 lg:px-7">
      <div className="mx-auto max-w-[1500px] space-y-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Link href="/onec-materials" className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-blue-700 hover:underline"><ArrowLeft size={16} /> Материалы из 1С</Link>
            <p className="eyebrow">1С → физический склад</p>
            <h1 className="page-title">Быстрое размещение</h1>
            <p className="page-description">Выберите материал, затем физический адрес: стеллаж → сторона → полка → ячейка.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline"><Link href="/rack-layout"><Layers3 /> Открыть 3D-стеллажи</Link></Button>
          </div>
        </div>

        <section className="grid gap-4 xl:grid-cols-[1.05fr_.95fr]">
          <div className="panel overflow-hidden">
            <div className="border-b border-black/10 p-4 sm:p-5">
              <Label>1. Найдите материал из 1С</Label>
              <div className="relative mt-2">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <Input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} className="h-12 pl-11" placeholder="Hettich, шуруп, петля..." />
                {searching && <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-slate-400" size={18} />}
              </div>
            </div>

            <div className="max-h-[62vh] divide-y divide-black/10 overflow-y-auto">
              {query.trim().length < 2 ? <div className="p-10 text-center text-sm text-slate-500">Введите хотя бы 2 символа</div> : !searching && !items.length ? <div className="p-10 text-center text-sm text-slate-500">Ничего не найдено</div> : items.map((item) => {
                const itemRemaining = item.available1c - item.placedQuantity;
                const selected = selectedItem?.id === item.id;
                return <button key={item.id} type="button" disabled={itemRemaining <= 0} onClick={() => chooseItem(item)} className={`w-full cursor-pointer p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-45 ${selected ? "bg-blue-50 ring-1 ring-inset ring-blue-300" : "hover:bg-slate-50"}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0"><div className="font-semibold">{item.name}</div><div className="mt-1 text-xs text-slate-500">{item.internalCode || "Код создастся при первом размещении"}</div></div>
                    <div className="shrink-0 text-right"><div className="text-xs text-slate-500">Осталось</div><b className={itemRemaining < 0 ? "text-red-600" : "text-blue-700"}>{qty(Math.max(0, itemRemaining))}</b></div>
                  </div>
                </button>;
              })}
            </div>
          </div>

          <div className="panel p-4 sm:p-5">
            <div className="mb-4 flex items-start gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-700"><MapPin size={20} /></div><div><h2 className="font-bold">2. Укажите точное место</h2><p className="text-sm text-slate-500">Адрес строится по физической архитектуре стеллажа.</p></div></div>

            {selectedItem ? <div className="mb-5 rounded-2xl border border-blue-200 bg-blue-50/70 p-4"><div className="flex items-start gap-3"><Boxes className="mt-0.5 text-blue-600" size={18} /><div className="min-w-0"><div className="font-semibold">{selectedItem.name}</div><div className="mt-1 text-sm text-slate-600">По 1С: {qty(selectedItem.available1c)} · размещено: {qty(selectedItem.placedQuantity)} · осталось: <b>{qty(remaining)}</b></div></div></div></div> : <div className="mb-5 rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">Слева выберите материал.</div>}

            {loading ? <div className="flex min-h-72 items-center justify-center"><Loader2 className="animate-spin" /></div> : !racks.length ? <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-800">Сначала создайте хотя бы один стеллаж.</div> : <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2"><Label>Стеллаж</Label><NativeSelect value={rackId} onChange={(event) => setRackId(event.target.value)} className="mt-2 w-full">{racks.map((rack) => <NativeSelectOption key={rack.id} value={rack.id}>{rack.code} · {rack.name}</NativeSelectOption>)}</NativeSelect></div>
              <div><Label>Сторона</Label><NativeSelect value={side} onChange={(event) => setSide(event.target.value as "front" | "back")} className="mt-2 w-full"><NativeSelectOption value="front">Лицевая</NativeSelectOption>{hasBack && <NativeSelectOption value="back">Задняя</NativeSelectOption>}</NativeSelect></div>
              <div><Label>Полка</Label><NativeSelect value={shelf} onChange={(event) => { setShelf(event.target.value); setCellId(""); }} className="mt-2 w-full"><NativeSelectOption value="">Выберите полку</NativeSelectOption>{shelfNumbers.map((number) => <NativeSelectOption key={number} value={String(number)}>Полка {number}</NativeSelectOption>)}</NativeSelect></div>
              <div className="sm:col-span-2"><Label>Ячейка</Label><div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">{shelfCells.map((cell) => <button key={cell.id} type="button" onClick={() => setCellId(cell.id)} className={`rounded-xl border px-3 py-3 text-left transition ${cellId === cell.id ? "border-blue-500 bg-blue-600 text-white shadow" : "border-black/10 bg-white hover:border-blue-300 hover:bg-blue-50"}`}><div className="text-xs opacity-70">Место {String.fromCharCode(65 + cell.columnIndex)}</div><b className="font-mono">{cell.code}</b></button>)}</div>{shelf && !shelfCells.length && <div className="mt-2 text-sm text-slate-500">На этой полке нет доступных ячеек.</div>}</div>
              <div><Label>Количество · максимум {qty(remaining)}</Label><Input type="number" min="0.001" max={remaining || undefined} step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="mt-2" /></div>
              <div><Label>Кто размещает</Label><Input value={operator} onChange={(event) => setOperator(event.target.value)} className="mt-2" /></div>
            </div>}

            {chosenCell && <div className="mt-4 flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-sm"><MapPin size={16} /><span>Выбрано:</span><b>{activeRack?.code} · {side === "front" ? "лицевая" : "задняя"} · полка {chosenCell.rowIndex + 1} · {chosenCell.code}</b></div>}

            {placed ? <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900"><div className="flex items-center gap-2 font-bold"><CheckCircle2 size={19} /> Размещение сохранено</div><p className="mt-1 text-sm">{placed.cellCode} · {qty(Number(placed.quantity || 0))} шт. Товар уже отображается в 3D-стеллаже.</p><div className="mt-3 flex flex-wrap gap-2"><Button asChild size="sm"><Link href="/rack-layout"><Layers3 /> Посмотреть в 3D</Link></Button><Button size="sm" variant="outline" onClick={() => { setPlaced(null); setSelectedItem(null); setQuery(""); setItems([]); setQuantity(""); setCellId(""); }}>Следующий материал</Button></div></div> : <Button disabled={saving || !selectedItem || !chosenCell || Number(quantity) <= 0 || Number(quantity) > remaining} onClick={() => void place()} className="accent-button mt-5 h-12 w-full"><PackagePlus /> {saving ? "Сохраняю..." : "Разместить в выбранную ячейку"}</Button>}
          </div>
        </section>
      </div>
    </main>
  );
}
