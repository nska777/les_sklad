"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import * as XLSX from "xlsx";
import Barcode from "react-barcode";
import { QRCodeSVG } from "qrcode.react";
import {
  ArrowDownToLine,
  ArrowRightLeft,
  ArrowUpFromLine,
  Barcode as BarcodeIcon,
  Boxes,
  FileSpreadsheet,
  History,
  Layers3,
  Loader2,
  MapPin,
  PackagePlus,
  PaintBucket,
  Pencil,
  Plus,
  Printer,
  QrCode,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
  TreePine,
  Undo2,
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
type Movement = { id: string; type: string; productId: string; productName: string; productSku: string; productUnit: string; fromCellCode: string; toCellCode: string; quantity: number; recipient: string; comment: string; operator: string; createdAt: string };
type Snapshot = { warehouse: { code: string; name: string }; racks: Rack[]; cells: Cell[]; products: Product[]; stocks: Stock[]; movements: Movement[] };

const emptyData: Snapshot = { warehouse: { code: "paint", name: "Склад краски" }, racks: [], cells: [], products: [], stocks: [], movements: [] };
const fmt = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(value);
const dateFmt = (value: string) => new Date(value).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default function WarehouseFullUi() {
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
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  const post = async (payload: Record<string, unknown>, success?: string) => {
    setSaving(true);
    try {
      const response = await fetch("/api/department-warehouse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json() as { error?: string; created?: number; updated?: number };
      if (!response.ok) throw new Error(body.error || "Операция не выполнена");
      if (success) toast.success(success);
      await loadData();
      return body;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Операция не выполнена");
      throw error;
    } finally { setSaving(false); }
  };

  const stockByProduct = useMemo(() => {
    const map = new Map<string, number>();
    data.stocks.forEach((row) => map.set(row.productId, (map.get(row.productId) || 0) + Number(row.quantity)));
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
    return data.products.filter((product) => `${product.name} ${product.sku} ${product.barcode} ${product.category}`.toLowerCase().includes(q));
  }, [data.products, search]);

  const totalStock = data.stocks.reduce((sum, row) => sum + Number(row.quantity), 0);
  const occupied = new Set(data.stocks.filter((row) => Number(row.quantity) > 0).map((row) => row.cellId)).size;
  const lowStock = data.products.filter((product) => product.minStock > 0 && (stockByProduct.get(product.id) || 0) <= product.minStock).length;

  if (loading) return <main className="flex min-h-screen items-center justify-center"><Loader2 className="animate-spin text-orange-500" size={34} /></main>;

  return <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,.98),rgba(244,246,241,.92)_42%,rgba(236,239,232,.98)_100%)] text-[var(--foreground)]">
    <header className="app-header sticky top-0 z-30">
      <div className="mx-auto flex min-h-17 max-w-[1500px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-7">
        <div className="flex items-center gap-3"><div className="brand-mark"><TreePine size={22} /></div><div><div className="text-[15px] font-extrabold tracking-tight">РУССКИЙ ЛЕС · RL СКЛАД</div><div className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]"><PaintBucket size={13} /> {data.warehouse.name}</div></div></div>
        <Button variant="outline" size="sm" onClick={() => void loadData()}><RefreshCw size={15} /> Обновить</Button>
      </div>
    </header>

    <div className="mx-auto max-w-[1500px] px-4 py-5 sm:px-7 sm:py-7">
      <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Материалов" value={data.products.length} icon={Boxes} />
        <Metric label="Всего на складе" value={fmt(totalStock)} icon={PackagePlus} />
        <Metric label="Занято ячеек" value={occupied} icon={MapPin} />
        <Metric label="Низкий остаток" value={lowStock} icon={ShieldAlert} />
      </section>

      <Tabs defaultValue="materials" className="space-y-5">
        <TabsList className="glass-tabs h-auto w-full justify-start gap-1 overflow-x-auto rounded-2xl p-1.5">
          <TabsTrigger value="onec"><FileSpreadsheet /> Склад 1С</TabsTrigger>
          <TabsTrigger value="materials"><Boxes /> Материалы</TabsTrigger>
          <TabsTrigger value="racks"><Layers3 /> Стеллажи</TabsTrigger>
          <TabsTrigger value="labels"><QrCode /> QR и штрихкоды</TabsTrigger>
          <TabsTrigger value="receipt"><ArrowDownToLine /> Приход</TabsTrigger>
          <TabsTrigger value="transfer"><ArrowRightLeft /> Перемещение</TabsTrigger>
          <TabsTrigger value="issue"><ArrowUpFromLine /> Выдача</TabsTrigger>
          <TabsTrigger value="history"><History /> Движения</TabsTrigger>
        </TabsList>

        <TabsContent value="onec"><OneCImport saving={saving} onImport={async (items) => { const result = await post({ action: "bulkImportProducts", items }); toast.success(`Импорт завершён: добавлено ${result.created || 0}, обновлено ${result.updated || 0}`); }} /></TabsContent>

        <TabsContent value="materials" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
            <section className="panel overflow-hidden p-0">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/5 p-4 sm:p-5"><div><h2 className="font-black">Материалы склада краски</h2><p className="mt-1 text-xs text-slate-500">Редактирование, удаление, остатки и ячейки</p></div><div className="relative w-full sm:w-72"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17} /><Input value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" placeholder="Поиск материала" /></div></div>
              <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Материал</TableHead><TableHead>Артикул</TableHead><TableHead>Категория</TableHead><TableHead>Штрихкод</TableHead><TableHead className="text-right">Остаток</TableHead><TableHead>Ячейки</TableHead><TableHead className="w-24">Действия</TableHead></TableRow></TableHeader><TableBody>
                {filteredProducts.map((product) => {
                  const productStocks = data.stocks.filter((row) => row.productId === product.id && Number(row.quantity) > 0);
                  return <TableRow key={product.id}><TableCell className="font-bold">{product.name}</TableCell><TableCell className="font-mono text-xs">{product.sku}</TableCell><TableCell>{product.category}</TableCell><TableCell className="font-mono text-xs">{product.barcode || "—"}</TableCell><TableCell className="text-right font-black">{fmt(stockByProduct.get(product.id) || 0)} {product.unit}</TableCell><TableCell className="max-w-64 text-xs text-slate-500">{productStocks.length ? productStocks.map((stock) => `${data.cells.find((cell) => cell.id === stock.cellId)?.code || "—"}: ${fmt(stock.quantity)}`).join(" · ") : "Не размещён"}</TableCell><TableCell><div className="flex gap-1"><Button size="icon" variant="outline" title="Редактировать" onClick={() => void editProduct(product, post)}><Pencil size={15} /></Button><Button size="icon" variant="outline" title="Удалить" disabled={(stockByProduct.get(product.id) || 0) > 0} onClick={() => void removeProduct(product, post)}><Trash2 size={15} /></Button></div></TableCell></TableRow>;
                })}
                {!filteredProducts.length && <TableRow><TableCell colSpan={7} className="py-10 text-center text-slate-400">Материалы пока не добавлены</TableCell></TableRow>}
              </TableBody></Table></div>
            </section>
            <CreateProductCard saving={saving} onCreate={(payload) => post({ action: "createProduct", ...payload }, "Материал добавлен")} />
          </div>
        </TabsContent>

        <TabsContent value="racks" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
            <section className="space-y-4">
              {data.racks.map((rack) => <RackCard key={rack.id} rack={rack} cells={(cellsByRack.get(rack.id) || []).sort((a,b) => a.rowIndex-b.rowIndex || a.columnIndex-b.columnIndex)} stocks={data.stocks} productById={productById} post={post} />)}
              {!data.racks.length && <div className="panel p-10 text-center text-slate-400">Создайте первый стеллаж</div>}
            </section>
            <CreateRackCard saving={saving} onCreate={(payload) => post({ action: "createRack", ...payload }, "Стеллаж и ячейки созданы")} />
          </div>
        </TabsContent>

        <TabsContent value="labels"><Labels products={data.products} cells={data.cells} /></TabsContent>
        <TabsContent value="receipt"><OperationCard mode="receipt" products={data.products} cells={data.cells} stocks={data.stocks} saving={saving} onSubmit={(payload) => post({ action: "receive", ...payload }, "Приход проведён")} /></TabsContent>
        <TabsContent value="transfer"><OperationCard mode="transfer" products={data.products} cells={data.cells} stocks={data.stocks} saving={saving} onSubmit={(payload) => post({ action: "transfer", ...payload }, "Материал перемещён")} /></TabsContent>
        <TabsContent value="issue"><OperationCard mode="issue" products={data.products} cells={data.cells} stocks={data.stocks} saving={saving} onSubmit={(payload) => post({ action: "issue", ...payload }, "Выдача проведена")} /></TabsContent>

        <TabsContent value="history"><section className="panel overflow-hidden p-0"><div className="border-b border-black/5 p-5"><h2 className="font-black">Журнал движений</h2><p className="mt-1 text-xs text-slate-500">Ошибочную операцию можно отменить — остатки вернутся автоматически</p></div><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Дата</TableHead><TableHead>Операция</TableHead><TableHead>Материал</TableHead><TableHead>Маршрут</TableHead><TableHead className="text-right">Количество</TableHead><TableHead>Сотрудник</TableHead><TableHead>Действие</TableHead></TableRow></TableHeader><TableBody>{data.movements.map((m) => <TableRow key={m.id}><TableCell className="whitespace-nowrap text-xs">{dateFmt(m.createdAt)}</TableCell><TableCell className="font-bold">{m.type}</TableCell><TableCell><b>{m.productName}</b><div className="text-xs text-slate-400">{m.productSku}</div></TableCell><TableCell className="text-xs">{m.fromCellCode || "Приход"}{m.fromCellCode && m.toCellCode ? " → " : ""}{m.toCellCode || (m.type === "Выдача" ? "Выдано" : "")}</TableCell><TableCell className="text-right font-black">{fmt(m.quantity)} {m.productUnit}</TableCell><TableCell className="text-xs">{m.operator}{m.recipient ? <div className="text-slate-500">Получатель: {m.recipient}</div> : null}</TableCell><TableCell><Button size="sm" variant="outline" onClick={() => void undoMovement(m, post)}><Undo2 size={14} /> Отменить</Button></TableCell></TableRow>)}{!data.movements.length && <TableRow><TableCell colSpan={7} className="py-10 text-center text-slate-400">Движений пока нет</TableCell></TableRow>}</TableBody></Table></div></section></TabsContent>
      </Tabs>
    </div>
  </main>;
}

function Metric({ label, value, icon: Icon }: { label: string; value: string | number; icon: typeof Boxes }) { return <div className="rounded-2xl border border-white/80 bg-white/80 p-4 shadow-sm backdrop-blur"><div className="flex items-center justify-between"><span className="text-xs font-semibold text-slate-500">{label}</span><Icon size={17} className="text-orange-500" /></div><div className="mt-2 text-2xl font-black tracking-tight">{value}</div></div>; }

async function editProduct(product: Product, post: (payload: Record<string, unknown>, success?: string) => Promise<unknown>) {
  const name = window.prompt("Наименование", product.name); if (!name) return;
  const sku = window.prompt("Артикул", product.sku) ?? product.sku;
  const category = window.prompt("Категория", product.category) ?? product.category;
  const unit = window.prompt("Единица измерения", product.unit) ?? product.unit;
  const barcode = window.prompt("Штрихкод", product.barcode) ?? product.barcode;
  const minStock = window.prompt("Минимальный остаток", String(product.minStock)) ?? String(product.minStock);
  await post({ action: "updateProduct", id: product.id, name, sku, category, unit, barcode, minStock }, "Материал обновлён");
}
async function removeProduct(product: Product, post: (payload: Record<string, unknown>, success?: string) => Promise<unknown>) { if (!window.confirm(`Удалить «${product.name}»?`)) return; await post({ action: "deleteProduct", id: product.id }, "Материал удалён"); }
async function undoMovement(movement: Movement, post: (payload: Record<string, unknown>, success?: string) => Promise<unknown>) { if (!window.confirm(`Отменить операцию «${movement.type}» по материалу «${movement.productName}»?`)) return; await post({ action: "undoMovement", id: movement.id }, "Операция отменена"); }

function CreateProductCard({ saving, onCreate }: { saving: boolean; onCreate: (payload: Record<string, unknown>) => Promise<unknown> }) {
  const [key, setKey] = useState(0);
  async function submit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); const f = new FormData(e.currentTarget); await onCreate({ name: f.get("name"), sku: f.get("sku"), barcode: f.get("barcode"), category: f.get("category"), unit: f.get("unit"), minStock: f.get("minStock") }); setKey(v => v + 1); }
  return <section className="panel h-fit p-5"><div className="mb-5 flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950 text-white"><PackagePlus size={19} /></div><div><h3 className="font-black">Добавить материал</h3><p className="text-xs text-slate-500">Штрихкод создастся автоматически, если оставить пустым</p></div></div><form key={key} onSubmit={submit} className="space-y-3"><div><Label>Наименование</Label><Input name="name" required className="mt-1.5" placeholder="Эмаль полиуретановая" /></div><div><Label>Артикул</Label><Input name="sku" className="mt-1.5" placeholder="PAINT-001" /></div><div><Label>Категория</Label><Input name="category" className="mt-1.5" defaultValue="Краска" /></div><div className="grid grid-cols-2 gap-3"><div><Label>Ед. изм.</Label><Input name="unit" className="mt-1.5" defaultValue="кг" /></div><div><Label>Мин. остаток</Label><Input name="minStock" type="number" min="0" step="0.001" className="mt-1.5" defaultValue="0" /></div></div><div><Label>Штрихкод</Label><Input name="barcode" className="mt-1.5" placeholder="Автоматически" /></div><Button disabled={saving} className="accent-button w-full"><Plus /> Добавить</Button></form></section>;
}

function CreateRackCard({ saving, onCreate }: { saving: boolean; onCreate: (payload: Record<string, unknown>) => Promise<unknown> }) {
  const [key, setKey] = useState(0);
  async function submit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); const f = new FormData(e.currentTarget); await onCreate({ name: f.get("name"), code: f.get("code"), rows: f.get("rows"), columns: f.get("columns") }); setKey(v => v + 1); }
  return <section className="panel h-fit p-5"><div className="mb-5 flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950 text-white"><Layers3 size={19} /></div><div><h3 className="font-black">Новый стеллаж</h3><p className="text-xs text-slate-500">Одна большая комната — только стеллажи и ячейки</p></div></div><form key={key} onSubmit={submit} className="space-y-3"><div><Label>Название</Label><Input name="name" required className="mt-1.5" placeholder="Стеллаж краски №1" /></div><div><Label>Код</Label><Input name="code" required className="mt-1.5 uppercase" placeholder="K1" /></div><div className="grid grid-cols-2 gap-3"><div><Label>Полок</Label><Input name="rows" type="number" min="1" max="12" defaultValue="4" className="mt-1.5" /></div><div><Label>Ячеек на полке</Label><Input name="columns" type="number" min="1" max="20" defaultValue="4" className="mt-1.5" /></div></div><Button disabled={saving} className="accent-button w-full"><Plus /> Создать стеллаж</Button></form></section>;
}

function RackCard({ rack, cells, stocks, productById, post }: { rack: Rack; cells: Cell[]; stocks: Stock[]; productById: Map<string, Product>; post: (payload: Record<string, unknown>, success?: string) => Promise<unknown> }) {
  const hasStock = cells.some(cell => stocks.some(stock => stock.cellId === cell.id && Number(stock.quantity) > 0));
  return <div className="panel p-4 sm:p-5"><div className="mb-4 flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-black">{rack.code} · {rack.name}</h3><p className="text-xs text-slate-500">{rack.rows} полок × {rack.columns} ячеек</p></div><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => { const name = window.prompt("Название стеллажа", rack.name); if (name) void post({ action: "updateRack", id: rack.id, name }, "Стеллаж обновлён"); }}><Pencil size={14} /> Изменить</Button><Button size="sm" variant="outline" disabled={hasStock} onClick={() => { if (window.confirm(`Удалить стеллаж ${rack.code}?`)) void post({ action: "deleteRack", id: rack.id }, "Стеллаж удалён"); }}><Trash2 size={14} /> Удалить</Button></div></div><div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(rack.columns, 8)}, minmax(86px, 1fr))` }}>{cells.map(cell => { const rows = stocks.filter(s => s.cellId === cell.id && Number(s.quantity) > 0); return <button key={cell.id} type="button" onClick={() => { const label = window.prompt("Подпись ячейки", cell.label) ?? cell.label; const blocked = window.confirm("Заблокировать ячейку? Нажмите ОК для блокировки, Отмена — оставить доступной."); void post({ action: "updateCell", id: cell.id, label, blocked }, "Ячейка обновлена"); }} className={`min-h-24 rounded-xl border p-2.5 text-left transition hover:-translate-y-0.5 ${cell.blocked ? "border-red-200 bg-red-50" : rows.length ? "border-orange-200 bg-orange-50/70" : "border-slate-200 bg-white/70"}`}><div className="flex items-center justify-between"><span className="text-xs font-black">{cell.code}</span>{cell.blocked ? <span className="text-[9px] font-bold text-red-600">БЛОК</span> : null}</div><div className="mt-1 truncate text-[10px] text-slate-400">{cell.label}</div><div className="mt-2 space-y-1 text-[10px] leading-4 text-slate-500">{rows.length ? rows.slice(0,2).map(s => <div key={s.productId}>{productById.get(s.productId)?.name || "Материал"}<br/><b className="text-slate-800">{fmt(s.quantity)} {productById.get(s.productId)?.unit}</b></div>) : "Свободно"}</div></button>; })}</div></div>;
}

function OperationCard({ mode, products, cells, stocks, saving, onSubmit }: { mode: "receipt" | "issue" | "transfer"; products: Product[]; cells: Cell[]; stocks: Stock[]; saving: boolean; onSubmit: (payload: Record<string, unknown>) => Promise<unknown> }) {
  const [productId, setProductId] = useState(""); const [fromCellId, setFromCellId] = useState("");
  const product = products.find(p => p.id === productId);
  const sourceCells = cells.filter(cell => stocks.some(stock => stock.productId === productId && stock.cellId === cell.id && Number(stock.quantity) > 0));
  const title = mode === "receipt" ? "Оприходование" : mode === "issue" ? "Выдача со склада" : "Перемещение между ячейками";
  const Icon = mode === "receipt" ? ArrowDownToLine : mode === "issue" ? ArrowUpFromLine : ArrowRightLeft;
  async function submit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); const f = new FormData(e.currentTarget); const payload: Record<string, unknown> = { productId, quantity: f.get("quantity"), comment: f.get("comment") }; if (mode === "receipt") payload.cellId = f.get("cellId"); if (mode === "issue") { payload.cellId = fromCellId; payload.recipient = f.get("recipient"); } if (mode === "transfer") { payload.fromCellId = fromCellId; payload.toCellId = f.get("toCellId"); } await onSubmit(payload); e.currentTarget.reset(); setProductId(""); setFromCellId(""); }
  return <section className="panel mx-auto max-w-3xl p-5 sm:p-7"><div className="mb-6 flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-950 text-white"><Icon size={20} /></div><div><h2 className="text-xl font-black">{title}</h2><p className="text-xs text-slate-500">Количество краски поддерживает дробные значения: кг, л, мл</p></div></div><form onSubmit={submit} className="grid gap-4 sm:grid-cols-2"><div className="sm:col-span-2"><Label>Материал</Label><select required value={productId} onChange={e => { setProductId(e.target.value); setFromCellId(""); }} className="mt-1.5 h-10 w-full rounded-md border bg-white px-3 text-sm"><option value="">Выберите материал</option>{products.map(p => <option key={p.id} value={p.id}>{p.name} · {p.sku}</option>)}</select></div>{mode === "receipt" ? <div><Label>Ячейка</Label><select name="cellId" required className="mt-1.5 h-10 w-full rounded-md border bg-white px-3 text-sm"><option value="">Выберите ячейку</option>{cells.filter(c => !c.blocked).map(c => <option key={c.id} value={c.id}>{c.code}</option>)}</select></div> : <div><Label>Из ячейки</Label><select required value={fromCellId} onChange={e => setFromCellId(e.target.value)} className="mt-1.5 h-10 w-full rounded-md border bg-white px-3 text-sm"><option value="">Выберите ячейку</option>{sourceCells.map(c => <option key={c.id} value={c.id}>{c.code}</option>)}</select></div>}{mode === "transfer" ? <div><Label>В ячейку</Label><select name="toCellId" required className="mt-1.5 h-10 w-full rounded-md border bg-white px-3 text-sm"><option value="">Выберите ячейку</option>{cells.filter(c => !c.blocked && c.id !== fromCellId).map(c => <option key={c.id} value={c.id}>{c.code}</option>)}</select></div> : <div><Label>Количество {product ? `(${product.unit})` : ""}</Label><Input name="quantity" type="number" min="0.001" step="0.001" required className="mt-1.5" /></div>}{mode === "transfer" ? <div><Label>Количество {product ? `(${product.unit})` : ""}</Label><Input name="quantity" type="number" min="0.001" step="0.001" required className="mt-1.5" /></div> : null}{mode === "issue" ? <div><Label>Получатель</Label><Input name="recipient" className="mt-1.5" placeholder="Цех / сотрудник" /></div> : null}<div className="sm:col-span-2"><Label>Комментарий</Label><Input name="comment" className="mt-1.5" /></div><Button disabled={saving} className="accent-button sm:col-span-2">{saving ? <Loader2 className="animate-spin" /> : <Icon />} Провести операцию</Button></form></section>;
}

function OneCImport({ saving, onImport }: { saving: boolean; onImport: (items: Array<Record<string, unknown>>) => Promise<void> }) {
  const [fileName, setFileName] = useState("");
  async function handleFile(file?: File) {
    if (!file) return;
    setFileName(file.name);
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      const pick = (row: Record<string, unknown>, names: string[]) => { const key = Object.keys(row).find(k => names.some(n => k.trim().toLowerCase().includes(n))); return key ? row[key] : ""; };
      const items = rows.map(row => ({
        name: pick(row, ["наименование", "номенклатура", "name"]),
        sku: pick(row, ["артикул", "код", "sku"]),
        barcode: pick(row, ["штрих", "barcode"]),
        category: pick(row, ["категор", "группа", "category"]),
        unit: pick(row, ["ед.", "единиц", "unit"]),
        oneCId: pick(row, ["guid", "ссылка", "1с id", "1c id"]),
      })).filter(item => String(item.name).trim());
      if (!items.length) throw new Error("Не нашёл колонку с наименованием. Нужна колонка «Наименование» или «Номенклатура».");
      await onImport(items);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось прочитать файл"); }
  }
  return <section className="panel overflow-hidden p-0"><div className="grid lg:grid-cols-[1fr_360px]"><div className="p-6 sm:p-8"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-100 text-orange-600"><FileSpreadsheet size={22} /></div><h2 className="mt-5 text-2xl font-black">Склад 1С · импорт материалов</h2><p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">Загрузите XLSX, XLS или CSV, выгруженный из 1С. Номенклатура попадёт только в склад краски. Повторный импорт обновляет материал по артикулу.</p><label className="mt-6 flex cursor-pointer items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-orange-300 bg-orange-50 p-8 text-center transition hover:bg-orange-100"><FileSpreadsheet className="text-orange-600" /><span><b>{fileName || "Выбрать файл из 1С"}</b><span className="mt-1 block text-xs text-slate-500">.xlsx · .xls · .csv</span></span><input type="file" accept=".xlsx,.xls,.csv" className="hidden" disabled={saving} onChange={e => void handleFile(e.target.files?.[0])} /></label></div><div className="border-t border-black/5 bg-slate-950 p-6 text-white lg:border-l lg:border-t-0"><div className="text-xs font-bold uppercase tracking-[.16em] text-white/45">Распознаём колонки</div><ul className="mt-4 space-y-3 text-sm text-white/80"><li>• Наименование / Номенклатура</li><li>• Артикул / Код</li><li>• Штрихкод</li><li>• Категория / Группа</li><li>• Единица измерения</li><li>• GUID / ссылка 1С</li></ul></div></div></section>;
}

function Labels({ products, cells }: { products: Product[]; cells: Cell[] }) {
  const [mode, setMode] = useState<"products" | "cells">("products");
  return <section className="space-y-4"><div className="panel flex flex-wrap items-center justify-between gap-3 p-4"><div><h2 className="font-black">Этикетки и коды</h2><p className="text-xs text-slate-500">Печать штрихкодов материалов и QR-кодов ячеек</p></div><div className="flex gap-2"><Button variant={mode === "products" ? "default" : "outline"} onClick={() => setMode("products")}><BarcodeIcon size={15} /> Материалы</Button><Button variant={mode === "cells" ? "default" : "outline"} onClick={() => setMode("cells")}><QrCode size={15} /> Ячейки</Button><Button variant="outline" onClick={() => window.print()}><Printer size={15} /> Печать</Button></div></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{mode === "products" ? products.map(p => <div key={p.id} className="rounded-2xl border bg-white p-4 text-center"><div className="mb-2 truncate font-bold">{p.name}</div><div className="text-xs text-slate-500">{p.sku}</div><div className="mt-3 overflow-hidden"><Barcode value={p.barcode || p.sku} height={48} fontSize={11} width={1.25} margin={0} displayValue /></div></div>) : cells.map(c => <div key={c.id} className="rounded-2xl border bg-white p-4 text-center"><div className="font-black">{c.code}</div><div className="mt-1 text-xs text-slate-500">{c.label}</div><div className="mt-4 flex justify-center"><QRCodeSVG value={`CELL:${c.code}`} size={112} /></div></div>)}</div></section>;
}
