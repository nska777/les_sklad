"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  ArrowDownToLine,
  ArrowRightLeft,
  ArrowUpFromLine,
  Boxes,
  CircleDot,
  History,
  Layers3,
  Loader2,
  MapPin,
  PackagePlus,
  PaintBucket,
  Plus,
  RefreshCw,
  Search,
  TreePine,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Rack = { id: string; warehouseCode: string; name: string; code: string; rows: number; columns: number };
type Cell = { id: string; warehouseCode: string; rackId: string; code: string; label: string; rowIndex: number; columnIndex: number; blocked: boolean };
type Product = { id: string; warehouseCode: string; name: string; sku: string; barcode: string; category: string; unit: string; minStock: number; oneCId?: string | null };
type Stock = { warehouseCode: string; productId: string; cellId: string; quantity: number };
type Movement = {
  id: string;
  type: string;
  productId: string;
  productName: string;
  productSku: string;
  productUnit: string;
  fromCellCode: string;
  toCellCode: string;
  quantity: number;
  recipient: string;
  comment: string;
  operator: string;
  createdAt: string;
};
type Snapshot = {
  warehouse: { code: string; name: string };
  racks: Rack[];
  cells: Cell[];
  products: Product[];
  stocks: Stock[];
  movements: Movement[];
};

const emptyData: Snapshot = { warehouse: { code: "", name: "Склад" }, racks: [], cells: [], products: [], stocks: [], movements: [] };

function formatNumber(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(value);
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function DepartmentWarehousePage() {
  const params = useParams<{ warehouse: string }>();
  const warehouseCode = String(params?.warehouse || "paint");
  const [data, setData] = useState<Snapshot>(emptyData);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  const loadData = useCallback(async () => {
    try {
      const response = await fetch("/api/department-warehouse", { cache: "no-store" });
      const body = await response.json() as Snapshot & { error?: string };
      if (!response.ok) throw new Error(body.error || "Не удалось загрузить склад");
      setData(body);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось загрузить склад");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  const post = async (payload: Record<string, unknown>, success: string) => {
    setSaving(true);
    try {
      const response = await fetch("/api/department-warehouse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "Операция не выполнена");
      toast.success(success);
      await loadData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Операция не выполнена");
      throw error;
    } finally {
      setSaving(false);
    }
  };

  const stockByProduct = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of data.stocks) map.set(row.productId, (map.get(row.productId) || 0) + Number(row.quantity));
    return map;
  }, [data.stocks]);

  const stockByCellProduct = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of data.stocks) map.set(`${row.productId}:${row.cellId}`, Number(row.quantity));
    return map;
  }, [data.stocks]);

  const productById = useMemo(() => new Map(data.products.map((item) => [item.id, item])), [data.products]);
  const cellsByRack = useMemo(() => {
    const map = new Map<string, Cell[]>();
    data.cells.forEach((cell) => map.set(cell.rackId, [...(map.get(cell.rackId) || []), cell]));
    return map;
  }, [data.cells]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data.products;
    return data.products.filter((product) => `${product.name} ${product.sku} ${product.category} ${product.barcode}`.toLowerCase().includes(q));
  }, [data.products, search]);

  const totalStock = data.stocks.reduce((sum, row) => sum + Number(row.quantity), 0);
  const occupiedCells = new Set(data.stocks.filter((row) => Number(row.quantity) > 0).map((row) => row.cellId)).size;
  const lowStock = data.products.filter((product) => product.minStock > 0 && (stockByProduct.get(product.id) || 0) <= product.minStock).length;
  const isPaint = warehouseCode === "paint";
  const HeaderIcon = isPaint ? PaintBucket : Layers3;

  if (loading) return <main className="flex min-h-screen items-center justify-center"><Loader2 className="animate-spin text-orange-500" size={34} /></main>;

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,.98),rgba(244,246,241,.92)_42%,rgba(236,239,232,.98)_100%)] text-[var(--foreground)]">
      <header className="app-header sticky top-0 z-30">
        <div className="mx-auto flex min-h-17 max-w-[1500px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-7">
          <div className="flex items-center gap-3">
            <div className="brand-mark"><TreePine size={22} /></div>
            <div>
              <div className="text-[15px] font-extrabold tracking-tight">РУССКИЙ ЛЕС · RL СКЛАД</div>
              <div className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]"><HeaderIcon size={13} /> {data.warehouse.name}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden rounded-full border border-black/10 bg-white/70 px-3 py-1.5 text-xs font-bold text-slate-600 sm:inline-flex">Изолированное подразделение</span>
            <Button variant="outline" size="sm" onClick={() => void loadData()}><RefreshCw size={15} /> Обновить</Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] px-4 py-5 sm:px-7 sm:py-7">
        <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Материалов", value: data.products.length, icon: Boxes },
            { label: "Остаток", value: formatNumber(totalStock), icon: CircleDot },
            { label: "Занято ячеек", value: occupiedCells, icon: MapPin },
            { label: "Ниже минимума", value: lowStock, icon: History },
          ].map(({ label, value, icon: Icon }) => <div key={label} className="rounded-2xl border border-white/80 bg-white/80 p-4 shadow-sm backdrop-blur"><div className="flex items-center justify-between"><span className="text-xs font-semibold text-slate-500">{label}</span><Icon size={17} className="text-orange-500" /></div><div className="mt-2 text-2xl font-black tracking-tight">{value}</div></div>)}
        </section>

        <Tabs defaultValue="materials" className="space-y-5">
          <TabsList className="glass-tabs h-auto w-full justify-start gap-1 overflow-x-auto rounded-2xl p-1.5">
            <TabsTrigger value="materials" className="px-3 py-2"><Boxes /> Материалы</TabsTrigger>
            <TabsTrigger value="racks" className="px-3 py-2"><Layers3 /> Стеллажи и ячейки</TabsTrigger>
            <TabsTrigger value="receipt" className="px-3 py-2"><ArrowDownToLine /> Приход</TabsTrigger>
            <TabsTrigger value="transfer" className="px-3 py-2"><ArrowRightLeft /> Перемещение</TabsTrigger>
            <TabsTrigger value="issue" className="px-3 py-2"><ArrowUpFromLine /> Выдача</TabsTrigger>
            <TabsTrigger value="history" className="px-3 py-2"><History /> Движения</TabsTrigger>
            <TabsTrigger value="onec" className="px-3 py-2"><RefreshCw /> Материалы из 1С</TabsTrigger>
          </TabsList>

          <TabsContent value="materials" className="space-y-4">
            <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
              <section className="panel overflow-hidden p-0">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/5 p-4 sm:p-5">
                  <div><h2 className="font-black">Материалы {data.warehouse.name.toLowerCase()}</h2><p className="mt-1 text-xs text-slate-500">Остатки считаются отдельно от других подразделений</p></div>
                  <div className="relative w-full sm:w-72"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17} /><Input value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" placeholder="Название, артикул, категория" /></div>
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow><TableHead>Материал</TableHead><TableHead>Артикул</TableHead><TableHead>Категория</TableHead><TableHead className="text-right">Остаток</TableHead><TableHead>Ячейки</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {filteredProducts.map((product) => {
                        const productStocks = data.stocks.filter((row) => row.productId === product.id && Number(row.quantity) > 0);
                        return <TableRow key={product.id}><TableCell className="font-bold">{product.name}</TableCell><TableCell className="font-mono text-xs">{product.sku}</TableCell><TableCell>{product.category}</TableCell><TableCell className="text-right font-black">{formatNumber(stockByProduct.get(product.id) || 0)} {product.unit}</TableCell><TableCell className="text-xs text-slate-500">{productStocks.length ? productStocks.map((stock) => `${data.cells.find((cell) => cell.id === stock.cellId)?.code || "—"}: ${formatNumber(stock.quantity)}`).join(" · ") : "Не размещён"}</TableCell></TableRow>;
                      })}
                      {!filteredProducts.length && <TableRow><TableCell colSpan={5} className="py-10 text-center text-slate-400">Материалы пока не добавлены</TableCell></TableRow>}
                    </TableBody>
                  </Table>
                </div>
              </section>
              <CreateProductCard isPaint={isPaint} saving={saving} onCreate={(payload) => post({ action: "createProduct", ...payload }, "Материал добавлен")} />
            </div>
          </TabsContent>

          <TabsContent value="racks" className="space-y-4">
            <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
              <section className="space-y-4">
                {data.racks.map((rack) => {
                  const rackCells = (cellsByRack.get(rack.id) || []).sort((a, b) => a.rowIndex - b.rowIndex || a.columnIndex - b.columnIndex);
                  return <div key={rack.id} className="panel p-4 sm:p-5"><div className="mb-4 flex items-center justify-between"><div><h3 className="font-black">{rack.code} · {rack.name}</h3><p className="text-xs text-slate-500">{rack.rows} полок × {rack.columns} ячеек</p></div><Layers3 className="text-orange-500" size={21} /></div><div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(rack.columns, 8)}, minmax(76px, 1fr))` }}>{rackCells.map((cell) => { const rows = data.stocks.filter((stock) => stock.cellId === cell.id && Number(stock.quantity) > 0); return <div key={cell.id} className={`min-h-20 rounded-xl border p-2.5 ${rows.length ? "border-orange-200 bg-orange-50/70" : "border-slate-200 bg-white/70"}`}><div className="text-xs font-black">{cell.code}</div><div className="mt-2 space-y-1 text-[10px] leading-4 text-slate-500">{rows.length ? rows.slice(0, 2).map((stock) => <div key={stock.productId}>{productById.get(stock.productId)?.name || "Материал"}<br/><b className="text-slate-800">{formatNumber(stock.quantity)} {productById.get(stock.productId)?.unit}</b></div>) : "Свободно"}</div></div>; })}</div></div>;
                })}
                {!data.racks.length && <div className="panel p-10 text-center text-slate-400">Создайте первый стеллаж для {data.warehouse.name.toLowerCase()}</div>}
              </section>
              <CreateRackCard saving={saving} onCreate={(payload) => post({ action: "createRack", ...payload }, "Стеллаж и ячейки созданы")} />
            </div>
          </TabsContent>

          <TabsContent value="receipt"><OperationCard mode="receipt" products={data.products} cells={data.cells} stocks={data.stocks} saving={saving} onSubmit={(payload) => post({ action: "receive", ...payload }, "Приход проведён")} /></TabsContent>
          <TabsContent value="transfer"><OperationCard mode="transfer" products={data.products} cells={data.cells} stocks={data.stocks} saving={saving} onSubmit={(payload) => post({ action: "transfer", ...payload }, "Материал перемещён")} /></TabsContent>
          <TabsContent value="issue"><OperationCard mode="issue" products={data.products} cells={data.cells} stocks={data.stocks} saving={saving} onSubmit={(payload) => post({ action: "issue", ...payload }, "Выдача проведена")} /></TabsContent>

          <TabsContent value="history">
            <section className="panel overflow-hidden p-0"><div className="border-b border-black/5 p-5"><h2 className="font-black">Журнал движений</h2><p className="mt-1 text-xs text-slate-500">Кто, когда и что сделал на этом складе</p></div><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Дата</TableHead><TableHead>Операция</TableHead><TableHead>Материал</TableHead><TableHead>Маршрут</TableHead><TableHead className="text-right">Количество</TableHead><TableHead>Сотрудник / получатель</TableHead></TableRow></TableHeader><TableBody>{data.movements.map((movement) => <TableRow key={movement.id}><TableCell className="whitespace-nowrap text-xs">{formatDate(movement.createdAt)}</TableCell><TableCell className="font-bold">{movement.type}</TableCell><TableCell><b>{movement.productName}</b><div className="text-xs text-slate-400">{movement.productSku}</div></TableCell><TableCell className="text-xs">{movement.fromCellCode || "Приход"}{movement.fromCellCode && movement.toCellCode ? " → " : ""}{movement.toCellCode || (movement.type === "Выдача" ? "Выдано" : "")}</TableCell><TableCell className="text-right font-black">{formatNumber(movement.quantity)} {movement.productUnit}</TableCell><TableCell className="text-xs"><b>{movement.operator}</b>{movement.recipient && <div className="text-slate-500">Получатель: {movement.recipient}</div>}</TableCell></TableRow>)}{!data.movements.length && <TableRow><TableCell colSpan={6} className="py-10 text-center text-slate-400">Движений пока нет</TableCell></TableRow>}</TableBody></Table></div></section>
          </TabsContent>

          <TabsContent value="onec">
            <section className="panel overflow-hidden p-0"><div className="grid gap-0 lg:grid-cols-[1fr_340px]"><div className="p-6 sm:p-8"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-100 text-orange-600"><RefreshCw size={22} /></div><h2 className="mt-5 text-2xl font-black">Материалы из 1С</h2><p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">Раздел уже предусмотрен для этого подразделения. Подключение OData пока специально не включаем: когда будет готов доступ к 1С, сюда добавим загрузку номенклатуры и документов именно для {data.warehouse.name.toLowerCase()}.</p><div className="mt-5 inline-flex rounded-xl border border-dashed border-orange-300 bg-orange-50 px-4 py-3 text-sm font-semibold text-orange-800">Статус: ожидает подключения OData</div></div><div className="border-t border-black/5 bg-slate-950 p-6 text-white lg:border-l lg:border-t-0"><div className="text-xs font-bold uppercase tracking-[.16em] text-white/45">Будет доступно</div><ul className="mt-4 space-y-3 text-sm text-white/80"><li>• Номенклатура из 1С</li><li>• Единицы измерения</li><li>• Документы на выдачу</li><li>• Сопоставление с ячейками</li><li>• Контроль фактического остатка</li></ul></div></div></section>
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}

function CreateProductCard({ isPaint, saving, onCreate }: { isPaint: boolean; saving: boolean; onCreate: (payload: Record<string, unknown>) => Promise<void> }) {
  const [key, setKey] = useState(0);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await onCreate({ name: form.get("name"), sku: form.get("sku"), barcode: form.get("barcode"), category: form.get("category"), unit: form.get("unit"), minStock: form.get("minStock") });
    setKey((value) => value + 1);
  }
  return <section className="panel h-fit p-5"><div className="mb-5 flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950 text-white"><PackagePlus size={19} /></div><div><h3 className="font-black">Добавить материал</h3><p className="text-xs text-slate-500">Вручную до подключения 1С</p></div></div><form key={key} onSubmit={submit} className="space-y-3"><div><Label>Наименование</Label><Input name="name" required className="mt-1.5" placeholder={isPaint ? "Эмаль полиуретановая" : "Материал"} /></div><div><Label>Артикул</Label><Input name="sku" className="mt-1.5" placeholder="Можно оставить пустым" /></div><div><Label>Категория</Label><Input name="category" className="mt-1.5" defaultValue={isPaint ? "Краска" : "Материалы"} /></div><div className="grid grid-cols-2 gap-3"><div><Label>Ед. изм.</Label><Input name="unit" className="mt-1.5" defaultValue={isPaint ? "кг" : "шт."} /></div><div><Label>Мин. остаток</Label><Input name="minStock" type="number" min="0" step="0.001" className="mt-1.5" defaultValue="0" /></div></div><div><Label>Штрихкод</Label><Input name="barcode" className="mt-1.5" placeholder="Необязательно" /></div><Button disabled={saving} className="accent-button w-full"><Plus /> Добавить</Button></form></section>;
}

function CreateRackCard({ saving, onCreate }: { saving: boolean; onCreate: (payload: Record<string, unknown>) => Promise<void> }) {
  const [key, setKey] = useState(0);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await onCreate({ name: form.get("name"), code: form.get("code"), rows: form.get("rows"), columns: form.get("columns") });
    setKey((value) => value + 1);
  }
  return <section className="panel h-fit p-5"><div className="mb-5 flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950 text-white"><Layers3 size={19} /></div><div><h3 className="font-black">Новый стеллаж</h3><p className="text-xs text-slate-500">Ячейки создадутся автоматически</p></div></div><form key={key} onSubmit={submit} className="space-y-3"><div><Label>Название</Label><Input name="name" required className="mt-1.5" placeholder="Стеллаж краски №1" /></div><div><Label>Код</Label><Input name="code" required className="mt-1.5 uppercase" placeholder="K1" /></div><div className="grid grid-cols-2 gap-3"><div><Label>Полок</Label><Input name="rows" type="number" min="1" max="12" defaultValue="4" className="mt-1.5" /></div><div><Label>Ячеек на полке</Label><Input name="columns" type="number" min="1" max="20" defaultValue="4" className="mt-1.5" /></div></div><Button disabled={saving} className="accent-button w-full"><Plus /> Создать стеллаж</Button></form></section>;
}

function OperationCard({ mode, products, cells, stocks, saving, onSubmit }: { mode: "receipt" | "issue" | "transfer"; products: Product[]; cells: Cell[]; stocks: Stock[]; saving: boolean; onSubmit: (payload: Record<string, unknown>) => Promise<void> }) {
  const [productId, setProductId] = useState("");
  const [fromCellId, setFromCellId] = useState("");
  const product = products.find((item) => item.id === productId);
  const availableCells = mode === "receipt" ? cells : cells.filter((cell) => stocks.some((stock) => stock.productId === productId && stock.cellId === cell.id && Number(stock.quantity) > 0));
  const title = mode === "receipt" ? "Оприходование" : mode === "issue" ? "Выдача со склада" : "Перемещение между ячейками";
  const Icon = mode === "receipt" ? ArrowDownToLine : mode === "issue" ? ArrowUpFromLine : ArrowRightLeft;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload: Record<string, unknown> = { productId, quantity: form.get("quantity"), comment: form.get("comment") };
    if (mode === "receipt") payload.cellId = form.get("cellId");
    if (mode === "issue") { payload.cellId = fromCellId; payload.recipient = form.get("recipient"); }
    if (mode === "transfer") { payload.fromCellId = fromCellId; payload.toCellId = form.get("toCellId"); }
    await onSubmit(payload);
    (event.currentTarget as HTMLFormElement).reset();
    setProductId(""); setFromCellId("");
  }

  return <section className="panel mx-auto max-w-3xl p-5 sm:p-7"><div className="mb-6 flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-950 text-white"><Icon size={20} /></div><div><h2 className="text-xl font-black">{title}</h2><p className="text-xs text-slate-500">Операция попадёт в журнал сотрудника</p></div></div><form onSubmit={submit} className="grid gap-4 sm:grid-cols-2"><div className="sm:col-span-2"><Label>Материал</Label><select required value={productId} onChange={(event) => { setProductId(event.target.value); setFromCellId(""); }} className="mt-1.5 h-11 w-full rounded-xl border border-input bg-white px-3 text-sm"><option value="">Выберите материал</option>{products.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.sku}</option>)}</select></div>{mode === "receipt" ? <div><Label>Ячейка</Label><select name="cellId" required className="mt-1.5 h-11 w-full rounded-xl border border-input bg-white px-3 text-sm"><option value="">Куда разместить</option>{cells.map((cell) => <option key={cell.id} value={cell.id}>{cell.code}</option>)}</select></div> : <div><Label>Откуда</Label><select required value={fromCellId} onChange={(event) => setFromCellId(event.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-input bg-white px-3 text-sm"><option value="">Выберите ячейку</option>{availableCells.map((cell) => { const qty = stocks.find((stock) => stock.productId === productId && stock.cellId === cell.id)?.quantity || 0; return <option key={cell.id} value={cell.id}>{cell.code} · {formatNumber(Number(qty))} {product?.unit || ""}</option>; })}</select></div>}{mode === "transfer" && <div><Label>Куда</Label><select name="toCellId" required className="mt-1.5 h-11 w-full rounded-xl border border-input bg-white px-3 text-sm"><option value="">Выберите ячейку</option>{cells.filter((cell) => cell.id !== fromCellId).map((cell) => <option key={cell.id} value={cell.id}>{cell.code}</option>)}</select></div>}<div><Label>Количество {product?.unit ? `(${product.unit})` : ""}</Label><Input name="quantity" required type="number" min="0.001" step="0.001" className="mt-1.5" placeholder="0" /></div>{mode === "issue" && <div><Label>Получатель</Label><Input name="recipient" className="mt-1.5" placeholder="Цех / сотрудник / заказ" /></div>}<div className="sm:col-span-2"><Label>Комментарий</Label><Input name="comment" className="mt-1.5" placeholder="Необязательно" /></div><div className="sm:col-span-2"><Button disabled={saving || !productId} className="accent-button h-11 w-full">{saving ? <Loader2 className="animate-spin" /> : <Icon />} {mode === "receipt" ? "Оприходовать" : mode === "issue" ? "Выдать" : "Переместить"}</Button></div></form></section>;
}
