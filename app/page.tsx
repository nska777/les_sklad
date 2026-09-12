"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Archive,
  ArrowDownToLine,
  ArrowRightLeft,
  ArrowUpFromLine,
  Boxes,
  ClipboardList,
  Download,
  Grid3X3,
  History,
  ListChecks,
  Loader2,
  MapPin,
  PackagePlus,
  QrCode,
  ScanLine,
  Smartphone,
  TreePine,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { WarehouseWorkflows } from "@/app/warehouse-workflows";
import { InitialInventoryGuide } from "@/app/initial-inventory-guide";
import { InstallGuide } from "@/app/pwa-tools";

type Rack = { id: string; name: string; code: string; rows: number; columns: number };
type Cell = { id: string; rackId: string; code: string; label: string; rowIndex: number; columnIndex: number; blocked: boolean; side?: "front" | "back" };
type Product = { id: string; name: string; sku: string; barcode: string; category: string; unit: string; packQty: number; imageUrl: string; minStock: number };
type Stock = { productId: string; cellId: string; quantity: number };
type Movement = { id: string; type: string; productName: string; productUnit: string; cellCode: string; quantity: number; operator: string; source: string; recipient: string; comment: string; documentNumber: string | null; createdAt: string };
type ActivityLog = { id: string; action: string; entityType: string; entityId: string; entityName: string; details: string; operator: string; createdAt: string };
type WarehouseDocument = { id: string; number: string; type: "receipt" | "issue"; status: string; counterparty: string; recipient: string; oneCId: string | null; syncStatus: string; comment: string; createdBy: string; createdAt: string; completedAt: string | null; lineId: string; productId: string; productName: string; productSku: string; productUnit: string; plannedQuantity: number; processedQuantity: number };
type Snapshot = { racks: Rack[]; cells: Cell[]; products: Product[]; stocks: Stock[]; movements: Movement[]; activities: ActivityLog[]; documents: WarehouseDocument[] };

const emptyData: Snapshot = { racks: [], cells: [], products: [], stocks: [], movements: [], activities: [], documents: [] };

function ProductMark({ product }: { product: Product }) {
  if (product.imageUrl) return <img src={product.imageUrl} alt="" className="h-11 w-11 rounded-xl object-cover" />;
  return <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#eef2ec] text-[#355746]"><Boxes size={20} /></div>;
}

export default function Home() {
  const [data, setData] = useState<Snapshot>(emptyData);
  const [loading, setLoading] = useState(true);
  const [scan, setScan] = useState("");
  const [selectedProduct, setSelectedProduct] = useState("");
  const [selectedCell, setSelectedCell] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [operator, setOperator] = useState("Кладовщик");
  const [saving, setSaving] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);

  const loadData = useCallback(async () => {
    try {
      const response = await fetch("/api/warehouse", { cache: "no-store" });
      const result = await response.json() as Snapshot & { error?: string };
      if (!response.ok) throw new Error(result.error || "Ошибка загрузки");
      setData(result);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось загрузить данные");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadData(), 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  const post = async (payload: Record<string, unknown>) => {
    const response = await fetch("/api/warehouse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json() as { error?: string };
    if (!response.ok) throw new Error(result.error || "Операция не выполнена");
    await loadData();
  };

  const stockByProduct = useMemo(() => {
    const totals = new Map<string, number>();
    data.stocks.forEach((row) => totals.set(row.productId, (totals.get(row.productId) || 0) + row.quantity));
    return totals;
  }, [data.stocks]);

  const occupied = new Set(data.stocks.filter((stock) => stock.quantity > 0).map((stock) => stock.cellId)).size;
  const totalUnits = data.stocks.reduce((sum, stock) => sum + stock.quantity, 0);
  const lowStock = data.products.filter((product) => product.minStock > 0 && (stockByProduct.get(product.id) || 0) <= product.minStock).length;
  const pickedProduct = data.products.find((product) => product.id === selectedProduct);
  const pickedCell = data.cells.find((cell) => cell.id === selectedCell);

  const beep = (success = true) => {
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.frequency.value = success ? 880 : 220;
      gain.gain.value = 0.05;
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start();
      oscillator.stop(ctx.currentTime + (success ? 0.08 : 0.2));
    } catch {
      // звук необязателен
    }
  };

  const handleScan = (event: FormEvent) => {
    event.preventDefault();
    const value = scan.trim().toUpperCase();
    if (!value) return;
    const product = data.products.find((item) => item.barcode.toUpperCase() === value || item.sku.toUpperCase() === value);
    const cell = data.cells.find((item) => item.code.toUpperCase() === value);

    if (product) {
      setSelectedProduct(product.id);
      setQuantity(String(product.packQty || 1));
      toast.success(`Товар: ${product.name}`);
      beep();
    } else if (cell && !cell.blocked) {
      setSelectedCell(cell.id);
      toast.success(`Ячейка: ${cell.code}`);
      beep();
    } else {
      toast.error("Код не найден или ячейка заблокирована");
      beep(false);
    }

    setScan("");
    scanRef.current?.focus();
  };

  const placeStock = async (payload?: { productId?: string; cellId?: string; quantity?: number; operator?: string }) => {
    const productId = payload?.productId || selectedProduct;
    const cellId = payload?.cellId || selectedCell;
    const amount = payload?.quantity ?? Number(quantity);
    if (!productId || !cellId || !Number.isFinite(amount) || amount <= 0) throw new Error("Сначала выберите товар, ячейку и количество");

    setSaving(true);
    try {
      await post({
        action: "placeStock",
        productId,
        cellId,
        quantity: amount,
        operator: payload?.operator || operator,
        source: payload ? "webmcp" : "scanner",
        movementType: "Первичный учёт",
      });
      toast.success("Начальный остаток сохранён", {
        description: `${data.products.find((product) => product.id === productId)?.name} → ${data.cells.find((cell) => cell.id === cellId)?.code}`,
      });
      setSelectedProduct("");
      setSelectedCell("");
      setQuantity("1");
      beep();
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const context = (document as Document & { modelContext?: { registerTool: (tool: unknown, options?: { signal?: AbortSignal }) => unknown } }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();

    context.registerTool({
      name: "lookup_warehouse_stock",
      title: "Найти материал на складе",
      description: "Находит материал по названию, артикулу или штрихкоду и возвращает остаток и ячейки.",
      inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: (input: unknown) => {
        const query = String((input as { query?: string }).query || "").toLowerCase();
        return data.products
          .filter((product) => `${product.name} ${product.sku} ${product.barcode}`.toLowerCase().includes(query))
          .map((product) => ({
            name: product.name,
            sku: product.sku,
            quantity: stockByProduct.get(product.id) || 0,
            cells: data.stocks.filter((stock) => stock.productId === product.id).map((stock) => ({
              code: data.cells.find((cell) => cell.id === stock.cellId)?.code,
              quantity: stock.quantity,
            })),
          }));
      },
    }, { signal: lifecycle.signal });

    context.registerTool({
      name: "place_warehouse_stock",
      title: "Занести начальный остаток",
      description: "Записывает фактическое количество материала в выбранную ячейку склада.",
      inputSchema: {
        type: "object",
        properties: {
          productId: { type: "string" },
          cellId: { type: "string" },
          quantity: { type: "number", minimum: 0.001 },
          operator: { type: "string" },
        },
        required: ["productId", "cellId", "quantity"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: (input: unknown) => placeStock(input as { productId: string; cellId: string; quantity: number; operator?: string }),
    }, { signal: lifecycle.signal });

    return () => lifecycle.abort();
  }, [data, stockByProduct]);

  return (
    <main className="min-h-screen text-[var(--foreground)]">
      <header className="app-header sticky top-0 z-30">
        <div className="mx-auto flex min-h-17 max-w-[1500px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-7">
          <div className="flex items-center gap-3">
            <div className="brand-mark"><TreePine size={22} /></div>
            <div>
              <div className="text-[15px] font-extrabold tracking-tight">РУССКИЙ ЛЕС · СКЛАД</div>
              <div className="text-xs text-[var(--muted-foreground)]">Адресный учёт материалов</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline"><a href="/onec-materials">Материалы из 1С</a></Button>
            <Button asChild className="accent-button"><a href="/materials"><Boxes /> Карта материалов</a></Button>
          </div>
        </div>
      </header>

      <Tabs defaultValue="scan" className="mx-auto max-w-[1500px] px-4 py-5 sm:px-7 sm:py-7">
        <TabsList className="glass-tabs mb-5 h-auto w-full justify-start gap-1 overflow-x-auto rounded-2xl p-1.5">
          <TabsTrigger value="scan" className="px-3 py-2"><ListChecks /> Первичный учёт</TabsTrigger>
          <TabsTrigger value="receipt" className="px-3 py-2"><ArrowDownToLine /> Приёмка</TabsTrigger>
          <TabsTrigger value="transfer" className="px-3 py-2"><ArrowRightLeft /> Перемещение</TabsTrigger>
          <TabsTrigger value="issue" className="px-3 py-2"><ArrowUpFromLine /> Выдача</TabsTrigger>
          <TabsTrigger value="layout" className="px-3 py-2"><Grid3X3 /> Стеллажи</TabsTrigger>
          <TabsTrigger value="products" className="px-3 py-2"><Boxes /> Материалы</TabsTrigger>
          <TabsTrigger value="labels" className="px-3 py-2"><QrCode /> Этикетки</TabsTrigger>
          <TabsTrigger value="history" className="px-3 py-2"><History /> Движения</TabsTrigger>
          <TabsTrigger value="activity" className="px-3 py-2"><Activity /> Журнал</TabsTrigger>
          <TabsTrigger value="install" className="px-3 py-2"><Smartphone /> Установка</TabsTrigger>
        </TabsList>

        <TabsContent value="scan" className="space-y-5">
          <InitialInventoryGuide racks={data.racks.length} products={data.products.length} stocked={occupied} />

          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: "Материалов", value: data.products.length, icon: Boxes },
              { label: "Всего на складе", value: totalUnits.toLocaleString("ru-RU"), icon: Archive },
              { label: "Занято ячеек", value: occupied, icon: MapPin },
              { label: "Низкий остаток", value: lowStock, icon: ClipboardList },
            ].map((item) => <div key={item.label} className="metric-card"><div><p>{item.label}</p><strong>{item.value}</strong></div><item.icon /></div>)}
          </section>

          <section className="grid gap-5 xl:grid-cols-[1.08fr_.92fr]">
            <div className="scan-console overflow-hidden rounded-3xl text-white">
              <div className="flex items-start justify-between border-b border-white/12 p-5 sm:p-7">
                <div>
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[.12em] text-blue-200"><ListChecks size={14} /> Первичный учёт</div>
                  <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Посчитайте то, что реально лежит</h1>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">Сначала отсканируйте внутреннюю этикетку материала, затем QR ячейки и введите фактическое количество.</p>
                </div>
                <ScanLine className="hidden text-orange-400 sm:block" size={40} />
              </div>

              <form onSubmit={handleScan} className="p-5 sm:p-7">
                <Label htmlFor="scan" className="mb-2 block text-slate-200">Поле сканера</Label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <div className="relative flex-1">
                    <QrCode className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
                    <Input ref={scanRef} id="scan" autoFocus value={scan} onChange={(event) => setScan(event.target.value)} placeholder="Отсканируйте этикетку товара или QR ячейки" className="h-14 border-0 bg-white/95 pl-12 text-base text-slate-900 placeholder:text-slate-400" />
                  </div>
                  <Button type="submit" className="accent-button h-14 px-5">Принять</Button>
                </div>
              </form>

              <div className="grid border-t border-white/12 sm:grid-cols-2">
                <div className="scan-result">
                  <span>01 · Материал</span>
                  {pickedProduct ? <div className="mt-3 flex items-center gap-3"><ProductMark product={pickedProduct} /><div><b>{pickedProduct.name}</b><p>{pickedProduct.sku} · {pickedProduct.unit}</p></div></div> : <p className="mt-2 text-slate-400">Сначала отсканируйте товар</p>}
                </div>
                <div className="scan-result border-t border-white/12 sm:border-l sm:border-t-0">
                  <span>02 · Место хранения</span>
                  {pickedCell ? <div className="mt-3"><b className="text-lg">{pickedCell.code}</b><p>Ячейка выбрана</p></div> : <p className="mt-2 text-slate-400">Затем отсканируйте ячейку</p>}
                </div>
              </div>
            </div>

            <div className="panel flex flex-col justify-between p-5 sm:p-7">
              <div>
                <div className="panel-title"><div><span>03 · Количество</span><h2>Сохраните начальный остаток</h2></div><PackagePlus /></div>
                <p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">Введите результат пересчёта. Если материал лежит в нескольких ячейках — сохраните каждую ячейку отдельно.</p>
                <div className="mt-7 space-y-5">
                  <div>
                    <Label htmlFor="qty">Фактическое количество</Label>
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto]">
                      <Input id="qty" type="number" min="0.001" step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="h-12 text-lg font-semibold" />
                      <Button type="button" variant="outline" className="h-12" onClick={() => setQuantity(String(Number(quantity || 0) + 1))}>+1</Button>
                      <Button type="button" variant="outline" className="h-12" disabled={!pickedProduct} onClick={() => setQuantity(String(Number(quantity || 0) + (pickedProduct?.packQty || 1)))}>+ упаковка</Button>
                    </div>
                  </div>
                  <div><Label htmlFor="operator">Кто пересчитал</Label><Input id="operator" value={operator} onChange={(event) => setOperator(event.target.value)} className="mt-2 h-11" /></div>
                </div>
              </div>
              <Button disabled={saving || !pickedProduct || !pickedCell} onClick={() => void placeStock().catch((error) => toast.error(error.message))} className="accent-button mt-7 h-13 w-full text-base">{saving ? <Loader2 className="animate-spin" /> : <PackagePlus />} Сохранить остаток</Button>
            </div>
          </section>

          <section className="panel p-5 sm:p-7">
            <div className="panel-title"><div><span>Последние операции</span><h2>Что происходило на складе</h2></div><History /></div>
            <MovementTable movements={data.movements.slice(0, 6)} />
          </section>
        </TabsContent>

        <WarehouseWorkflows products={data.products} cells={data.cells} stocks={data.stocks} documents={data.documents} operator={operator} setOperator={setOperator} reload={loadData} />

        <TabsContent value="history" className="space-y-5">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div><p className="eyebrow">Контроль операций</p><h1 className="page-title">История движений</h1><p className="page-description">Приходы, перемещения и выдачи: дата, ячейка, количество и кладовщик.</p></div>
            <Button asChild variant="outline"><a href="/api/warehouse/export"><Download /> Скачать Excel</a></Button>
          </div>
          <div className="panel overflow-hidden p-4 sm:p-7"><MovementTable movements={data.movements} /></div>
        </TabsContent>

        <TabsContent value="activity" className="space-y-5">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div><p className="eyebrow">Ответственность</p><h1 className="page-title">Журнал изменений</h1><p className="page-description">Кто, когда и какие данные создавал или редактировал.</p></div>
            <Button asChild variant="outline"><a href="/api/warehouse/export?type=activity"><Download /> Скачать Excel</a></Button>
          </div>
          <div className="panel overflow-x-auto p-4 sm:p-7"><ActivityTable activities={data.activities} /></div>
        </TabsContent>

        <InstallGuide />
      </Tabs>
    </main>
  );
}

function MovementTable({ movements }: { movements: Movement[] }) {
  if (!movements.length) return <div className="py-10 text-center text-sm text-[#748078]">Операций пока нет</div>;
  return <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Время</TableHead><TableHead>Операция</TableHead><TableHead>Документ</TableHead><TableHead>Материал</TableHead><TableHead>Ячейка</TableHead><TableHead>Маршрут / получатель</TableHead><TableHead>Кладовщик</TableHead><TableHead className="text-right">Количество</TableHead></TableRow></TableHeader><TableBody>{movements.map((movement) => <TableRow key={movement.id}><TableCell className="whitespace-nowrap text-[#748078]">{new Date(movement.createdAt.replace(" ", "T") + "Z").toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</TableCell><TableCell><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${movement.quantity < 0 ? "bg-[#fce9e3] text-[#a44725]" : "bg-[#e5f2e8] text-[#2d6a42]"}`}>{movement.type}</span></TableCell><TableCell className="whitespace-nowrap font-mono text-xs">{movement.documentNumber || "—"}</TableCell><TableCell className="min-w-44 font-semibold">{movement.productName}</TableCell><TableCell className="font-mono text-xs">{movement.cellCode}</TableCell><TableCell className="min-w-48">{movement.recipient || movement.comment || "—"}</TableCell><TableCell>{movement.operator}</TableCell><TableCell className={`text-right font-bold ${movement.quantity < 0 ? "text-[#b14c27]" : "text-[#2d6a42]"}`}>{movement.quantity > 0 ? "+" : "−"}{Math.abs(movement.quantity).toLocaleString("ru-RU")} {movement.productUnit}</TableCell></TableRow>)}</TableBody></Table></div>;
}

function ActivityTable({ activities }: { activities: ActivityLog[] }) {
  if (!activities.length) return <div className="py-10 text-center text-sm text-[#748078]">Действий пока нет</div>;
  return <Table><TableHeader><TableRow><TableHead>Время</TableHead><TableHead>Действие</TableHead><TableHead>Объект</TableHead><TableHead>Подробности</TableHead><TableHead>Пользователь</TableHead></TableRow></TableHeader><TableBody>{activities.map((item) => <TableRow key={item.id}><TableCell className="whitespace-nowrap text-[#748078]">{new Date(item.createdAt.replace(" ", "T") + "Z").toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</TableCell><TableCell><span className="rounded-full bg-[#e7eee9] px-2.5 py-1 text-xs font-semibold text-[#315840]">{item.action}</span></TableCell><TableCell><div className="font-semibold">{item.entityName}</div><div className="text-xs text-[#7a877f]">{item.entityType}</div></TableCell><TableCell className="max-w-md text-[#58645c]">{item.details || "—"}</TableCell><TableCell>{item.operator}</TableCell></TableRow>)}</TableBody></Table>;
}
