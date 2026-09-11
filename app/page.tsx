"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Activity, Archive, ArrowDownToLine, ArrowRightLeft, ArrowUpFromLine, Boxes, ChevronRight, ClipboardList, Download, Grid3X3, History, Layers3, ListChecks, Loader2, MapPin, PackagePlus, Pencil, Plus, Printer, QrCode, RefreshCw, ScanLine, Search, Settings2, Smartphone, Trash2, TreePine } from "lucide-react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ProductLabels, WarehouseWorkflows } from "@/app/warehouse-workflows";
import { InitialInventoryGuide } from "@/app/initial-inventory-guide";
import { InstallGuide } from "@/app/pwa-tools";

type Rack = { id: string; name: string; code: string; rows: number; columns: number };
type Cell = { id: string; rackId: string; code: string; label: string; rowIndex: number; columnIndex: number; blocked: boolean };
type Product = { id: string; name: string; sku: string; barcode: string; category: string; unit: string; packQty: number; imageUrl: string; minStock: number };
type Stock = { productId: string; cellId: string; quantity: number };
type Movement = { id: string; type: string; productName: string; productUnit: string; cellCode: string; quantity: number; operator: string; source: string; recipient: string; comment: string; documentNumber: string | null; createdAt: string };
type ActivityLog = { id: string; action: string; entityType: string; entityId: string; entityName: string; details: string; operator: string; createdAt: string };
type WarehouseDocument = { id: string; number: string; type: "receipt" | "issue"; status: string; counterparty: string; recipient: string; oneCId: string | null; syncStatus: string; comment: string; createdBy: string; createdAt: string; completedAt: string | null; lineId: string; productId: string; productName: string; productSku: string; productUnit: string; plannedQuantity: number; processedQuantity: number };
type Snapshot = { racks: Rack[]; cells: Cell[]; products: Product[]; stocks: Stock[]; movements: Movement[]; activities: ActivityLog[]; documents: WarehouseDocument[] };
const emptyData: Snapshot = { racks: [], cells: [], products: [], stocks: [], movements: [], activities: [], documents: [] };
const productCategories = ["Пиломатериалы", "Фанера", "МДФ", "ДСП / ЛДСП", "Шпон", "Кромочные материалы", "Фурнитура", "Крепёж", "Клеи", "Лаки и краски", "Плёнка", "Упаковка", "Абразивы", "Инструмент", "Оснастка", "Электрика", "Средства защиты", "Хозматериалы", "Расходники", "Запчасти", "Готовая продукция", "Прочее"];

function ProductMark({ product }: { product: Product }) {
  if (product.imageUrl) return <img src={product.imageUrl} alt="" className="h-11 w-11 rounded-xl object-cover" />;
  return <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#eef2ec] text-[#355746]"><Boxes size={20} /></div>;
}

export default function Home() {
  const [data, setData] = useState<Snapshot>(emptyData);
  const [loading, setLoading] = useState(true);
  const [rackDialog, setRackDialog] = useState(false);
  const [editingRack, setEditingRack] = useState<Rack | null>(null);
  const [deletingRack, setDeletingRack] = useState<Rack | null>(null);
  const [productDialog, setProductDialog] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [productSku, setProductSku] = useState("");
  const [editProductSku, setEditProductSku] = useState("");
  const [editStockCell, setEditStockCell] = useState("");
  const [editStockQuantity, setEditStockQuantity] = useState("");
  const [editTransferFrom, setEditTransferFrom] = useState("");
  const [editTransferTo, setEditTransferTo] = useState("");
  const [editTransferQuantity, setEditTransferQuantity] = useState("");
  const [labelCell, setLabelCell] = useState<Cell | null>(null);
  const [activeRack, setActiveRack] = useState("");
  const [query, setQuery] = useState("");
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
      setActiveRack((current) => result.racks.some((rack) => rack.id === current) ? current : result.racks[0]?.id || "");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось загрузить данные"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void loadData(), 0); return () => window.clearTimeout(timer); }, [loadData]);

  const post = async (payload: Record<string, unknown>) => {
    const response = await fetch("/api/warehouse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const result = await response.json() as { error?: string };
    if (!response.ok) throw new Error(result.error || "Операция не выполнена");
    await loadData();
  };

  const stockByProduct = useMemo(() => {
    const totals = new Map<string, number>();
    data.stocks.forEach((row) => totals.set(row.productId, (totals.get(row.productId) || 0) + row.quantity));
    return totals;
  }, [data.stocks]);
  const occupied = new Set(data.stocks.filter((s) => s.quantity > 0).map((s) => s.cellId)).size;
  const totalUnits = data.stocks.reduce((sum, s) => sum + s.quantity, 0);
  const lowStock = data.products.filter((p) => p.minStock > 0 && (stockByProduct.get(p.id) || 0) <= p.minStock).length;
  const currentRack = data.racks.find((rack) => rack.id === activeRack) || data.racks[0];
  const rackCells = data.cells.filter((cell) => cell.rackId === currentRack?.id);
  const filteredProducts = data.products.filter((p) => `${p.name} ${p.sku} ${p.barcode} ${p.category}`.toLowerCase().includes(query.toLowerCase()));
  const pickedProduct = data.products.find((p) => p.id === selectedProduct);
  const pickedCell = data.cells.find((c) => c.id === selectedCell);
  const editingStockRows = editingProduct ? data.stocks.filter((stock) => stock.productId === editingProduct.id && stock.quantity > 0) : [];
  const editingTotal = editingStockRows.reduce((sum, stock) => sum + stock.quantity, 0);

  const beep = (success = true) => {
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx(); const oscillator = ctx.createOscillator(); const gain = ctx.createGain();
      oscillator.frequency.value = success ? 880 : 220; gain.gain.value = 0.05;
      oscillator.connect(gain); gain.connect(ctx.destination); oscillator.start(); oscillator.stop(ctx.currentTime + (success ? 0.08 : 0.2));
    } catch { /* звук необязателен */ }
  };

  const handleScan = (event: FormEvent) => {
    event.preventDefault(); const value = scan.trim().toUpperCase(); if (!value) return;
    const product = data.products.find((p) => p.barcode.toUpperCase() === value || p.sku.toUpperCase() === value);
    const cell = data.cells.find((c) => c.code.toUpperCase() === value);
    if (product) { setSelectedProduct(product.id); setQuantity(String(product.packQty || 1)); toast.success(`Товар: ${product.name}`); beep(); }
    else if (cell && !cell.blocked) { setSelectedCell(cell.id); toast.success(`Ячейка: ${cell.code}`); beep(); }
    else { toast.error("Код не найден или ячейка заблокирована"); beep(false); }
    setScan(""); scanRef.current?.focus();
  };

  const placeStock = async (payload?: { productId?: string; cellId?: string; quantity?: number; operator?: string }) => {
    const productId = payload?.productId || selectedProduct; const cellId = payload?.cellId || selectedCell; const qty = payload?.quantity ?? Number(quantity);
    if (!productId || !cellId || !Number.isFinite(qty) || qty <= 0) throw new Error("Сначала выберите товар, ячейку и количество");
    setSaving(true);
    try {
      await post({ action: "placeStock", productId, cellId, quantity: qty, operator: payload?.operator || operator, source: payload ? "webmcp" : "scanner", movementType: "Первичный учёт" });
      toast.success("Начальный остаток сохранён", { description: `${data.products.find((p) => p.id === productId)?.name} → ${data.cells.find((c) => c.id === cellId)?.code}` });
      setSelectedProduct(""); setSelectedCell(""); setQuantity("1"); beep();
    } finally { setSaving(false); }
  };

  useEffect(() => {
    const context = (document as Document & { modelContext?: { registerTool: (tool: unknown, options?: { signal?: AbortSignal }) => unknown } }).modelContext;
    if (!context?.registerTool) return; const lifecycle = new AbortController();
    context.registerTool({ name: "lookup_warehouse_stock", title: "Найти материал на складе", description: "Находит материал по названию, артикулу или штрихкоду и возвращает остаток и ячейки.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: false }, execute: (input: unknown) => { const q = String((input as { query?: string }).query || "").toLowerCase(); return data.products.filter((p) => `${p.name} ${p.sku} ${p.barcode}`.toLowerCase().includes(q)).map((p) => ({ name: p.name, sku: p.sku, quantity: stockByProduct.get(p.id) || 0, cells: data.stocks.filter((s) => s.productId === p.id).map((s) => ({ code: data.cells.find((c) => c.id === s.cellId)?.code, quantity: s.quantity })) })); } }, { signal: lifecycle.signal });
    context.registerTool({ name: "place_warehouse_stock", title: "Занести начальный остаток", description: "Записывает фактическое количество материала в выбранную ячейку склада.", inputSchema: { type: "object", properties: { productId: { type: "string" }, cellId: { type: "string" }, quantity: { type: "number", minimum: 0.001 }, operator: { type: "string" } }, required: ["productId", "cellId", "quantity"], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute: (input: unknown) => placeStock(input as { productId: string; cellId: string; quantity: number; operator?: string }) }, { signal: lifecycle.signal });
    return () => lifecycle.abort();
  }, [data, stockByProduct]);

  const createRack = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget); setSaving(true);
    try { await post({ action: "createRack", name: form.get("name"), code: form.get("code"), rows: form.get("rows"), columns: form.get("columns"), operator }); setRackDialog(false); toast.success("Стеллаж и ячейки созданы"); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Ошибка"); } finally { setSaving(false); }
  };
  const updateRack = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!editingRack) return; const form = new FormData(event.currentTarget); setSaving(true);
    try { await post({ action: "updateRack", rackId: editingRack.id, name: form.get("name"), code: form.get("code"), rows: form.get("rows"), columns: form.get("columns"), operator }); setEditingRack(null); toast.success("Стеллаж обновлён"); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Ошибка"); } finally { setSaving(false); }
  };
  const deleteRack = async () => {
    if (!deletingRack) return; setSaving(true);
    try { await post({ action: "deleteRack", rackId: deletingRack.id, operator }); setDeletingRack(null); toast.success("Стеллаж удалён"); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Ошибка"); } finally { setSaving(false); }
  };
  const createProduct = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget); setSaving(true);
    try { await post({ action: "createProduct", name: form.get("name"), sku: form.get("sku"), barcode: form.get("barcode"), category: form.get("category"), unit: form.get("unit"), packQty: form.get("packQty"), minStock: form.get("minStock"), imageUrl: form.get("imageUrl"), initialQuantity: form.get("initialQuantity"), cellId: form.get("cellId"), operator }); setProductDialog(false); setProductSku(""); toast.success("Материал создан и размещён"); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Ошибка"); } finally { setSaving(false); }
  };
  const updateProduct = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!editingProduct) return; const form = new FormData(event.currentTarget); setSaving(true);
    try { await post({ action: "updateProduct", productId: editingProduct.id, name: form.get("name"), sku: form.get("sku"), barcode: form.get("barcode"), category: form.get("category"), unit: form.get("unit"), packQty: form.get("packQty"), minStock: form.get("minStock"), imageUrl: form.get("imageUrl"), operator }); setEditingProduct(null); toast.success("Материал обновлён"); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Ошибка"); } finally { setSaving(false); }
  };
  const addProductStock = async () => {
    if (!editingProduct || !editStockCell || Number(editStockQuantity) <= 0) return toast.error("Укажите ячейку и количество");
    setSaving(true);
    try {
      await post({ action: "placeStock", productId: editingProduct.id, cellId: editStockCell,
        quantity: Number(editStockQuantity), operator, source: "material-card", movementType: "Оприходование" });
      setEditStockQuantity(""); toast.success("Остаток добавлен в ячейку");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось добавить остаток"); }
    finally { setSaving(false); }
  };
  const moveProductStock = async () => {
    if (!editingProduct || !editTransferFrom || !editTransferTo || Number(editTransferQuantity) <= 0) return toast.error("Укажите обе ячейки и количество");
    setSaving(true);
    try {
      await post({ action: "transferStock", productId: editingProduct.id, fromCellId: editTransferFrom,
        toCellId: editTransferTo, quantity: Number(editTransferQuantity), operator });
      setEditTransferFrom(""); setEditTransferTo(""); setEditTransferQuantity("");
      toast.success("Материал перемещён в новую ячейку");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось переместить материал"); }
    finally { setSaving(false); }
  };
  const generateSku = async (setter: (value: string) => void) => {
    try {
      const response = await fetch("/api/warehouse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "generateSku", operator }) });
      const result = await response.json() as { sku?: string; error?: string };
      if (!response.ok || !result.sku) throw new Error(result.error || "Не удалось создать артикул");
      setter(result.sku);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось создать артикул"); }
  };

  return (
    <main className="min-h-screen text-[var(--foreground)]">
      <header className="app-header sticky top-0 z-30"><div className="mx-auto flex h-17 max-w-[1500px] items-center justify-between px-4 sm:px-7"><div className="flex items-center gap-3"><div className="brand-mark"><TreePine size={22} /></div><div><div className="text-[15px] font-extrabold tracking-tight">РУССКИЙ ЛЕС · СКЛАД</div><div className="text-xs text-[var(--muted-foreground)]">Адресный учёт материалов</div></div></div><Button className="accent-button" onClick={() => setProductDialog(true)}><Plus /> Материал</Button></div></header>
      <Tabs defaultValue="scan" className="mx-auto max-w-[1500px] px-4 py-5 sm:px-7 sm:py-7">
        <TabsList className="glass-tabs mb-5 h-auto w-full justify-start gap-1 overflow-x-auto rounded-2xl p-1.5"><TabsTrigger value="scan" className="px-3 py-2"><ListChecks /> Первичный учёт</TabsTrigger><TabsTrigger value="receipt" className="px-3 py-2"><ArrowDownToLine /> Приёмка</TabsTrigger><TabsTrigger value="transfer" className="px-3 py-2"><ArrowRightLeft /> Перемещение</TabsTrigger><TabsTrigger value="issue" className="px-3 py-2"><ArrowUpFromLine /> Выдача</TabsTrigger><TabsTrigger value="layout" className="px-3 py-2"><Grid3X3 /> Стеллажи</TabsTrigger><TabsTrigger value="products" className="px-3 py-2"><Boxes /> Материалы</TabsTrigger><TabsTrigger value="labels" className="px-3 py-2"><QrCode /> Этикетки</TabsTrigger><TabsTrigger value="history" className="px-3 py-2"><History /> Движения</TabsTrigger><TabsTrigger value="activity" className="px-3 py-2"><Activity /> Журнал</TabsTrigger><TabsTrigger value="install" className="px-3 py-2"><Smartphone /> Установка</TabsTrigger></TabsList>
        <TabsContent value="scan" className="space-y-5">
          <InitialInventoryGuide racks={data.racks.length} products={data.products.length} stocked={occupied} />
          <section className="grid gap-4 md:grid-cols-4">{[{ label: "Материалов", value: data.products.length, icon: Boxes }, { label: "Всего на складе", value: totalUnits.toLocaleString("ru-RU"), icon: Archive }, { label: "Занято ячеек", value: occupied, icon: MapPin }, { label: "Низкий остаток", value: lowStock, icon: ClipboardList }].map((item) => <div key={item.label} className="metric-card"><div><p>{item.label}</p><strong>{item.value}</strong></div><item.icon /></div>)}</section>
          <section className="grid gap-5 xl:grid-cols-[1.08fr_.92fr]">
            <div className="scan-console overflow-hidden rounded-3xl text-white"><div className="flex items-start justify-between border-b border-white/12 p-5 sm:p-7"><div><div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[.12em] text-blue-200"><ListChecks size={14} /> Первичный учёт</div><h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Посчитайте то, что реально лежит</h1><p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">Сначала отсканируйте внутреннюю этикетку материала, затем QR ячейки и введите фактическое количество.</p></div><ScanLine className="hidden text-orange-400 sm:block" size={40} /></div><form onSubmit={handleScan} className="p-5 sm:p-7"><Label htmlFor="scan" className="mb-2 block text-slate-200">Поле сканера</Label><div className="flex gap-2"><div className="relative flex-1"><QrCode className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" /><Input ref={scanRef} id="scan" autoFocus value={scan} onChange={(e) => setScan(e.target.value)} placeholder="Отсканируйте этикетку товара или QR ячейки" className="h-14 border-0 bg-white/95 pl-12 text-base text-slate-900 placeholder:text-slate-400" /></div><Button type="submit" className="accent-button h-14 px-5">Принять</Button></div></form><div className="grid border-t border-white/12 sm:grid-cols-2"><div className="scan-result"><span>01 · Материал</span>{pickedProduct ? <div className="mt-3 flex items-center gap-3"><ProductMark product={pickedProduct} /><div><b>{pickedProduct.name}</b><p>{pickedProduct.sku} · {pickedProduct.unit}</p></div></div> : <p className="mt-2 text-slate-400">Сначала отсканируйте товар</p>}</div><div className="scan-result border-t border-white/12 sm:border-l sm:border-t-0"><span>02 · Место хранения</span>{pickedCell ? <div className="mt-3"><b className="text-lg">{pickedCell.code}</b><p>Ячейка выбрана</p></div> : <p className="mt-2 text-slate-400">Затем отсканируйте ячейку</p>}</div></div></div>
            <div className="panel flex flex-col justify-between p-5 sm:p-7"><div><div className="panel-title"><div><span>03 · Количество</span><h2>Сохраните начальный остаток</h2></div><PackagePlus /></div><p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">Введите результат пересчёта. Если материал лежит в нескольких ячейках — сохраните каждую ячейку отдельно.</p><div className="mt-7 space-y-5"><div><Label htmlFor="qty">Фактическое количество</Label><div className="mt-2 grid grid-cols-[1fr_auto_auto] gap-2"><Input id="qty" type="number" min="0.001" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="h-12 text-lg font-semibold" /><Button type="button" variant="outline" className="h-12" onClick={() => setQuantity(String(Number(quantity || 0) + 1))}>+1</Button><Button type="button" variant="outline" className="h-12" disabled={!pickedProduct} onClick={() => setQuantity(String(Number(quantity || 0) + (pickedProduct?.packQty || 1)))}>+ упаковка</Button></div></div><div><Label htmlFor="operator">Кто пересчитал</Label><Input id="operator" value={operator} onChange={(e) => setOperator(e.target.value)} className="mt-2 h-11" /></div></div></div><Button disabled={saving || !pickedProduct || !pickedCell} onClick={() => void placeStock().catch((e) => toast.error(e.message))} className="accent-button mt-7 h-13 w-full text-base">{saving ? <Loader2 className="animate-spin" /> : <PackagePlus />} Сохранить остаток</Button></div>
          </section>
          <section className="panel p-5 sm:p-7"><div className="panel-title"><div><span>Последние операции</span><h2>Что происходило на складе</h2></div><History /></div><MovementTable movements={data.movements.slice(0, 6)} /></section>
        </TabsContent>
        <WarehouseWorkflows products={data.products} cells={data.cells} stocks={data.stocks} documents={data.documents} operator={operator} setOperator={setOperator} reload={loadData} />
        <ProductLabels products={data.products} />
        <TabsContent value="layout" className="space-y-5"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="eyebrow">Адресное хранение</p><h1 className="page-title">Стеллажи и ячейки</h1><p className="page-description">Выберите стеллаж, чтобы увидеть занятость каждой ячейки.</p></div><Button onClick={() => setRackDialog(true)} className="bg-[#173f2b] text-white hover:bg-[#24583d]"><Plus /> Создать стеллаж</Button></div>{data.racks.length === 0 ? <EmptyState icon={Grid3X3} title="Стеллажей пока нет" text="Создайте первый стеллаж — система сама построит полки и присвоит QR-коды ячейкам." action={() => setRackDialog(true)} actionLabel="Создать стеллаж" /> : <div className="grid gap-5 lg:grid-cols-[280px_1fr]"><aside className="panel h-fit p-3">{data.racks.map((rack) => <button key={rack.id} onClick={() => setActiveRack(rack.id)} className={`rack-link ${currentRack?.id === rack.id ? "active" : ""}`}><div><b>{rack.name}</b><span>{rack.code} · {rack.rows}×{rack.columns}</span></div><ChevronRight /></button>)}</aside><RackBlueprint rack={currentRack!} cells={rackCells} stocks={data.stocks} products={data.products} onLabel={setLabelCell} onEdit={setEditingRack} onDelete={setDeletingRack} /></div>}</TabsContent>
        <TabsContent value="products" className="space-y-5"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="eyebrow">Номенклатура</p><h1 className="page-title">Материалы</h1><p className="page-description">Все материалы склада. Любое изменение сохраняется в журнале.</p></div><Button onClick={() => setProductDialog(true)} className="accent-button"><Plus /> Добавить материал</Button></div><div className="panel overflow-hidden"><div className="border-b border-black/7 p-4"><div className="relative max-w-lg"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#7d8981]" size={18} /><Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Название, артикул, штрихкод или категория" className="pl-10" /></div></div><Table><TableHeader><TableRow><TableHead>Материал</TableHead><TableHead>Категория</TableHead><TableHead>Штрихкод</TableHead><TableHead>Расположение</TableHead><TableHead className="text-right">Остаток</TableHead><TableHead className="w-16"><span className="sr-only">Действия</span></TableHead></TableRow></TableHeader><TableBody>{filteredProducts.map((product) => { const rows = data.stocks.filter((s) => s.productId === product.id && s.quantity > 0); return <TableRow key={product.id}><TableCell><div className="flex items-center gap-3"><ProductMark product={product} /><div><b>{product.name}</b><div className="text-xs text-[#7a877f]">{product.sku}</div></div></div></TableCell><TableCell>{product.category}</TableCell><TableCell className="font-mono text-xs">{product.barcode}</TableCell><TableCell>{rows.length ? rows.map((r) => `${data.cells.find((c) => c.id === r.cellId)?.code} · ${r.quantity.toLocaleString("ru-RU")}`).join(", ") : "Не размещён"}</TableCell><TableCell className="text-right text-base font-bold">{(stockByProduct.get(product.id) || 0).toLocaleString("ru-RU")} <span className="text-xs font-normal text-[#7a877f]">{product.unit}</span></TableCell><TableCell><Button variant="outline" size="icon-sm" aria-label={`Открыть ${product.name}`} onClick={() => { setEditingProduct(product); setEditProductSku(product.sku); setEditStockCell(""); setEditStockQuantity(""); setEditTransferFrom(""); setEditTransferTo(""); setEditTransferQuantity(""); }}><Pencil /></Button></TableCell></TableRow>; })}</TableBody></Table>{!loading && !filteredProducts.length && <div className="p-10 text-center text-[#748078]">Материалов пока нет</div>}</div></TabsContent>
        <TabsContent value="history" className="space-y-5"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="eyebrow">Контроль операций</p><h1 className="page-title">История движений</h1><p className="page-description">Приходы, перемещения и выдачи: дата, ячейка, количество и кладовщик.</p></div><Button asChild variant="outline"><a href="/api/warehouse/export"><Download /> Скачать Excel</a></Button></div><div className="panel overflow-hidden p-5 sm:p-7"><MovementTable movements={data.movements} /></div></TabsContent>
        <TabsContent value="activity" className="space-y-5"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="eyebrow">Ответственность</p><h1 className="page-title">Журнал изменений</h1><p className="page-description">Кто, когда и какие данные создавал или редактировал.</p></div><Button asChild variant="outline"><a href="/api/warehouse/export?type=activity"><Download /> Скачать Excel</a></Button></div><div className="panel overflow-x-auto p-5 sm:p-7"><ActivityTable activities={data.activities} /></div></TabsContent>
        <InstallGuide />
      </Tabs>
      <Dialog open={rackDialog} onOpenChange={setRackDialog}><DialogContent><form onSubmit={createRack}><DialogHeader><DialogTitle>Новый стеллаж</DialogTitle><DialogDescription>Укажите число полок и мест на каждой. Например: стеллаж A, полка 2, ячейка A2A.</DialogDescription></DialogHeader><div className="form-grid"><div className="sm:col-span-2"><Label>Название стеллажа</Label><Input name="name" required placeholder="Например, Основной стеллаж" /></div><div className="sm:col-span-2"><Label>Код стеллажа</Label><Input name="code" required placeholder="A" /><p className="field-hint">Короткий код используется в адресах ячеек: A1A, A1B, A2A.</p></div><div><Label>Количество полок</Label><Input name="rows" type="number" min="1" max="12" defaultValue="4" required /><p className="field-hint">Горизонтальные уровни снизу вверх.</p></div><div><Label>Ячеек на каждой полке</Label><Input name="columns" type="number" min="1" max="12" defaultValue="4" required /><p className="field-hint">Места слева направо: A, B, C…</p></div></div><DialogFooter className="mt-6"><Button type="button" variant="outline" onClick={() => setRackDialog(false)}>Отмена</Button><Button disabled={saving} className="accent-button">Создать стеллаж</Button></DialogFooter></form></DialogContent></Dialog>
      <Dialog open={productDialog} onOpenChange={setProductDialog}><DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl"><form onSubmit={createProduct}>
        <DialogHeader><DialogTitle>Новый материал и начальный остаток</DialogTitle><DialogDescription>Создайте материал, укажите фактическое количество и сразу закрепите его за конкретной ячейкой.</DialogDescription></DialogHeader>
        <div className="form-grid"><div className="sm:col-span-2"><Label>Название *</Label><Input name="name" required placeholder="Плёнка ПВХ белая" /></div><div><Label>Артикул</Label><div className="mt-2 flex gap-2"><Input name="sku" value={productSku} onChange={(event) => setProductSku(event.target.value.toUpperCase())} placeholder="Введите или создайте" /><Button type="button" variant="outline" aria-label="Сгенерировать артикул" onClick={() => void generateSku(setProductSku)}><RefreshCw /> Создать</Button></div><p className="field-hint">Можно указать свой артикул или создать уникальный автоматически.</p></div><div><Label>Заводской штрихкод</Label><Input name="barcode" placeholder="Можно оставить пустым" /></div><div><Label>Категория</Label><NativeSelect name="category" className="w-full">{productCategories.map((category) => <NativeSelectOption key={category}>{category}</NativeSelectOption>)}</NativeSelect></div><div><Label>Единица</Label><NativeSelect name="unit" className="w-full"><NativeSelectOption>шт.</NativeSelectOption><NativeSelectOption>компл.</NativeSelectOption><NativeSelectOption>упак.</NativeSelectOption><NativeSelectOption>лист</NativeSelectOption><NativeSelectOption>рулон</NativeSelectOption><NativeSelectOption>м</NativeSelectOption><NativeSelectOption>м²</NativeSelectOption><NativeSelectOption>м³</NativeSelectOption><NativeSelectOption>кг</NativeSelectOption><NativeSelectOption>л</NativeSelectOption></NativeSelect></div><div><Label>В одной упаковке</Label><Input name="packQty" type="number" min="0.001" step="any" defaultValue="1" /></div><div><Label>Минимальный остаток</Label><Input name="minStock" type="number" min="0" step="any" defaultValue="0" /><p className="field-hint">Это порог предупреждения, а не фактическое количество.</p></div><div><Label>Фактическое количество *</Label><Input name="initialQuantity" type="number" min="0.001" step="any" required placeholder="Например, 500" /><p className="field-hint">Сколько материала реально принято на склад.</p></div><div><Label>Ячейка хранения *</Label><NativeSelect name="cellId" required className="w-full"><NativeSelectOption value="">Выберите стеллаж, полку и ячейку</NativeSelectOption>{data.cells.filter((cell) => !cell.blocked).map((cell) => <NativeSelectOption key={cell.id} value={cell.id}>{cell.code}</NativeSelectOption>)}</NativeSelect><p className="field-hint">Например: A2A — стеллаж A, полка 2, место A.</p></div><div className="sm:col-span-2"><Label>Ссылка на фотографию</Label><Input name="imageUrl" type="url" placeholder="https://... (необязательно)" /></div></div>
        {!data.cells.length && <p className="mt-4 rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800">Сначала создайте хотя бы один стеллаж и ячейку.</p>}
        <DialogFooter className="mt-6"><Button type="button" variant="outline" onClick={() => setProductDialog(false)}>Отмена</Button><Button disabled={saving || !data.cells.length} className="accent-button">Создать и разместить</Button></DialogFooter>
      </form></DialogContent></Dialog>
      <Dialog open={!!editingProduct} onOpenChange={(open) => !open && setEditingProduct(null)}>
        <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-3xl">
          {editingProduct && <form key={editingProduct.id} onSubmit={updateProduct}>
            <DialogHeader><DialogTitle>Материал: данные и остатки</DialogTitle><DialogDescription>Здесь можно изменить карточку, оприходовать товар и переместить его между ячейками.</DialogDescription></DialogHeader>
            <section className="mt-5 rounded-2xl border border-blue-200/70 bg-blue-50/70 p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm text-slate-500">Фактический остаток</p><strong className="text-3xl">{editingTotal.toLocaleString("ru-RU")} <span className="text-base font-medium text-slate-500">{editingProduct.unit}</span></strong></div><div className="text-right"><p className="text-sm text-slate-500">Расположение</p><b>{editingStockRows.length ? `${editingStockRows.length} яч.` : "Не размещён"}</b></div></div>
              <div className="mt-4 flex flex-wrap gap-2">{editingStockRows.length ? editingStockRows.map((stock) => <span key={stock.cellId} className="rounded-full border border-blue-200 bg-white px-3 py-1.5 text-sm font-semibold">{data.cells.find((cell) => cell.id === stock.cellId)?.code} · {stock.quantity.toLocaleString("ru-RU")} {editingProduct.unit}</span>) : <span className="text-sm text-slate-600">Оприходуйте материал в нужную ячейку ниже.</span>}</div>
            </section>
            <div className="mt-6 form-grid"><div className="sm:col-span-2"><Label>Название</Label><Input name="name" required defaultValue={editingProduct.name} /></div><div><Label>Артикул</Label><div className="mt-2 flex gap-2"><Input name="sku" value={editProductSku} onChange={(event) => setEditProductSku(event.target.value.toUpperCase())} required /><Button type="button" variant="outline" aria-label="Сгенерировать новый артикул" onClick={() => void generateSku(setEditProductSku)}><RefreshCw /></Button></div></div><div><Label>Штрихкод</Label><Input name="barcode" defaultValue={editingProduct.barcode} /></div><div><Label>Категория</Label><NativeSelect name="category" defaultValue={editingProduct.category} className="w-full">{productCategories.map((category) => <NativeSelectOption key={category}>{category}</NativeSelectOption>)}</NativeSelect></div><div><Label>Единица</Label><NativeSelect name="unit" defaultValue={editingProduct.unit} className="w-full"><NativeSelectOption>шт.</NativeSelectOption><NativeSelectOption>компл.</NativeSelectOption><NativeSelectOption>упак.</NativeSelectOption><NativeSelectOption>лист</NativeSelectOption><NativeSelectOption>рулон</NativeSelectOption><NativeSelectOption>м</NativeSelectOption><NativeSelectOption>м²</NativeSelectOption><NativeSelectOption>м³</NativeSelectOption><NativeSelectOption>кг</NativeSelectOption><NativeSelectOption>л</NativeSelectOption></NativeSelect></div><div><Label>В одной упаковке</Label><Input name="packQty" type="number" min="0.001" step="any" defaultValue={editingProduct.packQty} /><p className="field-hint">Размер упаковки не является остатком.</p></div><div><Label>Минимальный остаток</Label><Input name="minStock" type="number" min="0" step="any" defaultValue={editingProduct.minStock} /><p className="field-hint">Это порог предупреждения, а не количество.</p></div><div className="sm:col-span-2"><Label>Ссылка на фотографию</Label><Input name="imageUrl" type="url" defaultValue={editingProduct.imageUrl} /></div></div>
            <section className="mt-6 rounded-2xl border border-black/10 bg-white/60 p-4 sm:p-5"><div className="flex items-center gap-2"><PackagePlus size={20} /><h3 className="font-bold">Добавить фактический остаток</h3></div><p className="mt-1 text-sm text-slate-500">Используйте для уже созданного товара с нулевым остатком или нового прихода без документа.</p><div className="mt-4 grid gap-3 sm:grid-cols-[1fr_180px_auto]"><NativeSelect value={editStockCell} onChange={(event) => setEditStockCell(event.target.value)} className="w-full"><NativeSelectOption value="">Выберите ячейку</NativeSelectOption>{data.cells.filter((cell) => !cell.blocked).map((cell) => <NativeSelectOption key={cell.id} value={cell.id}>{cell.code}</NativeSelectOption>)}</NativeSelect><Input type="number" min="0.001" step="any" value={editStockQuantity} onChange={(event) => setEditStockQuantity(event.target.value)} placeholder="Количество" /><Button type="button" disabled={saving || !editStockCell || Number(editStockQuantity) <= 0} onClick={() => void addProductStock()} className="accent-button"><PackagePlus /> Оприходовать</Button></div></section>
            <section className="mt-4 rounded-2xl border border-black/10 bg-white/60 p-4 sm:p-5"><div className="flex items-center gap-2"><ArrowRightLeft size={20} /><h3 className="font-bold">Переместить между ячейками</h3></div><p className="mt-1 text-sm text-slate-500">Выберите, откуда забрать, куда положить и сколько единиц перенести.</p><div className="mt-4 grid gap-3 sm:grid-cols-2"><div><Label>Из ячейки</Label><NativeSelect value={editTransferFrom} onChange={(event) => { setEditTransferFrom(event.target.value); setEditTransferTo(""); }} className="w-full"><NativeSelectOption value="">Текущее место</NativeSelectOption>{editingStockRows.map((stock) => <NativeSelectOption key={stock.cellId} value={stock.cellId}>{data.cells.find((cell) => cell.id === stock.cellId)?.code} · доступно {stock.quantity}</NativeSelectOption>)}</NativeSelect></div><div><Label>В ячейку</Label><NativeSelect value={editTransferTo} onChange={(event) => setEditTransferTo(event.target.value)} className="w-full"><NativeSelectOption value="">Новое место</NativeSelectOption>{data.cells.filter((cell) => !cell.blocked && cell.id !== editTransferFrom).map((cell) => <NativeSelectOption key={cell.id} value={cell.id}>{cell.code}</NativeSelectOption>)}</NativeSelect></div><div><Label>Сколько переместить</Label><Input type="number" min="0.001" step="any" value={editTransferQuantity} onChange={(event) => setEditTransferQuantity(event.target.value)} placeholder="Количество" /></div><div className="flex items-end"><Button type="button" disabled={saving || !editTransferFrom || !editTransferTo || Number(editTransferQuantity) <= 0} onClick={() => void moveProductStock()} className="h-10 w-full"><ArrowRightLeft /> Переместить</Button></div></div>{!editingStockRows.length && <p className="mt-3 text-sm text-orange-700">Сначала добавьте фактический остаток в любую ячейку.</p>}</section>
            <DialogFooter className="mt-6"><Button type="button" variant="outline" onClick={() => setEditingProduct(null)}>Закрыть</Button><Button disabled={saving} className="accent-button">Сохранить данные материала</Button></DialogFooter>
          </form>}
        </DialogContent>
      </Dialog>
      <Dialog open={!!labelCell} onOpenChange={(open) => !open && setLabelCell(null)}><DialogContent className="qr-print-dialog sm:max-w-sm"><DialogHeader className="no-print"><DialogTitle>Этикетка ячейки</DialogTitle><DialogDescription>QR-код будет напечатан ровно по центру листа.</DialogDescription></DialogHeader>{labelCell && <div className="qr-print-sheet"><div className="label-card"><QRCodeSVG value={labelCell.code} size={190} level="M" /><strong>{labelCell.code}</strong><span>РУССКИЙ ЛЕС · СКЛАД</span></div></div>}<DialogFooter className="no-print"><Button variant="outline" onClick={() => window.print()}><Printer /> Печать QR-кода</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={!!editingRack} onOpenChange={(open) => !open && setEditingRack(null)}>
        <DialogContent>
          {editingRack && <form key={editingRack.id} onSubmit={updateRack}>
            <DialogHeader><DialogTitle>Редактировать стеллаж</DialogTitle><DialogDescription>Название и код можно менять. Размеры занятого стеллажа защищены от изменения.</DialogDescription></DialogHeader>
            <div className="form-grid">
              <div className="sm:col-span-2"><Label>Название</Label><Input name="name" required defaultValue={editingRack.name} /></div>
              <div className="sm:col-span-2"><Label>Код стеллажа</Label><Input name="code" required defaultValue={editingRack.code} /></div>
              <div><Label>Количество полок</Label><Input name="rows" type="number" min="1" max="12" required defaultValue={editingRack.rows} /></div>
              <div><Label>Ячеек на полке</Label><Input name="columns" type="number" min="1" max="12" required defaultValue={editingRack.columns} /></div>
            </div>
            <DialogFooter className="mt-6"><Button type="button" variant="outline" onClick={() => setEditingRack(null)}>Отмена</Button><Button disabled={saving} className="bg-[#173f2b] text-white">Сохранить</Button></DialogFooter>
          </form>}
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!deletingRack} onOpenChange={(open) => !open && setDeletingRack(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Удалить стеллаж?</AlertDialogTitle><AlertDialogDescription>{deletingRack ? `${deletingRack.name} (${deletingRack.code}) будет убран из рабочего списка. Удаление возможно только при нулевых остатках.` : ""}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Отмена</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={saving} onClick={(event) => { event.preventDefault(); void deleteRack(); }}><Trash2 /> Удалить</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

function RackBlueprint({ rack, cells, stocks, products, onLabel, onEdit, onDelete }: { rack: Rack; cells: Cell[]; stocks: Stock[]; products: Product[]; onLabel: (cell: Cell) => void; onEdit: (rack: Rack) => void; onDelete: (rack: Rack) => void }) {
  const shelves = Array.from({ length: rack.rows }, (_, index) => rack.rows - index - 1);
  return <section className="panel overflow-hidden"><div className="flex flex-col justify-between gap-3 border-b border-black/7 p-5 sm:flex-row sm:items-center sm:p-6"><div><p className="eyebrow">Стеллаж {rack.code}</p><h2 className="text-xl font-bold">{rack.name}</h2><p className="mt-1 text-sm text-slate-500">{rack.rows} полок · {rack.columns} ячеек на каждой</p></div><div className="flex flex-wrap items-center gap-2"><div className="mr-2 flex gap-4 text-xs text-[#6f7c74]"><span><i className="legend occupied" /> Занято</span><span><i className="legend" /> Свободно</span></div><Button variant="outline" size="sm" onClick={() => onEdit(rack)}><Pencil /> Изменить</Button><Button variant="outline" size="sm" className="text-red-700 hover:bg-red-50 hover:text-red-800" onClick={() => onDelete(rack)}><Trash2 /> Удалить</Button></div></div><div className="overflow-x-auto p-5 sm:p-8"><div className="rack-3d"><div className="rack-top"><Layers3 size={18} /> СТЕЛЛАЖ {rack.code}</div>{shelves.map((rowIndex) => <div className="rack-shelf" key={rowIndex}><div className="shelf-label"><span>ПОЛКА</span><b>{rowIndex + 1}</b></div><div className="shelf-cells" style={{ gridTemplateColumns: `repeat(${rack.columns}, minmax(118px, 1fr))` }}>{cells.filter((cell) => cell.rowIndex === rowIndex).sort((a, b) => a.columnIndex - b.columnIndex).map((cell) => { const cellStocks = stocks.filter((s) => s.cellId === cell.id && s.quantity > 0); const address = `${rack.code}${rowIndex + 1}${String.fromCharCode(65 + cell.columnIndex)}`; return <button key={cell.id} onClick={() => onLabel({ ...cell, code: address, label: address })} className={`cell ${cellStocks.length ? "has-stock" : ""} ${cell.blocked ? "blocked" : ""}`}><div className="flex items-start justify-between"><div><span className="cell-caption">Ячейка</span><b>{address}</b></div><QrCode size={16} /></div>{cellStocks.length ? <div className="mt-4 space-y-1">{cellStocks.slice(0, 2).map((stock) => <div key={stock.productId}><span>{products.find((p) => p.id === stock.productId)?.name || "Материал"}</span><strong>{stock.quantity.toLocaleString("ru-RU")}</strong></div>)}</div> : <span className="cell-empty">Свободно</span>}<small>Полка {rowIndex + 1} · место {String.fromCharCode(65 + cell.columnIndex)}</small></button>; })}</div></div>)}<div className="rack-base" /></div></div></section>;
}
function MovementTable({ movements }: { movements: Movement[] }) {
  if (!movements.length) return <div className="py-10 text-center text-sm text-[#748078]">Операций пока нет</div>;
  return <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Время</TableHead><TableHead>Операция</TableHead><TableHead>Документ</TableHead><TableHead>Материал</TableHead><TableHead>Ячейка</TableHead><TableHead>Маршрут / получатель</TableHead><TableHead>Кладовщик</TableHead><TableHead className="text-right">Количество</TableHead></TableRow></TableHeader><TableBody>{movements.map((m) => <TableRow key={m.id}><TableCell className="whitespace-nowrap text-[#748078]">{new Date(m.createdAt.replace(" ", "T") + "Z").toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</TableCell><TableCell><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${m.quantity < 0 ? "bg-[#fce9e3] text-[#a44725]" : "bg-[#e5f2e8] text-[#2d6a42]"}`}>{m.type}</span></TableCell><TableCell className="whitespace-nowrap font-mono text-xs">{m.documentNumber || "—"}</TableCell><TableCell className="min-w-44 font-semibold">{m.productName}</TableCell><TableCell className="font-mono text-xs">{m.cellCode}</TableCell><TableCell className="min-w-48">{m.recipient || m.comment || "—"}</TableCell><TableCell>{m.operator}</TableCell><TableCell className={`text-right font-bold ${m.quantity < 0 ? "text-[#b14c27]" : "text-[#2d6a42]"}`}>{m.quantity > 0 ? "+" : "−"}{Math.abs(m.quantity).toLocaleString("ru-RU")} {m.productUnit}</TableCell></TableRow>)}</TableBody></Table></div>;
}
function ActivityTable({ activities }: { activities: ActivityLog[] }) {
  if (!activities.length) return <div className="py-10 text-center text-sm text-[#748078]">Действий пока нет</div>;
  return <Table><TableHeader><TableRow><TableHead>Время</TableHead><TableHead>Действие</TableHead><TableHead>Объект</TableHead><TableHead>Подробности</TableHead><TableHead>Пользователь</TableHead></TableRow></TableHeader><TableBody>{activities.map((item) => <TableRow key={item.id}><TableCell className="whitespace-nowrap text-[#748078]">{new Date(item.createdAt.replace(" ", "T") + "Z").toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</TableCell><TableCell><span className="rounded-full bg-[#e7eee9] px-2.5 py-1 text-xs font-semibold text-[#315840]">{item.action}</span></TableCell><TableCell><div className="font-semibold">{item.entityName}</div><div className="text-xs text-[#7a877f]">{item.entityType}</div></TableCell><TableCell className="max-w-md text-[#58645c]">{item.details || "—"}</TableCell><TableCell>{item.operator}</TableCell></TableRow>)}</TableBody></Table>;
}
function EmptyState({ icon: Icon, title, text, action, actionLabel }: { icon: typeof Settings2; title: string; text: string; action: () => void; actionLabel: string }) {
  return <div className="panel flex min-h-[420px] flex-col items-center justify-center p-8 text-center"><div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#e7eee9] text-[#315840]"><Icon size={28} /></div><h2 className="text-xl font-bold">{title}</h2><p className="mt-2 max-w-md text-sm leading-6 text-[#6d7971]">{text}</p><Button onClick={action} className="mt-6 bg-[#173f2b] text-white"><Plus /> {actionLabel}</Button></div>;
}
