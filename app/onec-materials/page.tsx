"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactBarcode from "react-barcode";
import { QRCodeSVG } from "qrcode.react";
import {
  ArrowLeft,
  Barcode as BarcodeIcon,
  ChevronLeft,
  ChevronRight,
  Database,
  FileSpreadsheet,
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
  locations: Location[];
};

type Cell = { id: string; code: string; blocked: boolean };
type Pagination = { page: number; pageSize: number; pages: number; filteredTotal: number };
type ApiResult = {
  items: Item[];
  stats: { total: number; linked: number };
  pagination: Pagination;
  error?: string;
};
type PlacementResult = {
  error?: string;
  internalCode?: string;
  barcode?: string;
  cellCode?: string;
  quantity?: number;
  remainingAfter?: number;
};
type CorrectionTarget = { item: Item; location: Location };
type ImportResult = {
  error?: string;
  fileName?: string;
  totalRows?: number;
  inserted?: number;
  updated?: number;
  preservedLinks?: number;
};

const qty = (value: number) => value.toLocaleString("ru-RU", { maximumFractionDigits: 3 });

export default function OneCMaterialsPage() {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Item[]>([]);
  const [stats, setStats] = useState({ total: 0, linked: 0 });
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 50, pages: 1, filteredTotal: 0 });
  const [cells, setCells] = useState<Cell[]>([]);

  const [selected, setSelected] = useState<Item | null>(null);
  const [labelItem, setLabelItem] = useState<Item | null>(null);
  const [cellId, setCellId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [operator, setOperator] = useState("Кладовщик");
  const [lastPlacement, setLastPlacement] = useState<PlacementResult | null>(null);

  const [correction, setCorrection] = useState<CorrectionTarget | null>(null);
  const [correctQuantity, setCorrectQuantity] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");

  const [importOpen, setImportOpen] = useState(false);
  const [importMode, setImportMode] = useState<"replace" | "merge">("replace");
  const [importFile, setImportFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [clearOpen, setClearOpen] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);

  const loadItems = useCallback(async (q = query, requestedPage = page) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/onec-materials?q=${encodeURIComponent(q)}&page=${requestedPage}&pageSize=50`, { cache: "no-store" });
      const result = await response.json() as ApiResult;
      if (!response.ok) throw new Error(result.error || "Ошибка загрузки");
      setItems(result.items || []);
      setStats(result.stats || { total: 0, linked: 0 });
      setPagination(result.pagination || { page: 1, pageSize: 50, pages: 1, filteredTotal: 0 });
      if (result.pagination?.page && result.pagination.page !== requestedPage) setPage(result.pagination.page);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось загрузить материалы из 1С");
    } finally {
      setLoading(false);
    }
  }, [page, query]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadItems(query, page), 180);
    return () => window.clearTimeout(timer);
  }, [query, page, loadItems]);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/warehouse", { cache: "no-store" });
        const result = await response.json() as { cells?: Cell[] };
        setCells((result.cells || []).filter((cell) => !cell.blocked));
      } catch {
        // Ошибка будет показана при размещении.
      }
    })();
  }, []);

  const remainingFor = (item: Item) => Math.max(0, item.available1c - item.placedQuantity);
  const selectedRemaining = useMemo(() => selected ? remainingFor(selected) : 0, [selected]);

  const openPlacement = (item: Item) => {
    const remaining = remainingFor(item);
    if (remaining <= 0) {
      toast.error(item.placedQuantity > item.available1c
        ? "По этой позиции уже размещено больше, чем есть по 1С. Используйте исправление количества."
        : "Весь доступный остаток уже размещён");
      return;
    }
    setSelected(item);
    setCellId("");
    setQuantity(String(remaining));
    setLastPlacement(null);
  };

  const place = async () => {
    const entered = Number(quantity);
    if (!selected || !cellId || !Number.isFinite(entered) || entered <= 0) return toast.error("Выберите ячейку и количество");
    if (entered > selectedRemaining) return toast.error(`Можно разместить максимум ${qty(selectedRemaining)} шт.`);
    setSaving(true);
    try {
      const response = await fetch("/api/onec-materials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "place", onecMaterialId: selected.id, cellId, quantity: entered, operator }),
      });
      const result = await response.json() as PlacementResult;
      if (!response.ok) throw new Error(result.error || "Не удалось разместить материал");
      setLastPlacement(result);
      toast.success("Материал размещён", { description: `${result.cellCode || "Ячейка"} · ${qty(Number(result.quantity || entered))} шт.` });
      await loadItems(query, page);
      setSelected((current) => current ? {
        ...current,
        internalCode: result.internalCode || current.internalCode,
        barcode: result.barcode || current.barcode,
        placedQuantity: current.placedQuantity + entered,
        locations: result.cellCode ? [
          ...current.locations.filter((x) => x.cellCode !== result.cellCode),
          {
            cellId,
            cellCode: result.cellCode,
            quantity: (current.locations.find((x) => x.cellCode === result.cellCode)?.quantity || 0) + entered,
          },
        ] : current.locations,
      } : current);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось разместить материал");
    } finally {
      setSaving(false);
    }
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
        body: JSON.stringify({
          action: "correctLocation",
          onecMaterialId: correction.item.id,
          cellId: correction.location.cellId,
          newQuantity: next,
          reason: correctionReason,
          operator,
        }),
      });
      const result = await response.json() as { error?: string; oldQuantity?: number; newQuantity?: number };
      if (!response.ok) throw new Error(result.error || "Не удалось исправить количество");
      toast.success("Количество исправлено", {
        description: `${correction.location.cellCode}: ${qty(correction.location.quantity)} → ${qty(next)} шт.`,
      });
      setCorrection(null);
      await loadItems(query, page);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось исправить количество");
    } finally {
      setSaving(false);
    }
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
      toast.success("Excel загружен", {
        description: `${result.totalRows || 0} позиций · добавлено ${result.inserted || 0} · обновлено ${result.updated || 0}`,
      });
      setImportOpen(false);
      setImportFile(null);
      if (fileRef.current) fileRef.current.value = "";
      setPage(1);
      await loadItems(query, 1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось загрузить Excel");
    } finally {
      setImporting(false);
    }
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
    } finally {
      setSaving(false);
    }
  };

  const goPage = (next: number) => {
    const safe = Math.min(Math.max(1, next), Math.max(1, pagination.pages));
    setPage(safe);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <main className="min-h-screen px-3 py-4 text-[var(--foreground)] sm:px-5 lg:px-7">
      <div className="mx-auto max-w-[1600px] space-y-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0">
            <Link href="/" className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-[#315840] hover:underline"><ArrowLeft size={16} /> Назад в склад</Link>
            <p className="eyebrow">Справочник 1С</p>
            <h1 className="page-title">Материалы из 1С</h1>
            <p className="page-description">Excel — это справочник. Фактический склад меняется только после размещения материала в конкретную ячейку.</p>
          </div>

          <div className="flex flex-wrap items-stretch justify-start gap-2 xl:justify-end">
            <div className="metric-card min-w-32"><div><p>В справочнике</p><strong>{stats.total}</strong></div><Database /></div>
            <div className="metric-card min-w-32"><div><p>Уже заведено</p><strong>{stats.linked}</strong></div><PackagePlus /></div>
            <Button variant="outline" className="h-auto min-h-12" onClick={() => setImportOpen(true)}><Upload /> Загрузить Excel</Button>
            <Button variant="outline" className="h-auto min-h-12 text-red-700 hover:bg-red-50 hover:text-red-800" onClick={() => setClearOpen(true)}><Trash2 /> Очистить 1С</Button>
          </div>
        </div>

        <section className="panel overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-black/7 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
            <div className="relative w-full max-w-3xl">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#7d8981]" size={19} />
              <Input
                autoFocus
                value={query}
                onChange={(event) => { setQuery(event.target.value); setPage(1); }}
                placeholder="Начните вводить: Hettich, евровинт, шуруп..."
                className="h-11 pl-11 text-base"
              />
              {loading && <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-[#7d8981]" size={18} />}
            </div>
            <div className="text-xs text-[#7a877f]">Найдено: {pagination.filteredTotal} · страница {pagination.page} из {pagination.pages}</div>
          </div>

          <div className="divide-y divide-black/10">
            {items.map((item) => {
              const remaining = item.available1c - item.placedQuantity;
              const over = remaining < 0;
              const complete = remaining <= 0;
              const code = item.barcode || item.internalCode || "";
              return <article key={item.id} className="grid min-w-0 gap-3 p-3 sm:p-4 xl:grid-cols-[minmax(250px,2fr)_86px_110px_minmax(190px,1.2fr)_minmax(220px,1.2fr)_125px] xl:items-center">
                <div className="min-w-0">
                  <div className="break-words font-semibold leading-5">{item.name}</div>
                  <div className="mt-1 text-xs text-[#7a877f]">Строка Excel: {item.sourceRow}{item.reserved1c ? ` · резерв/вычет: ${qty(item.reserved1c)}` : ""}</div>
                </div>

                <div className="flex items-center justify-between gap-2 xl:block xl:text-right">
                  <span className="text-xs text-[#7a877f] xl:block">По 1С</span>
                  <b>{qty(item.quantity1c)}</b>
                </div>

                <div className="flex items-center justify-between gap-2 xl:block xl:text-right">
                  <span className="text-xs text-[#7a877f] xl:block">Доступно</span>
                  <b>{qty(item.available1c)}</b>
                  <div className={`text-xs ${over ? "font-semibold text-red-600" : "text-[#7a877f]"}`}>{over ? `Сверх 1С: ${qty(Math.abs(remaining))}` : `Осталось: ${qty(remaining)}`}</div>
                </div>

                <div className="min-w-0">
                  <div className="mb-1 text-xs text-[#7a877f]">Где лежит · нажмите для исправления</div>
                  {item.locations?.length ? <div className="flex flex-wrap gap-1.5">{item.locations.map((location) => <button key={location.cellId} type="button" onClick={() => openCorrection(item, location)} className="inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-lg bg-[#f3f6f3] px-2 py-1 text-xs transition hover:bg-blue-50 hover:ring-1 hover:ring-blue-200" title="Исправить количество в ячейке"><MapPin size={12} className="shrink-0" /><b className="font-mono">{location.cellCode}</b><span>· {qty(location.quantity)} шт.</span><Pencil size={11} /></button>)}</div> : <span className="text-sm text-[#7a877f]">Не размещён</span>}
                </div>

                <div className="min-w-0">
                  {item.internalCode ? <button type="button" onClick={() => setLabelItem(item)} className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-transparent p-1.5 text-left transition hover:border-blue-200 hover:bg-blue-50/60" title="Открыть QR и штрихкод">
                    <QRCodeSVG value={code} size={48} className="shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 inline-block rounded-lg bg-[#e7eee9] px-2 py-0.5 font-mono text-xs font-bold text-[#315840]">{item.internalCode}</div>
                      <div className="max-w-[175px] overflow-hidden rounded bg-white px-1 py-1">
                        <ReactBarcode value={code} format="CODE128" width={1} height={28} displayValue={false} margin={0} background="transparent" />
                      </div>
                      <div className="mt-1 text-[10px] text-[#7a877f]">Нажмите, чтобы увеличить</div>
                    </div>
                  </button> : <span className="text-sm text-[#7a877f]">Код создастся автоматически</span>}
                </div>

                <div className="flex xl:justify-end">
                  <Button disabled={complete} onClick={() => openPlacement(item)} className="accent-button w-full xl:w-auto"><PackagePlus /> {complete ? "Размещено" : item.linkedProductId ? "Добавить" : "Разместить"}</Button>
                </div>
              </article>;
            })}

            {!loading && !items.length && <div className="p-12 text-center text-[#748078]">
              <FileSpreadsheet className="mx-auto mb-3" size={34} />
              <div className="font-semibold">{stats.total ? "Совпадений не найдено" : "Справочник 1С пуст"}</div>
              {!stats.total && <Button className="accent-button mt-4" onClick={() => setImportOpen(true)}><Upload /> Загрузить Excel</Button>}
            </div>}
          </div>

          {pagination.pages > 1 && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-black/7 p-3 sm:p-4">
            <div className="text-sm text-[#7a877f]">Показано по {pagination.pageSize} · всего найдено {pagination.filteredTotal}</div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={pagination.page <= 1} onClick={() => goPage(pagination.page - 1)}><ChevronLeft /> Назад</Button>
              <div className="rounded-lg bg-[#f3f6f3] px-3 py-2 text-sm font-semibold">{pagination.page} / {pagination.pages}</div>
              <Button variant="outline" size="sm" disabled={pagination.page >= pagination.pages} onClick={() => goPage(pagination.page + 1)}>Вперёд <ChevronRight /></Button>
            </div>
          </div>}
        </section>
      </div>

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="sm:max-w-2xl">
          {selected && <>
            <DialogHeader><DialogTitle>{lastPlacement ? "Материал размещён" : "Разместить материал на складе"}</DialogTitle><DialogDescription>{lastPlacement ? "Остаток записан в выбранную ячейку." : `Можно разместить не более ${qty(selectedRemaining)} шт. — это остаток по данным 1С.`}</DialogDescription></DialogHeader>
            <div className="mt-4 rounded-2xl border border-black/10 bg-[#f7f9f7] p-4">
              <div className="font-bold">{selected.name}</div>
              <div className="mt-2 grid gap-2 text-sm sm:grid-cols-3"><span>По 1С: <b>{qty(selected.quantity1c)}</b></span><span>Доступно: <b>{qty(selected.available1c)}</b></span><span>Размещено: <b>{qty(selected.placedQuantity)}</b></span></div>
              {(selected.internalCode || lastPlacement?.internalCode) && <button type="button" onClick={() => setLabelItem({ ...selected, internalCode: lastPlacement?.internalCode || selected.internalCode, barcode: lastPlacement?.barcode || selected.barcode })} className="mt-4 flex w-full cursor-pointer items-center gap-4 rounded-xl bg-white p-3 text-left hover:ring-2 hover:ring-blue-200"><QRCodeSVG value={lastPlacement?.barcode || selected.barcode || selected.internalCode || ""} size={68} /><div><div className="text-xs text-[#7a877f]">Постоянный код товара</div><div className="font-mono text-lg font-bold">{lastPlacement?.internalCode || selected.internalCode}</div><div className="mt-1 text-xs text-blue-600">Нажмите, чтобы открыть этикетку</div></div></button>}
              {lastPlacement?.cellCode && <div className="mt-3 flex items-center gap-2 rounded-lg bg-[#eef4ff] px-3 py-2 text-sm"><MapPin size={16} /><b>Ячейка {lastPlacement.cellCode}</b><span>· {qty(Number(lastPlacement.quantity || 0))} шт.</span></div>}
            </div>

            {!lastPlacement ? <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div><Label>Стеллаж / полка / ячейка</Label><NativeSelect value={cellId} onChange={(event) => setCellId(event.target.value)} className="mt-2 w-full"><NativeSelectOption value="">Выберите ячейку</NativeSelectOption>{cells.map((cell) => <NativeSelectOption key={cell.id} value={cell.id}>{cell.code}</NativeSelectOption>)}</NativeSelect></div>
              <div><Label>Количество · максимум {qty(selectedRemaining)}</Label><Input type="number" min="0.001" max={selectedRemaining} step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="mt-2" /></div>
              <div className="sm:col-span-2"><Label>Кто разместил</Label><Input value={operator} onChange={(event) => setOperator(event.target.value)} className="mt-2" /></div>
            </div> : <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"><div className="flex items-center gap-2 font-bold"><QrCode size={18} /> Готово</div><p className="mt-1">Товар виден в «Материалах», выбранной ячейке и истории движений.</p></div>}

            <DialogFooter className="mt-6">{lastPlacement ? <Button onClick={() => setSelected(null)} className="accent-button">Закрыть</Button> : <><Button variant="outline" onClick={() => setSelected(null)}>Отмена</Button><Button disabled={saving || !cellId || Number(quantity) <= 0 || Number(quantity) > selectedRemaining} onClick={() => void place()} className="accent-button">{saving ? <Loader2 className="animate-spin" /> : <PackagePlus />} Разместить</Button></>}</DialogFooter>
          </>}
        </DialogContent>
      </Dialog>

      <Dialog open={!!correction} onOpenChange={(open) => !open && setCorrection(null)}>
        <DialogContent className="sm:max-w-lg">
          {correction && <>
            <DialogHeader><DialogTitle>Исправить размещение</DialogTitle><DialogDescription>История не переписывается: система создаст отдельную корректирующую операцию и запишет причину в журнал.</DialogDescription></DialogHeader>
            <div className="mt-4 rounded-2xl border border-black/10 bg-[#f7f9f7] p-4">
              <div className="font-semibold">{correction.item.name}</div>
              <div className="mt-2 flex items-center gap-2 text-sm"><MapPin size={15} /><b className="font-mono">{correction.location.cellCode}</b><span>Сейчас: {qty(correction.location.quantity)} шт.</span></div>
            </div>
            <div className="mt-5 space-y-4">
              <div><Label>Правильное количество в этой ячейке</Label><Input type="number" min="0" step="any" value={correctQuantity} onChange={(event) => setCorrectQuantity(event.target.value)} className="mt-2" /></div>
              <div><Label>Причина исправления *</Label><Input value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} placeholder="Например: ошибочно ввели 4 вместо 2" className="mt-2" /></div>
              <div><Label>Кто исправил</Label><Input value={operator} onChange={(event) => setOperator(event.target.value)} className="mt-2" /></div>
            </div>
            <DialogFooter className="mt-6"><Button variant="outline" onClick={() => setCorrection(null)}>Отмена</Button><Button disabled={saving || !correctionReason.trim()} onClick={() => void saveCorrection()} className="accent-button">{saving ? <Loader2 className="animate-spin" /> : <Pencil />} Сохранить исправление</Button></DialogFooter>
          </>}
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader><DialogTitle>Загрузить Excel из 1С</DialogTitle><DialogDescription>Поддерживаются .xlsx и .xls. Название читается из колонки B, количества — из C, D и E.</DialogDescription></DialogHeader>
          <div className="mt-5 space-y-4">
            <div><Label>Файл Excel</Label><Input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={(event) => setImportFile(event.target.files?.[0] || null)} className="mt-2" /></div>
            <div><Label>Режим загрузки</Label><NativeSelect value={importMode} onChange={(event) => setImportMode(event.target.value as "replace" | "merge")} className="mt-2 w-full"><NativeSelectOption value="replace">Полностью заменить справочник</NativeSelectOption><NativeSelectOption value="merge">Обновить существующий и добавить новые</NativeSelectOption></NativeSelect><p className="mt-2 text-xs text-[#7a877f]">При замене связи уже размещённых товаров сохраняются по совпадающему названию. Остатки фактического склада не удаляются.</p></div>
            <div><Label>Кто загрузил</Label><Input value={operator} onChange={(event) => setOperator(event.target.value)} className="mt-2" /></div>
          </div>
          <DialogFooter className="mt-6"><Button variant="outline" onClick={() => setImportOpen(false)}>Отмена</Button><Button disabled={importing || !importFile} onClick={() => void importExcel()} className="accent-button">{importing ? <Loader2 className="animate-spin" /> : <Upload />} Загрузить</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={clearOpen} onOpenChange={setClearOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Очистить справочник 1С?</DialogTitle><DialogDescription>Будут удалены только строки загруженного справочника 1С. Уже созданные товары, ячейки, остатки и история движений останутся на складе.</DialogDescription></DialogHeader>
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">После очистки список будет пустым, пока вы не загрузите новый Excel.</div>
          <DialogFooter className="mt-6"><Button variant="outline" onClick={() => setClearOpen(false)}>Отмена</Button><Button disabled={saving} onClick={() => void clearReference()} className="bg-red-600 text-white hover:bg-red-700">{saving ? <Loader2 className="animate-spin" /> : <Trash2 />} Очистить</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!labelItem} onOpenChange={(open) => !open && setLabelItem(null)}>
        <DialogContent className="sm:max-w-xl">
          {labelItem?.internalCode && <>
            <DialogHeader><DialogTitle>Этикетка материала</DialogTitle><DialogDescription>QR и линейный штрихкод Code 128 содержат один постоянный код товара.</DialogDescription></DialogHeader>
            <div className="mt-4 rounded-2xl border border-black/10 bg-white p-5 text-center">
              <div className="mx-auto max-w-md break-words text-lg font-bold">{labelItem.name}</div>
              <div className="mt-4 flex flex-col items-center gap-5 sm:flex-row sm:justify-center">
                <div><QRCodeSVG value={labelItem.barcode || labelItem.internalCode} size={150} /><div className="mt-2 text-xs text-[#7a877f]">QR-код</div></div>
                <div className="max-w-full overflow-hidden"><ReactBarcode value={labelItem.barcode || labelItem.internalCode} format="CODE128" width={2} height={82} displayValue fontSize={17} margin={8} /><div className="text-xs text-[#7a877f]">Code 128</div></div>
              </div>
              <div className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#eef4ff] px-4 py-2 font-mono text-xl font-bold text-blue-700"><BarcodeIcon size={20} /> {labelItem.internalCode}</div>
              {labelItem.locations?.length ? <div className="mt-4 flex flex-wrap justify-center gap-2">{labelItem.locations.map((location) => <span key={location.cellId} className="rounded-lg bg-[#f3f6f3] px-2.5 py-1.5 text-sm"><b>{location.cellCode}</b> · {qty(location.quantity)} шт.</span>)}</div> : null}
            </div>
            <DialogFooter><Button onClick={() => setLabelItem(null)}>Закрыть</Button></DialogFooter>
          </>}
        </DialogContent>
      </Dialog>
    </main>
  );
}
