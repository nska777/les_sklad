"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import ReactBarcode from "react-barcode";
import { QRCodeSVG } from "qrcode.react";
import { ArrowLeft, Barcode as BarcodeIcon, Database, Loader2, MapPin, PackagePlus, QrCode, Search } from "lucide-react";
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
type ApiResult = { items: Item[]; stats: { total: number; linked: number }; error?: string };
type PlacementResult = { error?: string; internalCode?: string; barcode?: string; cellCode?: string; quantity?: number; remainingAfter?: number };

const qty = (value: number) => value.toLocaleString("ru-RU", { maximumFractionDigits: 3 });

export default function OneCMaterialsPage() {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [stats, setStats] = useState({ total: 0, linked: 0 });
  const [cells, setCells] = useState<Cell[]>([]);
  const [selected, setSelected] = useState<Item | null>(null);
  const [labelItem, setLabelItem] = useState<Item | null>(null);
  const [cellId, setCellId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [operator, setOperator] = useState("Кладовщик");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastPlacement, setLastPlacement] = useState<PlacementResult | null>(null);

  const loadItems = useCallback(async (q = query) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/onec-materials?q=${encodeURIComponent(q)}`, { cache: "no-store" });
      const result = await response.json() as ApiResult;
      if (!response.ok) throw new Error(result.error || "Ошибка загрузки");
      setItems(result.items);
      setStats(result.stats);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось загрузить материалы из 1С");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadItems(query), 180);
    return () => window.clearTimeout(timer);
  }, [query, loadItems]);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/warehouse", { cache: "no-store" });
        const result = await response.json() as { cells?: Cell[] };
        setCells((result.cells || []).filter((cell) => !cell.blocked));
      } catch { /* ошибка будет показана при размещении */ }
    })();
  }, []);

  const remainingFor = (item: Item) => Math.max(0, item.available1c - item.placedQuantity);

  const openPlacement = (item: Item) => {
    const remaining = remainingFor(item);
    if (remaining <= 0) {
      toast.error(item.placedQuantity > item.available1c ? "По этой позиции уже размещено больше, чем есть по 1С" : "Весь доступный остаток уже размещён");
      return;
    }
    setSelected(item);
    setCellId("");
    setQuantity(String(remaining));
    setLastPlacement(null);
  };

  const selectedRemaining = useMemo(() => selected ? remainingFor(selected) : 0, [selected]);

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
      toast.success("Материал размещён", { description: `${result.cellCode || "Ячейка"} · ${qty(Number(result.quantity || entered))} шт. · ${result.internalCode || "код создан"}` });
      await loadItems(query);
      setSelected((current) => current ? {
        ...current,
        internalCode: result.internalCode || current.internalCode,
        barcode: result.barcode || current.barcode,
        placedQuantity: current.placedQuantity + entered,
        locations: result.cellCode ? [...current.locations.filter((x) => x.cellCode !== result.cellCode), {
          cellId,
          cellCode: result.cellCode,
          quantity: (current.locations.find((x) => x.cellCode === result.cellCode)?.quantity || 0) + entered,
        }] : current.locations,
      } : current);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось разместить материал");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="min-h-screen px-3 py-4 text-[var(--foreground)] sm:px-5 lg:px-7">
      <div className="mx-auto max-w-[1600px] space-y-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <Link href="/" className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-[#315840] hover:underline"><ArrowLeft size={16} /> Назад в склад</Link>
            <p className="eyebrow">Справочник 1С</p>
            <h1 className="page-title">Материалы из 1С</h1>
            <p className="page-description">Разместить можно только количество в пределах доступного остатка 1С. Код товара создаётся один раз и остаётся постоянным.</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:gap-3">
            <div className="metric-card min-w-0 sm:min-w-36"><div><p>В справочнике</p><strong>{stats.total}</strong></div><Database /></div>
            <div className="metric-card min-w-0 sm:min-w-36"><div><p>Уже заведено</p><strong>{stats.linked}</strong></div><PackagePlus /></div>
          </div>
        </div>

        <section className="panel overflow-hidden">
          <div className="border-b border-black/7 p-3 sm:p-4">
            <div className="relative max-w-3xl">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#7d8981]" size={19} />
              <Input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Начните вводить: Hettich, евровинт, шуруп..." className="h-11 pl-11 text-base" />
              {loading && <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-[#7d8981]" size={18} />}
            </div>
          </div>

          <div className="divide-y divide-black/10">
            {items.map((item) => {
              const remaining = item.available1c - item.placedQuantity;
              const over = remaining < 0;
              const complete = remaining <= 0;
              const code = item.barcode || item.internalCode || "";
              return <article key={item.id} className="grid min-w-0 gap-3 p-3 sm:p-4 xl:grid-cols-[minmax(260px,2.2fr)_90px_110px_minmax(180px,1.15fr)_minmax(230px,1.25fr)_130px] xl:items-center">
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
                  <div className="mb-1 text-xs text-[#7a877f]">Где лежит</div>
                  {item.locations?.length ? <div className="flex flex-wrap gap-1.5">{item.locations.map((location) => <div key={location.cellId} className="inline-flex max-w-full items-center gap-1.5 rounded-lg bg-[#f3f6f3] px-2 py-1 text-xs"><MapPin size={12} className="shrink-0" /><b className="font-mono">{location.cellCode}</b><span>· {qty(location.quantity)} шт.</span></div>)}</div> : <span className="text-sm text-[#7a877f]">Не размещён</span>}
                </div>

                <div className="min-w-0">
                  {item.internalCode ? <button type="button" onClick={() => setLabelItem(item)} className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-transparent p-1.5 text-left transition hover:border-blue-200 hover:bg-blue-50/60" title="Открыть QR и штрихкод">
                    <QRCodeSVG value={code} size={48} className="shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 inline-block rounded-lg bg-[#e7eee9] px-2 py-0.5 font-mono text-xs font-bold text-[#315840]">{item.internalCode}</div>
                      <div className="max-w-[180px] overflow-hidden rounded bg-white px-1 py-1">
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
            {!loading && !items.length && <div className="p-12 text-center text-[#748078]">Совпадений не найдено</div>}
          </div>
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

      <Dialog open={!!labelItem} onOpenChange={(open) => !open && setLabelItem(null)}>
        <DialogContent className="sm:max-w-xl">
          {labelItem?.internalCode && <>
            <DialogHeader><DialogTitle>Этикетка материала</DialogTitle><DialogDescription>QR и настоящий линейный штрихкод Code 128. Оба содержат один постоянный код товара.</DialogDescription></DialogHeader>
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
