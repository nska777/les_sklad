"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactBarcode from "react-barcode";
import { QRCodeSVG } from "qrcode.react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Database,
  FileSpreadsheet,
  Layers3,
  Loader2,
  MapPin,
  PackagePlus,
  Pencil,
  QrCode,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

type Location = { cellId: string; cellCode: string; quantity: number };
type Item = {
  id: string;
  sourceRow: number;
  name: string;
  quantity1c: number;
  reserved1c: number;
  available1c: number;
  linkedProductId: string | null;
  internalCode: string | null;
  barcode: string | null;
  placedQuantity: number;
  excessQuantity: number;
  locations: Location[];
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
type Pagination = { page: number; pageSize: number; pages: number; filteredTotal: number };
type Stats = { total: number; linked: number; excessItems: number; excessUnits: number };
type ApiResult = { items: Item[]; stats: Stats; pagination: Pagination; error?: string };
type PlacementResult = { error?: string; internalCode?: string; barcode?: string; cellCode?: string; quantity?: number; remainingAfter?: number; excessAfter?: number };
type CorrectionTarget = { item: Item; location: Location };
type ImportResult = { error?: string; fileName?: string; totalRows?: number; inserted?: number; updated?: number; preservedLinks?: number };
type RackResult = { racks: Rack[]; cells: Cell[]; error?: string };

const qty = (value: number) => value.toLocaleString("ru-RU", { maximumFractionDigits: 3 });
const emptyStats: Stats = { total: 0, linked: 0, excessItems: 0, excessUnits: 0 };

export default function OneCMaterialsPage() {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Item[]>([]);
  const [stats, setStats] = useState<Stats>(emptyStats);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 50, pages: 1, filteredTotal: 0 });
  const [racks, setRacks] = useState<Rack[]>([]);
  const [cells, setCells] = useState<Cell[]>([]);

  const [selected, setSelected] = useState<Item | null>(null);
  const [rackId, setRackId] = useState("");
  const [side, setSide] = useState<"front" | "back">("front");
  const [shelf, setShelf] = useState("");
  const [cellId, setCellId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [operator, setOperator] = useState("Кладовщик");
  const [lastPlacement, setLastPlacement] = useState<PlacementResult | null>(null);

  const [labelItem, setLabelItem] = useState<Item | null>(null);
  const [correction, setCorrection] = useState<CorrectionTarget | null>(null);
  const [correctQuantity, setCorrectQuantity] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");

  const [importOpen, setImportOpen] = useState(false);
  const [importMode, setImportMode] = useState<"replace" | "merge">("replace");
  const [importFile, setImportFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [clearOpen, setClearOpen] = useState(false);

  const [loading, setLoading] = useState(true);
  const [layoutLoading, setLayoutLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);

  const loadItems = useCallback(async (q = query, requestedPage = page) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/onec-materials?q=${encodeURIComponent(q)}&page=${requestedPage}&pageSize=50`, { cache: "no-store" });
      const result = await response.json() as ApiResult;
      if (!response.ok) throw new Error(result.error || "Ошибка загрузки");
      setItems(result.items || []);
      setStats(result.stats || emptyStats);
      setPagination(result.pagination || { page: 1, pageSize: 50, pages: 1, filteredTotal: 0 });
      if (result.pagination?.page && result.pagination.page !== requestedPage) setPage(result.pagination.page);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось загрузить материалы из 1С");
    } finally { setLoading(false); }
  }, [page, query]);

  const loadLayout = useCallback(async () => {
    setLayoutLoading(true);
    try {
      const response = await fetch("/api/rack-layout", { cache: "no-store" });
      const result = await response.json() as RackResult;
      if (!response.ok) throw new Error(result.error || "Не удалось загрузить стеллажи");
      setRacks(result.racks || []);
      setCells((result.cells || []).filter((cell) => !cell.blocked));
      setRackId((current) => result.racks.some((rack) => rack.id === current) ? current : result.racks[0]?.id || "");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось загрузить стеллажи");
    } finally { setLayoutLoading(false); }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadItems(query, page), 180);
    return () => window.clearTimeout(timer);
  }, [query, page, loadItems]);
  useEffect(() => { void loadLayout(); }, [loadLayout]);

  const remainingFor = (item: Item) => Math.max(0, item.available1c - item.placedQuantity);
  const excessFor = (item: Item) => Math.max(0, item.placedQuantity - item.available1c);
  const selectedRemaining = useMemo(() => selected ? remainingFor(selected) : 0, [selected]);
  const selectedExcess = useMemo(() => selected ? excessFor(selected) : 0, [selected]);
  const activeRack = racks.find((rack) => rack.id === rackId);
  const rackCells = useMemo(() => cells.filter((cell) => cell.rackId === rackId), [cells, rackId]);
  const hasBack = rackCells.some((cell) => cell.side === "back");
  const sideCells = rackCells.filter((cell) => cell.side === side);
  const shelfNumbers = useMemo(() => Array.from(new Set(sideCells.map((cell) => cell.rowIndex + 1))).sort((a, b) => a - b), [sideCells]);
  const shelfCells = sideCells.filter((cell) => String(cell.rowIndex + 1) === shelf).sort((a, b) => a.columnIndex - b.columnIndex);
  const chosenCell = cells.find((cell) => cell.id === cellId);

  useEffect(() => {
    if (side === "back" && !hasBack) setSide("front");
  }, [hasBack, side]);
  useEffect(() => {
    const nextShelf = shelfNumbers[0] ? String(shelfNumbers[0]) : "";
    if (!shelfNumbers.includes(Number(shelf))) setShelf(nextShelf);
    setCellId("");
  }, [rackId, side, shelfNumbers.join(",")]);

  const openPlacement = (item: Item) => {
    const remaining = remainingFor(item);
    setSelected(item);
    setQuantity(String(remaining > 0 ? remaining : 1));
    setLastPlacement(null);
    setSide("front");
    setCellId("");
    if (racks[0]) setRackId(racks[0].id);
  };

  const place = async () => {
    const entered = Number(quantity);
    if (!selected || !chosenCell || !Number.isFinite(entered) || entered <= 0) return toast.error("Выберите точную ячейку и количество");
    setSaving(true);
    try {
      const response = await fetch("/api/onec-materials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "place", onecMaterialId: selected.id, cellId: chosenCell.id, quantity: entered, operator }),
      });
      const result = await response.json() as PlacementResult;
      if (!response.ok) throw new Error(result.error || "Не удалось разместить материал");
      setLastPlacement(result);
      const nextTotal = selected.placedQuantity + entered;
      const nextExcess = Math.max(0, nextTotal - selected.available1c);
      toast.success(nextExcess > 0 ? "Материал размещён · есть излишек" : "Материал размещён", {
        description: nextExcess > 0
          ? `${result.cellCode || chosenCell.code} · ${qty(entered)} шт. · излишек относительно 1С: +${qty(nextExcess)}`
          : `${result.cellCode || chosenCell.code} · ${qty(entered)} шт.`,
      });
      await Promise.all([loadItems(query, page), loadLayout()]);
      setSelected((current) => current ? {
        ...current,
        internalCode: result.internalCode || current.internalCode,
        barcode: result.barcode || current.barcode,
        placedQuantity: current.placedQuantity + entered,
        excessQuantity: Math.max(0, current.placedQuantity + entered - current.available1c),
        locations: result.cellCode ? [
          ...current.locations.filter((location) => location.cellCode !== result.cellCode),
          {
            cellId: chosenCell.id,
            cellCode: result.cellCode,
            quantity: (current.locations.find((location) => location.cellCode === result.cellCode)?.quantity || 0) + entered,
          },
        ] : current.locations,
      } : current);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось разместить материал");
    } finally { setSaving(false); }
  };

  const openCorrection = (item: Item, location: Location) => {
    setCorrection({ item, location });
    setCorrectQuantity(String(location.quantity));
    setCorrectionReason("");
  };

  const saveCorrection = async () => {
    if (!correction) return;
    const next = Number(correctQuantity);
    if (!Number.isFinite(next) || next < 0) return toast.error("Новое количество должно быть 0 или больше");
    if (!correctionReason.trim()) return toast.error("Укажите причину исправления");
    setSaving(true);
    try {
      const response = await fetch("/api/onec-materials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "correctLocation", onecMaterialId: correction.item.id, cellId: correction.location.cellId, newQuantity: next, reason: correctionReason, operator }),
      });
      const result = await response.json() as { error?: string; excessAfter?: number };
      if (!response.ok) throw new Error(result.error || "Не удалось исправить количество");
      toast.success("Количество исправлено", {
        description: `${correction.location.cellCode}: ${qty(correction.location.quantity)} → ${qty(next)} шт.${Number(result.excessAfter || 0) > 0 ? ` · излишек +${qty(Number(result.excessAfter))}` : ""}`,
      });
      setCorrection(null);
      await Promise.all([loadItems(query, page), loadLayout()]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось исправить количество");
    } finally { setSaving(false); }
  };

  const importExcel = async () => {
    if (!importFile) return toast.error("Выберите Excel-файл");
    setImporting(true);
    try {
      const form = new FormData();
      form.set("file", importFile);
      form.set("mode", importMode);
      form.set("operator", operator);
      const response = await fetch("/api/onec-materials/import", { method: "POST", body: form });
      const result = await response.json() as ImportResult;
      if (!response.ok) throw new Error(result.error || "Импорт не выполнен");
      toast.success("Excel загружен", { description: `${result.totalRows || 0} позиций · добавлено ${result.inserted || 0} · обновлено ${result.updated || 0}` });
      setImportOpen(false);
      setImportFile(null);
      if (fileRef.current) fileRef.current.value = "";
      setPage(1);
      await loadItems(query, 1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось загрузить Excel");
    } finally { setImporting(false); }
  };

  const clearReference = async () => {
    setSaving(true);
    try {
      const response = await fetch("/api/onec-materials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clearReference", operator }),
      });
      const result = await response.json() as { error?: string; deleted?: number };
      if (!response.ok) throw new Error(result.error || "Не удалось очистить справочник");
      toast.success("Справочник 1С очищен", { description: `Удалено строк: ${result.deleted || 0}. Фактический склад не затронут.` });
      setClearOpen(false);
      setPage(1);
      await loadItems("", 1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось очистить справочник");
    } finally { setSaving(false); }
  };

  const goPage = (next: number) => {
    setPage(Math.min(Math.max(1, next), Math.max(1, pagination.pages)));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return <main className="min-h-screen px-3 py-4 text-[var(--foreground)] sm:px-5 lg:px-7">
    <div className="mx-auto max-w-[1650px] space-y-4">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <Link href="/" className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-[#315840] hover:underline"><ArrowLeft size={16} /> Назад в склад</Link>
          <p className="eyebrow">Справочник 1С → физический склад</p>
          <h1 className="page-title">Материалы из 1С</h1>
          <p className="page-description">1С теперь используется как ориентир. Фактическое количество можно размещать без ограничения; превышение автоматически считается излишком.</p>
        </div>
        <div className="flex flex-wrap items-stretch gap-2">
          <div className="metric-card min-w-32"><div><p>В справочнике</p><strong>{stats.total}</strong></div><Database /></div>
          <div className="metric-card min-w-32"><div><p>Уже заведено</p><strong>{stats.linked}</strong></div><PackagePlus /></div>
          <div className={`metric-card min-w-32 ${stats.excessItems > 0 ? "border-orange-200 bg-orange-50" : ""}`}><div><p>Позиций с излишком</p><strong className={stats.excessItems > 0 ? "text-orange-700" : ""}>{stats.excessItems}</strong></div><PackagePlus /></div>
          <Button asChild variant="outline" className="h-auto min-h-12"><Link href="/rack-layout"><Layers3 /> 3D-стеллажи</Link></Button>
          <Button variant="outline" className="h-auto min-h-12" onClick={() => setImportOpen(true)}><Upload /> Загрузить Excel</Button>
          <Button variant="outline" className="h-auto min-h-12 text-red-700 hover:bg-red-50 hover:text-red-800" onClick={() => setClearOpen(true)}><Trash2 /> Очистить 1С</Button>
        </div>
      </div>

      {stats.excessItems > 0 && <section className="rounded-2xl border border-orange-200 bg-orange-50/80 p-4 text-sm text-orange-950">
        <div className="font-bold">Излишки относительно 1С</div>
        <div className="mt-1">Позиций: <b>{stats.excessItems}</b> · суммарное превышение: <b>+{qty(stats.excessUnits)}</b>. Это не ошибка: 1С — ориентир, а склад показывает фактическое наличие.</div>
      </section>}

      <section className="panel overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-black/7 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
          <div className="relative w-full max-w-3xl">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#7d8981]" size={19} />
            <Input autoFocus value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Начните вводить: Hettich, евровинт, шуруп..." className="h-11 pl-11 text-base" />
            {loading && <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-[#7d8981]" size={18} />}
          </div>
          <div className="text-xs text-[#7a877f]">Найдено: {pagination.filteredTotal} · страница {pagination.page} из {pagination.pages}</div>
        </div>

        <div className="divide-y divide-black/10">
          {items.map((item) => {
            const remaining = remainingFor(item);
            const excess = excessFor(item);
            const code = item.barcode || item.internalCode || "";
            return <article key={item.id} className={`grid gap-3 p-3 sm:p-4 xl:grid-cols-[minmax(260px,2fr)_110px_135px_minmax(210px,1.2fr)_minmax(220px,1.1fr)_125px] xl:items-center ${excess > 0 ? "bg-orange-50/45" : ""}`}>
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><div className="break-words font-semibold leading-5">{item.name}</div>{excess > 0 && <span className="rounded-full bg-orange-100 px-2 py-1 text-[11px] font-bold text-orange-800 ring-1 ring-orange-200">ИЗЛИШЕК +{qty(excess)}</span>}</div><div className="mt-1 text-xs text-[#7a877f]">Строка Excel: {item.sourceRow}{item.reserved1c ? ` · резерв/вычет: ${qty(item.reserved1c)}` : ""}</div></div>
              <div className="text-sm xl:text-right"><span className="text-xs text-[#7a877f] xl:block">По 1С</span><b>{qty(item.available1c)}</b></div>
              <div className="text-sm xl:text-right"><span className="text-xs text-[#7a877f] xl:block">Факт на складе</span><b className={excess > 0 ? "text-orange-700" : "text-slate-900"}>{qty(item.placedQuantity)}</b><div className="mt-0.5 text-[11px] text-slate-500">Осталось по 1С: {qty(remaining)}</div></div>
              <div className="min-w-0"><div className="mb-1 text-xs text-[#7a877f]">Где лежит · карандаш — исправить, 3D — показать</div>{item.locations?.length ? <div className="flex flex-wrap gap-1.5">{item.locations.map((location) => <div key={location.cellId} className={`inline-flex overflow-hidden rounded-lg text-xs ring-1 transition ${excess > 0 ? "bg-orange-50 ring-orange-200" : "bg-[#f3f6f3] ring-transparent hover:ring-blue-200"}`}><button type="button" onClick={() => openCorrection(item, location)} className="inline-flex items-center gap-1.5 px-2 py-1 hover:bg-blue-50"><MapPin size={12} /><b className="font-mono">{location.cellCode}</b><span>· {qty(location.quantity)}</span>{excess > 0 && <span className="font-bold text-orange-700">· излишек по товару +{qty(excess)}</span>}<Pencil size={11} /></button><Link href={`/rack-layout?cell=${encodeURIComponent(location.cellId)}`} className="inline-flex items-center border-l border-black/10 px-2 py-1 font-semibold text-blue-700 hover:bg-blue-100" title={`Показать ${location.cellCode} в 3D`}><Layers3 size={12} /></Link></div>)}</div> : <span className="text-sm text-[#7a877f]">Не размещён</span>}</div>
              <div>{item.internalCode ? <button type="button" onClick={() => setLabelItem(item)} className="flex w-full items-center gap-3 rounded-xl p-1.5 text-left hover:bg-blue-50/60"><QRCodeSVG value={code} size={46} /><div><div className="rounded-lg bg-[#e7eee9] px-2 py-0.5 font-mono text-xs font-bold text-[#315840]">{item.internalCode}</div><div className="mt-1 max-w-[175px] overflow-hidden rounded bg-white px-1 py-1"><ReactBarcode value={code} format="CODE128" width={1} height={26} displayValue={false} margin={0} background="transparent" /></div></div></button> : <span className="text-sm text-[#7a877f]">RL-код создастся автоматически</span>}</div>
              <div className="xl:text-right"><Button onClick={() => openPlacement(item)} className="accent-button w-full xl:w-auto"><PackagePlus /> {item.linkedProductId ? "Добавить факт" : "Разместить"}</Button></div>
            </article>;
          })}
          {!loading && !items.length && <div className="p-12 text-center text-[#748078]"><FileSpreadsheet className="mx-auto mb-3" size={34} /><div className="font-semibold">{stats.total ? "Совпадений не найдено" : "Справочник 1С пуст"}</div></div>}
        </div>

        {pagination.pages > 1 && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-black/7 p-3 sm:p-4"><div className="text-sm text-[#7a877f]">Показано по {pagination.pageSize} · всего найдено {pagination.filteredTotal}</div><div className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={pagination.page <= 1} onClick={() => goPage(pagination.page - 1)}><ChevronLeft /> Назад</Button><div className="rounded-lg bg-[#f3f6f3] px-3 py-2 text-sm font-semibold">{pagination.page} / {pagination.pages}</div><Button variant="outline" size="sm" disabled={pagination.page >= pagination.pages} onClick={() => goPage(pagination.page + 1)}>Вперёд <ChevronRight /></Button></div></div>}
      </section>
    </div>

    <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        {selected && <>
          <DialogHeader><DialogTitle>{lastPlacement ? "Материал размещён" : "Разместить фактическое количество"}</DialogTitle><DialogDescription>{lastPlacement ? "Фактический остаток записан в ячейку." : "Количество по 1С используется как ориентир. Можно указать реальное количество, даже если оно выше 1С."}</DialogDescription></DialogHeader>
          <div className={`mt-4 rounded-2xl border p-4 ${selectedExcess > 0 ? "border-orange-200 bg-orange-50/70" : "border-blue-200 bg-blue-50/70"}`}><div className="font-bold">{selected.name}</div><div className="mt-2 grid gap-2 text-sm sm:grid-cols-4"><span>По 1С: <b>{qty(selected.available1c)}</b></span><span>Факт: <b>{qty(selected.placedQuantity)}</b></span><span>Осталось по 1С: <b>{qty(selectedRemaining)}</b></span><span>Излишек: <b className={selectedExcess > 0 ? "text-orange-700" : ""}>{selectedExcess > 0 ? `+${qty(selectedExcess)}` : "0"}</b></span></div>{lastPlacement?.cellCode && <div className="mt-3 flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm"><MapPin size={16} /><b>{lastPlacement.cellCode}</b><span>· {qty(Number(lastPlacement.quantity || 0))} шт.</span>{Number(lastPlacement.excessAfter || 0) > 0 && <span className="font-bold text-orange-700">· излишек +{qty(Number(lastPlacement.excessAfter))}</span>}</div>}</div>

          {!lastPlacement && <div className="mt-5 space-y-5">
            {layoutLoading ? <div className="flex min-h-52 items-center justify-center"><Loader2 className="animate-spin" /></div> : !racks.length ? <div className="rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-800">Сначала создайте хотя бы один стеллаж.</div> : <>
              <div><Label>Стеллаж</Label><NativeSelect value={rackId} onChange={(event) => setRackId(event.target.value)} className="mt-2 w-full">{racks.map((rack) => <NativeSelectOption key={rack.id} value={rack.id}>{rack.code} · {rack.name}</NativeSelectOption>)}</NativeSelect></div>
              <div className="grid gap-4 sm:grid-cols-2"><div><Label>Сторона</Label><NativeSelect value={side} onChange={(event) => setSide(event.target.value as "front" | "back")} className="mt-2 w-full"><NativeSelectOption value="front">Лицевая</NativeSelectOption>{hasBack && <NativeSelectOption value="back">Задняя</NativeSelectOption>}</NativeSelect></div><div><Label>Полка</Label><NativeSelect value={shelf} onChange={(event) => { setShelf(event.target.value); setCellId(""); }} className="mt-2 w-full"><NativeSelectOption value="">Выберите полку</NativeSelectOption>{shelfNumbers.map((number) => <NativeSelectOption key={number} value={String(number)}>Полка {number}</NativeSelectOption>)}</NativeSelect></div></div>
              <div><Label>Ячейка</Label><div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">{shelfCells.map((cell) => <button key={cell.id} type="button" onClick={() => setCellId(cell.id)} className={`rounded-xl border px-3 py-3 text-left transition ${cellId === cell.id ? "border-blue-500 bg-blue-600 text-white shadow" : "border-black/10 bg-white hover:border-blue-300 hover:bg-blue-50"}`}><div className="text-xs opacity-70">Место {String.fromCharCode(65 + cell.columnIndex)}</div><b className="font-mono">{cell.code}</b></button>)}</div></div>
              {chosenCell && <div className="flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-sm"><MapPin size={16} /><span>Выбрано:</span><b>{activeRack?.code} · {side === "front" ? "лицевая" : "задняя"} · полка {shelf} · {chosenCell.code}</b></div>}
              <div className="grid gap-4 sm:grid-cols-2"><div><Label>Фактическое количество</Label><Input type="number" min="0.001" step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="mt-2" /><div className="mt-1 text-xs text-slate-500">Ограничения по 1С нет. Если факт станет выше 1С, разница автоматически попадёт в «Излишки».</div></div><div><Label>Кто размещает</Label><Input value={operator} onChange={(event) => setOperator(event.target.value)} className="mt-2" /></div></div>
            </>}
          </div>}

          {lastPlacement && <div className={`mt-5 rounded-2xl border p-4 text-sm ${Number(lastPlacement.excessAfter || 0) > 0 ? "border-orange-200 bg-orange-50 text-orange-950" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}><div className="flex items-center gap-2 font-bold"><QrCode size={18} /> Готово</div><p className="mt-1">Товар отображается в 3D-стеллаже и фактических остатках.{Number(lastPlacement.excessAfter || 0) > 0 ? ` Излишек относительно 1С: +${qty(Number(lastPlacement.excessAfter))}.` : ""}</p>{(lastPlacement.internalCode || selected.internalCode) && <div className="mt-3 font-mono font-bold">{lastPlacement.internalCode || selected.internalCode}</div>}</div>}

          <DialogFooter className="mt-6">{lastPlacement ? <><Button variant="outline" asChild><Link href={chosenCell ? `/rack-layout?cell=${encodeURIComponent(chosenCell.id)}` : "/rack-layout"}><Layers3 /> Посмотреть эту ячейку в 3D</Link></Button><Button onClick={() => setSelected(null)} className="accent-button">Закрыть</Button></> : <><Button variant="outline" onClick={() => setSelected(null)}>Отмена</Button><Button disabled={saving || !chosenCell || Number(quantity) <= 0} onClick={() => void place()} className="accent-button">{saving ? <Loader2 className="animate-spin" /> : <PackagePlus />} Разместить факт</Button></>}</DialogFooter>
        </>}
      </DialogContent>
    </Dialog>

    <Dialog open={!!correction} onOpenChange={(open) => !open && setCorrection(null)}><DialogContent className="sm:max-w-lg">{correction && <><DialogHeader><DialogTitle>Исправить размещение</DialogTitle><DialogDescription>История сохранится. Введите фактическое количество и причину. Если общий факт станет выше 1С, разница будет отмечена как излишек.</DialogDescription></DialogHeader><div className="mt-4 rounded-xl bg-slate-50 p-4"><div className="font-semibold">{correction.item.name}</div><div className="mt-1 text-sm text-slate-500">Ячейка {correction.location.cellCode} · сейчас {qty(correction.location.quantity)} шт.</div></div><div className="mt-4 space-y-4"><div><Label>Фактическое количество</Label><Input type="number" min="0" step="any" value={correctQuantity} onChange={(event) => setCorrectQuantity(event.target.value)} className="mt-2" /></div><div><Label>Причина</Label><Input value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} placeholder="Например, пересчёт" className="mt-2" /></div><div><Label>Кто исправляет</Label><Input value={operator} onChange={(event) => setOperator(event.target.value)} className="mt-2" /></div></div><DialogFooter className="mt-6"><Button variant="outline" onClick={() => setCorrection(null)}>Отмена</Button><Button disabled={saving || !correctionReason.trim()} onClick={() => void saveCorrection()} className="accent-button">Сохранить</Button></DialogFooter></>}</DialogContent></Dialog>

    <Dialog open={!!labelItem} onOpenChange={(open) => !open && setLabelItem(null)}><DialogContent className="sm:max-w-md">{labelItem && <><DialogHeader><DialogTitle>Этикетка материала</DialogTitle><DialogDescription>Постоянный внутренний код товара.</DialogDescription></DialogHeader><div className="mt-4 flex flex-col items-center rounded-2xl border bg-white p-6"><QRCodeSVG value={labelItem.barcode || labelItem.internalCode || ""} size={150} /><div className="mt-4 font-mono text-xl font-bold">{labelItem.internalCode}</div><div className="mt-4 max-w-full overflow-hidden"><ReactBarcode value={labelItem.barcode || labelItem.internalCode || ""} format="CODE128" width={1.5} height={58} displayValue /></div><div className="mt-3 text-center text-sm font-semibold">{labelItem.name}</div></div></>}</DialogContent></Dialog>

    <Dialog open={importOpen} onOpenChange={setImportOpen}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>Загрузить Excel из 1С</DialogTitle><DialogDescription>Справочник обновится, фактические остатки склада не удаляются.</DialogDescription></DialogHeader><div className="mt-4 space-y-4"><div><Label>Режим</Label><NativeSelect value={importMode} onChange={(event) => setImportMode(event.target.value as "replace" | "merge")} className="mt-2 w-full"><NativeSelectOption value="replace">Заменить справочник</NativeSelectOption><NativeSelectOption value="merge">Обновить / добавить</NativeSelectOption></NativeSelect></div><div><Label>Excel-файл</Label><Input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={(event) => setImportFile(event.target.files?.[0] || null)} className="mt-2" /></div><div><Label>Кто загружает</Label><Input value={operator} onChange={(event) => setOperator(event.target.value)} className="mt-2" /></div></div><DialogFooter className="mt-6"><Button variant="outline" onClick={() => setImportOpen(false)}>Отмена</Button><Button disabled={importing || !importFile} onClick={() => void importExcel()} className="accent-button">{importing ? <Loader2 className="animate-spin" /> : <Upload />} Загрузить</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={clearOpen} onOpenChange={setClearOpen}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>Очистить справочник 1С?</DialogTitle><DialogDescription>Будут удалены только строки справочника 1С. Товары, остатки, ячейки и движения склада останутся.</DialogDescription></DialogHeader><DialogFooter className="mt-6"><Button variant="outline" onClick={() => setClearOpen(false)}>Отмена</Button><Button disabled={saving} onClick={() => void clearReference()} className="bg-red-600 text-white hover:bg-red-700"><Trash2 /> Очистить</Button></DialogFooter></DialogContent></Dialog>
  </main>;
}
