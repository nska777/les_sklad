"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import * as XLSX from "xlsx";
import {
  ArrowDownToLine, ArrowRightLeft, ArrowUpFromLine, Boxes, ClipboardList, FileSpreadsheet,
  History, Layers3, Loader2, MapPin, PackagePlus, PaintBucket, Plus, RefreshCw, Search,
  ShieldAlert, Trash2, TreePine, X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Rack = { id: string; name: string; code: string; rows: number; columns: number; storageType: string; width: number; depth: number };
type Cell = { id: string; rackId: string; code: string; label: string; blocked: boolean };
type Product = { id: string; name: string; sku: string; barcode: string; category: string; subcategory: string; brand: string; color: string; ral: string; unit: string; packType: string; packSize: number; imageUrl: string; minStock: number; comment: string; oneCId?: string | null; createdBy: string; source: string; createdAt: string };
type Stock = { productId: string; cellId: string; quantity: number };
type Movement = { id: string; type: string; productId: string; productName: string; productSku: string; productUnit: string; fromCellCode: string; toCellCode: string; quantity: number; recipient: string; comment: string; operator: string; documentNumber: string; sourceName: string; sourceLocation: string; batchId: string; createdAt: string };
type Mix = { id: string; name: string; recipient: string; documentNumber: string; resultQuantity: number; resultUnit: string; operator: string; createdAt: string; lines: Array<{ id: string; productId: string; productName: string; cellCode: string; quantity: number; unit: string }> };
type Inventory = { id: string; createdBy: string; createdAt: string; snapshotJson: string };
type Snapshot = { warehouse: { code: string; name: string }; racks: Rack[]; cells: Cell[]; products: Product[]; stocks: Stock[]; movements: Movement[]; mixes: Mix[]; inventories: Inventory[] };

type MixLineDraft = { productId: string; cellId: string; quantity: string };
const emptyData: Snapshot = { warehouse: { code: "paint", name: "Склад краски" }, racks: [], cells: [], products: [], stocks: [], movements: [], mixes: [], inventories: [] };
const fmt = (v: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(v);
const dateFmt = (v: string) => new Date(v).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
const units = ["кг", "г", "л", "мл", "шт."];
const packTypes = ["ведро", "банка", "канистра", "бутылка", "бочка", "мешок", "коробка", "без тары"];

export default function WarehouseFullUi() {
  const params = useParams<{ warehouse: string }>();
  const warehouseCode = String(params?.warehouse || "paint");
  const [data, setData] = useState<Snapshot>(emptyData);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [oneCOpen, setOneCOpen] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const response = await fetch("/api/department-warehouse", { cache: "no-store" });
      const body = await response.json() as Snapshot & { error?: string };
      if (!response.ok) throw new Error(body.error || "Не удалось загрузить склад");
      setData(body);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось загрузить склад"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void loadData(); }, [loadData]);

  const post = async (payload: Record<string, unknown>, success?: string) => {
    setSaving(true);
    try {
      const response = await fetch("/api/department-warehouse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json() as Record<string, unknown> & { error?: string };
      if (!response.ok) throw new Error(body.error || "Операция не выполнена");
      if (success) toast.success(success);
      await loadData();
      return body;
    } catch (error) { toast.error(error instanceof Error ? error.message : "Операция не выполнена"); throw error; }
    finally { setSaving(false); }
  };

  const stockByProduct = useMemo(() => {
    const map = new Map<string, number>();
    data.stocks.forEach((s) => map.set(s.productId, (map.get(s.productId) || 0) + Number(s.quantity)));
    return map;
  }, [data.stocks]);
  const cellById = useMemo(() => new Map(data.cells.map((c) => [c.id, c])), [data.cells]);
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return !q ? data.products : data.products.filter((p) => `${p.name} ${p.sku} ${p.barcode} ${p.category} ${p.brand} ${p.color} ${p.ral}`.toLowerCase().includes(q));
  }, [data.products, search]);

  const total = data.stocks.reduce((s, x) => s + Number(x.quantity), 0);
  const occupied = new Set(data.stocks.filter((x) => Number(x.quantity) > 0).map((x) => x.cellId)).size;
  const low = data.products.filter((p) => p.minStock > 0 && (stockByProduct.get(p.id) || 0) <= p.minStock).length;

  if (loading) return <main className="flex min-h-screen items-center justify-center"><Loader2 className="animate-spin text-orange-500" size={36} /></main>;

  const importFromOneC = async (items: Array<Record<string, unknown>>) => {
    const result = await post({ action: "bulkImportProducts", items });
    toast.success(`1С: добавлено ${Number(result.created || 0)}, обновлено ${Number(result.updated || 0)}`);
  };

  return <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,.98),rgba(244,246,241,.92)_42%,rgba(236,239,232,.98)_100%)] text-[var(--foreground)]">
    <header className="app-header sticky top-0 z-30"><div className="mx-auto flex min-h-17 max-w-[1600px] items-center justify-between gap-3 px-4 py-3 sm:px-7">
      <div className="flex items-center gap-3"><div className="brand-mark"><TreePine size={22}/></div><div><b>РУССКИЙ ЛЕС · RL СКЛАД</b><div className="flex items-center gap-1.5 text-xs text-slate-500"><PaintBucket size={13}/> {data.warehouse.name}</div></div></div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setOneCOpen(true)}><FileSpreadsheet size={15}/> Материалы из 1С</Button>
        <Button variant="outline" size="sm" onClick={() => void loadData()}><RefreshCw size={15}/> Обновить</Button>
      </div>
    </div></header>

    <div className="mx-auto max-w-[1600px] space-y-5 px-4 py-5 sm:px-7 sm:py-7">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Материалов" value={data.products.length} icon={Boxes}/>
        <Metric label="Общий учётный остаток" value={fmt(total)} icon={PackagePlus}/>
        <Metric label="Занято мест" value={occupied} icon={MapPin}/>
        <Metric label="Низкий остаток" value={low} icon={ShieldAlert}/>
      </section>

      <Tabs defaultValue="materials" className="space-y-5">
        <TabsList className="glass-tabs h-auto w-full justify-start gap-1 overflow-x-auto rounded-2xl p-1.5">
          <TabsTrigger value="materials"><Boxes/> Материалы</TabsTrigger>
          <TabsTrigger value="storage"><Layers3/> Склад</TabsTrigger>
          <TabsTrigger value="receipt"><ArrowDownToLine/> Приход</TabsTrigger>
          <TabsTrigger value="transfer"><ArrowRightLeft/> Перемещение</TabsTrigger>
          <TabsTrigger value="issue"><ArrowUpFromLine/> Выдача</TabsTrigger>
          <TabsTrigger value="inventory"><ClipboardList/> Инвентаризация</TabsTrigger>
          <TabsTrigger value="history"><History/> Движения</TabsTrigger>
        </TabsList>

        <TabsContent value="materials" className="space-y-4">
          <section className="panel overflow-hidden p-0">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4 sm:p-5">
              <div><h2 className="font-black">Материалы</h2><p className="mt-1 text-xs text-slate-500">1С ID, тара, цвет, RAL, единицы и фактический остаток</p></div>
              <div className="flex flex-wrap gap-2">
                {selected.length > 0 && <Button variant="outline" className="text-red-600" onClick={() => void post({ action: "bulkDeleteProducts", ids: selected }, "Выбранные материалы обработаны").then(() => setSelected([]))}><Trash2 size={15}/> Удалить/архивировать ({selected.length})</Button>}
                <div className="relative w-72"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16}/><Input value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" placeholder="Название, артикул, RAL..."/></div>
              </div>
            </div>
            <div className="overflow-x-auto"><Table><TableHeader><TableRow>
              <TableHead><input type="checkbox" checked={filtered.length > 0 && filtered.every((p) => selected.includes(p.id))} onChange={(e) => setSelected(e.target.checked ? filtered.map((p) => p.id) : [])}/></TableHead>
              <TableHead>Материал</TableHead><TableHead>Артикул / 1С</TableHead><TableHead>Тара</TableHead><TableHead>Цвет</TableHead><TableHead>Штрихкод</TableHead><TableHead className="text-right">Остаток</TableHead><TableHead>Хранение</TableHead>
            </TableRow></TableHeader><TableBody>{filtered.map((p) => {
              const ps = data.stocks.filter((s) => s.productId === p.id && Number(s.quantity) > 0);
              const packages = p.packSize > 0 ? (stockByProduct.get(p.id) || 0) / p.packSize : 0;
              return <TableRow key={p.id}>
                <TableCell><input type="checkbox" checked={selected.includes(p.id)} onChange={(e) => setSelected((cur) => e.target.checked ? [...new Set([...cur, p.id])] : cur.filter((id) => id !== p.id))}/></TableCell>
                <TableCell><div className="font-bold">{p.name}</div><div className="text-xs text-slate-400">{p.category}{p.subcategory ? ` · ${p.subcategory}` : ""}{p.brand ? ` · ${p.brand}` : ""}</div></TableCell>
                <TableCell className="text-xs"><div className="font-mono">{p.sku}</div><div className="text-slate-400">{p.oneCId || "без ID 1С"}</div></TableCell>
                <TableCell className="text-xs">{p.packType || "—"}{p.packSize > 0 ? ` · ${fmt(p.packSize)} ${p.unit}` : ""}{packages > 0 ? <div className="font-semibold">≈ {fmt(packages)} уп.</div> : null}</TableCell>
                <TableCell className="text-xs">{p.color || "—"}{p.ral ? <div className="font-mono">RAL {p.ral}</div> : null}</TableCell>
                <TableCell className="font-mono text-xs">{p.barcode}</TableCell>
                <TableCell className="text-right font-black">{fmt(stockByProduct.get(p.id) || 0)} {p.unit}</TableCell>
                <TableCell className="max-w-72 text-xs text-slate-500">{ps.length ? ps.map((s) => `${cellById.get(s.cellId)?.code || "—"}: ${fmt(s.quantity)} ${p.unit}`).join(" · ") : "Не размещён"}</TableCell>
              </TableRow>;
            })}{!filtered.length && <TableRow><TableCell colSpan={8} className="py-10 text-center text-slate-400">Материалов нет</TableCell></TableRow>}</TableBody></Table></div>
          </section>
          <CreateProduct saving={saving} onCreate={(payload) => post({ action: "createProduct", ...payload }, "Материал добавлен")}/>
        </TabsContent>

        <TabsContent value="storage"><section className="panel p-6 sm:p-8"><div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-center"><div><p className="eyebrow">3D-хранение</p><h2 className="mt-2 text-2xl font-black">Склад в 3D</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">Стеллажи, полки, ячейки и напольные зоны находятся в одной комнате. QR места хранения формируется автоматически. По клику на ячейку или напольную зону видно, что там находится.</p><div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold"><span className="rounded-full bg-slate-100 px-3 py-1.5">Стеллажей: {data.racks.filter((r) => r.storageType !== "floor").length}</span><span className="rounded-full bg-slate-100 px-3 py-1.5">Напольных зон: {data.racks.filter((r) => r.storageType === "floor").length}</span><span className="rounded-full bg-slate-100 px-3 py-1.5">Мест хранения: {data.cells.length}</span></div></div><Button asChild className="accent-button h-12 px-6"><Link href={`/department/${warehouseCode}/rack-layout`} data-same-tab="true"><Layers3/> Открыть 3D-склад</Link></Button></div></section></TabsContent>

        <TabsContent value="receipt"><ReceiptForm products={data.products} cells={data.cells} saving={saving} onSubmit={(payload) => post({ action: "receive", ...payload }, "Приход оприходован")}/></TabsContent>
        <TabsContent value="transfer"><TransferForm products={data.products} cells={data.cells} stocks={data.stocks} saving={saving} onSubmit={(payload) => post({ action: "transfer", ...payload }, "Материал перемещён")}/></TabsContent>
        <TabsContent value="issue"><IssueMix products={data.products} cells={data.cells} stocks={data.stocks} saving={saving} onSubmit={(payload) => post({ action: "issueMix", ...payload }, "Смесь выдана и компоненты списаны")} mixes={data.mixes}/></TabsContent>
        <TabsContent value="inventory"><InventoryPanel inventories={data.inventories} saving={saving} onCreate={() => post({ action: "inventorySnapshot" }, "Остатки зафиксированы")}/></TabsContent>
        <TabsContent value="history"><Movements rows={data.movements}/></TabsContent>
      </Tabs>
    </div>

    {oneCOpen && <div className="fixed inset-0 z-[12000] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) setOneCOpen(false); }}>
      <section className="w-full max-w-3xl rounded-3xl bg-white p-6 shadow-2xl sm:p-7">
        <div className="flex items-start justify-between gap-4"><div><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.16em] text-orange-600"><FileSpreadsheet size={16}/> 1С</div><h2 className="mt-2 text-2xl font-black">Материалы из 1С</h2><p className="mt-2 text-sm text-slate-500">Загрузите номенклатуру. Артикул при отсутствии и штрихкод создаются автоматически.</p></div><Button type="button" variant="outline" size="icon" onClick={() => setOneCOpen(false)} disabled={saving}><X size={18}/></Button></div>
        <div className="mt-5"><OneCMaterials saving={saving} onImport={importFromOneC}/></div>
      </section>
    </div>}
  </main>;
}

function Metric({ label, value, icon: Icon }: { label: string; value: string | number; icon: typeof Boxes }) {
  return <div className="panel flex items-center gap-3 p-4"><div className="rounded-xl bg-slate-100 p-2.5"><Icon size={19}/></div><div><div className="text-xs text-slate-500">{label}</div><div className="text-xl font-black">{value}</div></div></div>;
}

function OneCMaterials({ saving, onImport }: { saving: boolean; onImport: (items: Array<Record<string, unknown>>) => Promise<void> }) {
  const [name, setName] = useState("");
  const parse = async (file: File) => {
    setName(file.name);
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: "" });
    const pick = (r: Record<string, unknown>, keys: string[]) => { const key = Object.keys(r).find((k) => keys.includes(k.trim().toLowerCase())); return key ? r[key] : ""; };
    const items = rows.map((r) => ({
      name: pick(r, ["наименование", "товар", "материал", "name"]), sku: pick(r, ["артикул", "код", "sku"]), oneCId: pick(r, ["id 1с", "id1с", "1c id", "onec id"]), barcode: pick(r, ["штрихкод", "barcode"]), category: pick(r, ["категория", "category"]), subcategory: pick(r, ["подкатегория", "subcategory"]), brand: pick(r, ["бренд", "brand"]), color: pick(r, ["цвет", "color"]), ral: pick(r, ["ral", "код цвета"]), unit: pick(r, ["единица", "ед. изм.", "ед изм", "unit"]), packType: pick(r, ["тара", "тип тары"]), packSize: pick(r, ["вес тары", "объем тары", "объём тары", "pack size"]), minStock: pick(r, ["мин. остаток", "минимальный остаток"]), comment: pick(r, ["комментарий", "comment"]),
    })).filter((x) => String(x.name).trim());
    if (!items.length) return toast.error("Не найден столбец Наименование/Материал");
    await onImport(items);
  };
  return <div className="rounded-2xl border border-dashed border-orange-300 bg-orange-50/60 p-5">
    <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-center"><div><b>Номенклатура 1С</b><p className="mt-1 text-xs leading-5 text-slate-500">XLSX / XLS / CSV. Распознаются наименование, артикул, ID 1С, цвет, RAL, единица, тара и минимальный остаток.</p></div><label className="cursor-pointer rounded-xl bg-slate-950 px-5 py-3 text-center text-sm font-bold text-white hover:bg-slate-800">{saving ? "Загрузка..." : name || "Выбрать файл"}<input type="file" accept=".xlsx,.xls,.csv" className="hidden" disabled={saving} onChange={(e) => { const f = e.target.files?.[0]; if (f) void parse(f); }}/></label></div>
  </div>;
}

function CreateProduct({ saving, onCreate }: { saving: boolean; onCreate: (payload: Record<string, unknown>) => Promise<unknown> }) {
  const submit = async (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const f = new FormData(e.currentTarget); await onCreate(Object.fromEntries(f.entries())); e.currentTarget.reset(); };
  return <form onSubmit={submit} className="panel p-5"><h3 className="font-black">Добавить материал вручную</h3><div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-5">
    <Field name="name" label="Наименование" required/><Field name="sku" label="Артикул"/><Field name="oneCId" label="ID из 1С"/><Field name="category" label="Категория"/><Field name="subcategory" label="Подкатегория"/>
    <Field name="brand" label="Бренд"/><Field name="color" label="Цвет"/><Field name="ral" label="RAL / код цвета"/>
    <SelectField name="unit" label="Единица" options={units}/><SelectField name="packType" label="Тип тары" options={packTypes}/><Field name="packSize" label="Вес/объём тары" type="number" step="0.001"/><Field name="minStock" label="Мин. остаток" type="number" step="0.001"/><Field name="imageUrl" label="Фото (URL)"/><Field name="comment" label="Комментарий"/>
  </div><Button disabled={saving} className="accent-button mt-4"><Plus/> Добавить</Button></form>;
}
function Field(props: { name: string; label: string; required?: boolean; type?: string; step?: string }) { return <div><Label>{props.label}</Label><Input className="mt-1.5" name={props.name} required={props.required} type={props.type || "text"} step={props.step}/></div>; }
function SelectField({ name, label, options }: { name: string; label: string; options: string[] }) { return <div><Label>{label}</Label><select name={name} className="mt-1.5 h-10 w-full rounded-md border bg-white px-3 text-sm">{options.map((x) => <option key={x}>{x}</option>)}</select></div>; }

function ReceiptForm({ products, cells, saving, onSubmit }: { products: Product[]; cells: Cell[]; saving: boolean; onSubmit: (p: Record<string, unknown>) => Promise<unknown> }) {
  const submit = async (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const f = new FormData(e.currentTarget); await onSubmit(Object.fromEntries(f.entries())); e.currentTarget.reset(); };
  return <form onSubmit={submit} className="panel p-6"><h2 className="text-xl font-black">Приход и оприходование</h2><p className="mt-1 text-sm text-slate-500">Фиксируем документ, поставщика/источник, откуда пришёл материал и сразу выбираем место хранения.</p><div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
    <Field name="documentNumber" label="Документ / накладная" required/><Field name="sourceName" label="От кого пришло" required/><Field name="sourceLocation" label="Откуда пришло"/><SelectProduct products={products}/><Field name="quantity" label="Количество" type="number" step="0.001" required/><SelectCell cells={cells} name="cellId" label="Куда разместить"/><Field name="comment" label="Комментарий"/>
  </div><Button disabled={saving} className="accent-button mt-5"><ArrowDownToLine/> Оприходовать и разместить</Button></form>;
}

function TransferForm({ products, cells, stocks, saving, onSubmit }: { products: Product[]; cells: Cell[]; stocks: Stock[]; saving: boolean; onSubmit: (p: Record<string, unknown>) => Promise<unknown> }) {
  const [fromCode, setFromCode] = useState("");
  const source = cells.find((c) => c.code.toLowerCase() === fromCode.trim().toLowerCase());
  const available = source ? stocks.filter((s) => s.cellId === source.id && Number(s.quantity) > 0) : [];
  const submit = async (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const f = new FormData(e.currentTarget); const to = cells.find((c) => c.code.toLowerCase() === String(f.get("toCode") || "").trim().toLowerCase()); if (!source || !to) return toast.error("Проверьте QR/код исходной и новой ячейки"); await onSubmit({ productId: f.get("productId"), fromCellId: source.id, toCellId: to.id, quantity: f.get("quantity"), comment: f.get("comment") }); };
  return <form onSubmit={submit} className="panel p-6"><h2 className="text-xl font-black">Перемещение по QR / коду места</h2><p className="mt-1 text-sm text-slate-500">Сканер вводит код места хранения. После исходной ячейки система показывает только товар, который реально там лежит.</p><div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
    <div><Label>QR / код исходной ячейки</Label><Input className="mt-1.5" value={fromCode} onChange={(e) => setFromCode(e.target.value)} placeholder="Напр. K1-1A или P-01" autoFocus/></div>
    <div><Label>Товар в этом месте</Label><select name="productId" className="mt-1.5 h-10 w-full rounded-md border bg-white px-3 text-sm" required>{available.map((s) => { const p = products.find((x) => x.id === s.productId); return <option key={s.productId} value={s.productId}>{p?.name} · {fmt(Number(s.quantity))} {p?.unit}</option>; })}</select></div>
    <Field name="quantity" label="Сколько переместить" type="number" step="0.001" required/><Field name="toCode" label="QR / код новой ячейки" required/><Field name="comment" label="Комментарий"/>
  </div><Button disabled={saving || !source || available.length === 0} className="accent-button mt-5"><ArrowRightLeft/> Переместить</Button></form>;
}

function IssueMix({ products, cells, stocks, saving, onSubmit, mixes }: { products: Product[]; cells: Cell[]; stocks: Stock[]; saving: boolean; onSubmit: (p: Record<string, unknown>) => Promise<unknown>; mixes: Mix[] }) {
  const [lines, setLines] = useState<MixLineDraft[]>([{ productId: "", cellId: "", quantity: "" }]);
  const update = (i: number, patch: Partial<MixLineDraft>) => setLines((cur) => cur.map((x, idx) => idx === i ? { ...x, ...patch } : x));
  const submit = async (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const f = new FormData(e.currentTarget); const valid = lines.filter((x) => x.productId && x.cellId && Number(x.quantity) > 0); if (!valid.length) return toast.error("Добавьте хотя бы один компонент"); await onSubmit({ name: f.get("name"), recipient: f.get("recipient"), documentNumber: f.get("documentNumber"), resultQuantity: f.get("resultQuantity"), resultUnit: f.get("resultUnit"), comment: f.get("comment"), lines: valid.map((x) => ({ ...x, unit: products.find((p) => p.id === x.productId)?.unit || "" })) }); setLines([{ productId: "", cellId: "", quantity: "" }]); e.currentTarget.reset(); };
  return <div className="space-y-4"><form onSubmit={submit} className="panel p-6"><h2 className="text-xl font-black">Выдача / смешивание</h2><p className="mt-1 max-w-4xl text-sm text-slate-500">Один итоговый продукт может состоять из краски, отвердителя, растворителя и других материалов. Каждая строка списывается со своего места хранения, а в истории сохраняется полный состав.</p><div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5"><Field name="name" label="Итоговый продукт / смесь" required/><Field name="recipient" label="Кому выдано"/><Field name="documentNumber" label="Документ"/><Field name="resultQuantity" label="Итоговое количество" type="number" step="0.001"/><SelectField name="resultUnit" label="Ед. итога" options={units}/></div>
    <div className="mt-5 space-y-2">{lines.map((line, i) => {
      const locations = stocks.filter((s) => s.productId === line.productId && Number(s.quantity) > 0);
      return <div key={i} className="grid gap-2 rounded-2xl border bg-slate-50 p-3 md:grid-cols-[1.4fr_1.2fr_.7fr_auto]">
        <select className="h-10 rounded-md border bg-white px-3 text-sm" value={line.productId} onChange={(e) => update(i, { productId: e.target.value, cellId: "" })}><option value="">Компонент...</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.unit}</option>)}</select>
        <select className="h-10 rounded-md border bg-white px-3 text-sm" value={line.cellId} onChange={(e) => update(i, { cellId: e.target.value })}><option value="">Место хранения...</option>{locations.map((s) => <option key={s.cellId} value={s.cellId}>{cells.find((c) => c.id === s.cellId)?.code} · доступно {fmt(Number(s.quantity))}</option>)}</select>
        <Input type="number" step="0.001" placeholder="Количество" value={line.quantity} onChange={(e) => update(i, { quantity: e.target.value })}/>
        <Button type="button" variant="outline" disabled={lines.length === 1} onClick={() => setLines((cur) => cur.filter((_, idx) => idx !== i))}><Trash2 size={15}/></Button>
      </div>;
    })}</div>
    <div className="mt-3 flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => setLines((cur) => [...cur, { productId: "", cellId: "", quantity: "" }])}><Plus/> Добавить компонент</Button><Button disabled={saving} className="accent-button"><ArrowUpFromLine/> Смешать и выдать</Button></div><div className="mt-4"><Label>Комментарий</Label><Input name="comment" className="mt-1.5"/></div>
  </form>
  {mixes.length > 0 && <section className="panel p-5"><h3 className="font-black">Последние смеси</h3><div className="mt-3 space-y-2">{mixes.slice(0, 8).map((m) => <div key={m.id} className="rounded-xl border p-3"><div className="flex flex-wrap justify-between gap-2"><b>{m.name}</b><span className="text-xs text-slate-500">{dateFmt(m.createdAt)} · {m.operator}</span></div><div className="mt-1 text-sm text-slate-600">{m.lines.map((l) => `${l.productName}: ${fmt(l.quantity)} ${l.unit} (${l.cellCode})`).join(" + ")}</div><div className="mt-1 text-xs font-semibold">Итог: {fmt(m.resultQuantity)} {m.resultUnit}{m.recipient ? ` · ${m.recipient}` : ""}</div></div>)}</div></section>}
  </div>;
}

function InventoryPanel({ inventories, saving, onCreate }: { inventories: Inventory[]; saving: boolean; onCreate: () => Promise<unknown> }) {
  return <section className="panel p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-black">Инвентаризация</h2><p className="mt-1 text-sm text-slate-500">Снятие фактических текущих остатков по материалам и местам хранения на выбранный момент.</p></div><Button disabled={saving} className="accent-button" onClick={() => void onCreate()}><ClipboardList/> Зафиксировать остатки сейчас</Button></div><div className="mt-5 space-y-2">{inventories.map((x) => { let count = 0; try { count = JSON.parse(x.snapshotJson).length; } catch {} return <div key={x.id} className="flex items-center justify-between rounded-xl border p-3"><div><b>{dateFmt(x.createdAt)}</b><div className="text-xs text-slate-500">Снял: {x.createdBy}</div></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold">Позиций: {count}</span></div>; })}{!inventories.length && <div className="rounded-xl border border-dashed p-8 text-center text-sm text-slate-400">Снимков остатков пока нет</div>}</div></section>;
}

function Movements({ rows }: { rows: Movement[] }) {
  return <section className="panel overflow-hidden p-0"><div className="border-b p-5"><h2 className="font-black">Движения</h2><p className="mt-1 text-xs text-slate-500">Что пришло, откуда, куда переместили, что списали в смесь, кто и когда сделал операцию.</p></div><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Дата</TableHead><TableHead>Операция</TableHead><TableHead>Материал</TableHead><TableHead>Маршрут / источник</TableHead><TableHead className="text-right">Количество</TableHead><TableHead>Документ</TableHead><TableHead>Сотрудник</TableHead></TableRow></TableHeader><TableBody>{rows.map((m) => <TableRow key={m.id}><TableCell className="whitespace-nowrap text-xs">{dateFmt(m.createdAt)}</TableCell><TableCell className="font-bold">{m.type}</TableCell><TableCell><b>{m.productName}</b><div className="text-xs text-slate-400">{m.productSku}</div></TableCell><TableCell className="text-xs">{m.type === "Приход" ? `${m.sourceName || "Источник"}${m.sourceLocation ? ` · ${m.sourceLocation}` : ""} → ${m.toCellCode}` : `${m.fromCellCode || "—"}${m.toCellCode ? ` → ${m.toCellCode}` : " → выдача"}`}</TableCell><TableCell className="text-right font-black">{fmt(Number(m.quantity))} {m.productUnit}</TableCell><TableCell className="text-xs">{m.documentNumber || "—"}</TableCell><TableCell className="text-xs">{m.operator}{m.recipient ? <div className="text-slate-500">Получатель: {m.recipient}</div> : null}</TableCell></TableRow>)}{!rows.length && <TableRow><TableCell colSpan={7} className="py-10 text-center text-slate-400">Движений пока нет</TableCell></TableRow>}</TableBody></Table></div></section>;
}

function SelectProduct({ products }: { products: Product[] }) { return <div><Label>Материал</Label><select name="productId" required className="mt-1.5 h-10 w-full rounded-md border bg-white px-3 text-sm"><option value="">Выберите...</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.unit}</option>)}</select></div>; }
function SelectCell({ cells, name, label }: { cells: Cell[]; name: string; label: string }) { return <div><Label>{label}</Label><select name={name} required className="mt-1.5 h-10 w-full rounded-md border bg-white px-3 text-sm"><option value="">Выберите...</option>{cells.filter((c) => !c.blocked).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.label}</option>)}</select></div>; }
