"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot, Root } from "react-dom/client";
import { ArrowUpFromLine, CheckCircle2, Loader2, PackageCheck, Plus, QrCode, RefreshCw, ScanLine, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Product = { id: string; name: string; sku: string; barcode: string; unit: string };
type Cell = { id: string; code: string; label: string };
type Stock = { productId: string; cellId: string; quantity: number };
type WarehouseData = { products: Product[]; cells: Cell[]; stocks: Stock[] };
type DraftLine = { id: string; cellId: string; cellCode: string; productId: string; productName: string; barcode: string; quantity: number; unit: string; enteredQuantity: number; enteredUnit: string };
type Draft = { id: string; status: "collecting" | "ready"; recipient: string; documentNumber: string; resultName: string; resultQuantity: number; resultUnit: string; comment: string; lines: DraftLine[]; updatedAt?: string };

const units = ["кг", "г", "мг", "л", "мл", "шт."];
const mounted = new WeakMap<Element, Root>();
const fmt = (n: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 6 }).format(n);

function group(unit: string) {
  if (["кг", "г", "мг"].includes(unit)) return "mass";
  if (["л", "мл"].includes(unit)) return "volume";
  if (unit === "шт.") return "count";
  return "other";
}
function toBase(v: number, u: string) {
  if (u === "кг") return v * 1_000_000;
  if (u === "г") return v * 1_000;
  if (u === "мг") return v;
  if (u === "л") return v * 1_000;
  if (u === "мл") return v;
  return v;
}
function fromBase(v: number, u: string) {
  if (u === "кг") return v / 1_000_000;
  if (u === "г") return v / 1_000;
  if (u === "мг") return v;
  if (u === "л") return v / 1_000;
  if (u === "мл") return v;
  return v;
}
function convert(v: number, from: string, to: string) {
  if (from === to) return v;
  if (group(from) !== group(to)) return null;
  return fromBase(toBase(v, from), to);
}
function emptyDraft(): Draft {
  return { id: crypto.randomUUID(), status: "collecting", recipient: "", documentNumber: "", resultName: "", resultQuantity: 0, resultUnit: "кг", comment: "", lines: [] };
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const body = await r.json() as T & { error?: string };
  if (!r.ok) throw new Error(body.error || "Ошибка операции");
  return body;
}

function QrIssueWorkflow() {
  const [data, setData] = useState<WarehouseData>({ products: [], cells: [], stocks: [] });
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [mode, setMode] = useState<"qr" | "manual">("qr");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cellCode, setCellCode] = useState("");
  const [selectedCellId, setSelectedCellId] = useState("");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [qty, setQty] = useState("");
  const [qtyUnit, setQtyUnit] = useState("кг");
  const localChange = useRef(false);

  const loadWarehouse = useCallback(async () => {
    const body = await json<WarehouseData>("/api/department-warehouse", { cache: "no-store" });
    setData(body);
  }, []);

  const loadDraft = useCallback(async (silent = false) => {
    try {
      const body = await json<{ draft: Draft | null }>("/api/department-issue-draft", { cache: "no-store" });
      if (body.draft && !localChange.current) setDraft(body.draft);
    } catch (e) {
      if (!silent) toast.error(e instanceof Error ? e.message : "Не удалось загрузить сборку");
    }
  }, []);

  useEffect(() => {
    void Promise.all([loadWarehouse(), loadDraft()]).finally(() => setLoading(false));
    const timer = window.setInterval(() => void loadDraft(true), 2000);
    return () => window.clearInterval(timer);
  }, [loadWarehouse, loadDraft]);

  const persist = useCallback(async (next: Draft) => {
    localChange.current = true;
    setDraft(next);
    try {
      const body = await json<{ draft: Draft }>("/api/department-issue-draft", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", draft: next }),
      });
      setDraft(body.draft);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Не удалось синхронизировать сборку"); }
    finally { window.setTimeout(() => { localChange.current = false; }, 250); }
  }, []);

  const productById = useMemo(() => new Map(data.products.map((p) => [p.id, p])), [data.products]);
  const selectedCell = data.cells.find((c) => c.id === selectedCellId);
  const stocksHere = selectedCell ? data.stocks.filter((s) => s.cellId === selectedCell.id && Number(s.quantity) > 0) : [];
  const productsHere = stocksHere.map((s) => ({ stock: s, product: productById.get(s.productId) })).filter((x) => x.product) as Array<{ stock: Stock; product: Product }>;
  const selectedProduct = productById.get(selectedProductId);
  const selectedStock = stocksHere.find((s) => s.productId === selectedProductId);
  const progress = draft.status === "ready" ? 80 : draft.lines.length > 0 ? 55 : selectedCell ? 30 : 10;

  const scanCell = () => {
    const q = cellCode.trim().toLowerCase();
    const cell = data.cells.find((c) => c.code.toLowerCase() === q || c.label.toLowerCase() === q);
    if (!cell) return toast.error("Ячейка не найдена");
    setSelectedCellId(cell.id); setSelectedProductId(""); setQty("");
    toast.success(`Ячейка ${cell.code} открыта`, { description: "Выберите материал из фактического остатка." });
  };

  const addLine = async () => {
    if (!selectedCell || !selectedProduct || !selectedStock) return toast.error("Выберите ячейку и материал");
    const entered = Number(qty.replace(",", "."));
    if (!Number.isFinite(entered) || entered <= 0) return toast.error("Укажите количество");
    const converted = convert(entered, qtyUnit, selectedProduct.unit);
    if (converted === null) return toast.error(`Нельзя пересчитать ${qtyUnit} в ${selectedProduct.unit}`);
    const already = draft.lines.filter((l) => l.cellId === selectedCell.id && l.productId === selectedProduct.id).reduce((s, l) => s + l.quantity, 0);
    const available = Number(selectedStock.quantity);
    if (already + converted > available + 1e-9) return toast.error(`Недостаточно остатка. Доступно: ${fmt(available - already)} ${selectedProduct.unit}`);
    const line: DraftLine = { id: crypto.randomUUID(), cellId: selectedCell.id, cellCode: selectedCell.code, productId: selectedProduct.id, productName: selectedProduct.name, barcode: selectedProduct.barcode, quantity: converted, unit: selectedProduct.unit, enteredQuantity: entered, enteredUnit: qtyUnit };
    await persist({ ...draft, status: "collecting", lines: [...draft.lines, line] });
    setQty("");
    toast.success("Позиция добавлена в сборку");
  };

  const removeLine = async (id: string) => persist({ ...draft, status: "collecting", lines: draft.lines.filter((l) => l.id !== id) });
  const updateDraft = async (patch: Partial<Draft>) => persist({ ...draft, ...patch });

  const finishCollect = async () => {
    if (!draft.lines.length) return toast.error("Сборка пустая");
    await updateDraft({ status: "ready" });
    toast.success("Сборка завершена", { description: "Теперь можно проверить состав и выдать." });
  };

  const issue = async () => {
    if (!draft.lines.length) return toast.error("Нет собранных позиций");
    setSaving(true);
    try {
      await json<{ ok: boolean }>("/api/department-warehouse", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "issueMix", name: draft.resultName || "Выдача по сборке", recipient: draft.recipient, documentNumber: draft.documentNumber, resultQuantity: draft.resultQuantity, resultUnit: draft.resultUnit, comment: draft.comment, lines: draft.lines.map((l) => ({ productId: l.productId, cellId: l.cellId, quantity: l.quantity, unit: l.unit })) }),
      });
      await json<{ ok: boolean }>("/api/department-issue-draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "clear" }) });
      setDraft(emptyDraft()); setSelectedCellId(""); setSelectedProductId(""); setCellCode(""); setQty("");
      await loadWarehouse();
      toast.success("Выдача завершена", { description: "Все позиции списаны и записаны в «Движения»." });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Не удалось выдать"); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="panel grid min-h-64 place-items-center"><Loader2 className="animate-spin"/></div>;

  return <div className="space-y-4">
    <section className="panel p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-xs font-black uppercase tracking-[.16em] text-orange-600">Выдача со склада краски</p><h2 className="mt-1 text-2xl font-black">Сборка → проверка → выдача</h2><p className="mt-1 max-w-4xl text-sm text-slate-500">Основной режим — по QR ячейки. Сканируете место, выбираете материал по названию/штрихкоду, указываете точное количество и добавляете позицию. Сборка синхронизируется между устройствами под тем же пользователем.</p></div>
        <div className="flex gap-2"><Button type="button" variant={mode === "qr" ? "default" : "outline"} onClick={() => setMode("qr")}><QrCode size={16}/> По QR</Button><Button type="button" variant={mode === "manual" ? "default" : "outline"} onClick={() => setMode("manual")}><Plus size={16}/> Ручная выдача</Button></div>
      </div>
      <div className="mt-5 rounded-2xl border bg-slate-50 p-4">
        <div className="flex items-center justify-between gap-3"><div><div className="text-xs font-black uppercase tracking-[.14em] text-slate-400">Прогресс выдачи</div><div className="mt-1 font-black">{progress}% · {draft.status === "ready" ? "Сборка завершена, ожидает выдачи" : draft.lines.length ? `Собрано позиций: ${draft.lines.length}` : "Начните со сканирования ячейки"}</div></div><div className="flex items-center gap-2 text-xs font-semibold text-emerald-700"><RefreshCw size={14}/> синхронизация каждые 2 сек.</div></div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-orange-500 transition-all" style={{ width: `${progress}%` }}/></div>
      </div>
    </section>

    {mode === "qr" ? <section className="grid gap-4 xl:grid-cols-[1.05fr_.95fr]">
      <div className="panel p-5 sm:p-6">
        <h3 className="text-lg font-black">1. Сканировать ячейку</h3>
        <div className="mt-3 flex gap-2"><Input value={cellCode} onChange={(e) => setCellCode(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); scanCell(); } }} placeholder="QR / код ячейки, например K11B"/><Button type="button" onClick={scanCell}><ScanLine size={16}/> Открыть</Button></div>
        {selectedCell && <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50/60 p-4"><div className="font-black text-blue-900">Ячейка {selectedCell.code}</div><div className="mt-1 text-xs text-blue-700">Материалов в ячейке: {productsHere.length}</div></div>}

        <h3 className="mt-5 text-lg font-black">2. Выбрать материал</h3>
        {!selectedCell ? <div className="mt-3 rounded-xl border border-dashed p-6 text-center text-sm text-slate-400">Сначала отсканируйте ячейку</div> : productsHere.length === 0 ? <div className="mt-3 rounded-xl border border-dashed p-6 text-center text-sm text-slate-400">В этой ячейке нет остатка</div> : <div className="mt-3 space-y-2">{productsHere.map(({ stock, product }) => <button type="button" key={product.id} onClick={() => { setSelectedProductId(product.id); setQtyUnit(product.unit); }} className={`w-full rounded-2xl border p-3 text-left transition ${selectedProductId === product.id ? "border-blue-400 bg-blue-50 shadow-sm" : "bg-white hover:bg-slate-50"}`}><div className="flex flex-wrap items-center justify-between gap-2"><div><b>{product.name}</b><div className="mt-1 font-mono text-xs text-slate-500">Штрихкод: {product.barcode || "—"}</div></div><div className="text-right"><div className="font-black">{fmt(Number(stock.quantity))} {product.unit}</div><div className="text-xs text-slate-400">доступно</div></div></div></button>)}</div>}

        {selectedProduct && <div className="mt-5 rounded-2xl border p-4"><div className="font-black">3. Количество</div><div className="mt-3 grid gap-2 sm:grid-cols-[1fr_180px_auto]"><Input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" placeholder="Например: 125,750"/><select value={qtyUnit} onChange={(e) => setQtyUnit(e.target.value)} className="h-10 rounded-md border bg-white px-3 text-sm">{units.map((u) => <option key={u}>{u}</option>)}</select><Button type="button" className="accent-button" onClick={() => void addLine()}><PackageCheck size={16}/> В сборку</Button></div></div>}
      </div>

      <div className="panel p-5 sm:p-6">
        <div className="flex items-center justify-between"><div><h3 className="text-lg font-black">Собранные позиции</h3><p className="mt-1 text-xs text-slate-500">Этот список виден на другом устройстве под тем же пользователем.</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold">{draft.lines.length}</span></div>
        <div className="mt-4 space-y-2">{draft.lines.map((line, i) => <div key={line.id} className="rounded-2xl border p-3"><div className="flex gap-3"><div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-orange-50 text-xs font-black text-orange-700">{i + 1}</div><div className="min-w-0 flex-1"><b>{line.productName}</b><div className="mt-1 text-xs text-slate-500">Ячейка {line.cellCode} · штрихкод {line.barcode || "—"}</div><div className="mt-1 font-black">{fmt(line.enteredQuantity)} {line.enteredUnit}<span className="ml-2 text-xs font-normal text-slate-400">спишется {fmt(line.quantity)} {line.unit}</span></div></div><Button type="button" size="icon" variant="outline" onClick={() => void removeLine(line.id)}><Trash2 size={15}/></Button></div></div>)}{draft.lines.length === 0 && <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-slate-400">Пока ничего не собрано</div>}</div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2"><div><Label>Кому выдано</Label><Input value={draft.recipient} onChange={(e) => setDraft((d) => ({ ...d, recipient: e.target.value }))} onBlur={() => void persist(draft)} placeholder="Например: малярный участок"/></div><div><Label>Документ</Label><Input value={draft.documentNumber} onChange={(e) => setDraft((d) => ({ ...d, documentNumber: e.target.value }))} onBlur={() => void persist(draft)} placeholder="Например: ТР-125"/></div><div><Label>Итоговый продукт / смесь</Label><Input value={draft.resultName} onChange={(e) => setDraft((d) => ({ ...d, resultName: e.target.value }))} onBlur={() => void persist(draft)} placeholder="Например: смесь RAL 9016"/></div><div className="grid grid-cols-[1fr_110px] gap-2"><div><Label>Итог</Label><Input value={draft.resultQuantity || ""} onChange={(e) => setDraft((d) => ({ ...d, resultQuantity: Number(e.target.value.replace(",", ".")) || 0 }))} onBlur={() => void persist(draft)} inputMode="decimal"/></div><div><Label>Ед.</Label><select value={draft.resultUnit} onChange={(e) => void updateDraft({ resultUnit: e.target.value })} className="mt-1.5 h-10 w-full rounded-md border bg-white px-3 text-sm">{units.map((u) => <option key={u}>{u}</option>)}</select></div></div><div className="sm:col-span-2"><Label>Комментарий</Label><Input value={draft.comment} onChange={(e) => setDraft((d) => ({ ...d, comment: e.target.value }))} onBlur={() => void persist(draft)} placeholder="Комментарий к выдаче"/></div></div>
        <div className="mt-5 flex flex-wrap gap-2">{draft.status !== "ready" ? <Button type="button" disabled={!draft.lines.length} onClick={() => void finishCollect()}><CheckCircle2 size={16}/> Завершить сборку</Button> : <><Button type="button" variant="outline" onClick={() => void updateDraft({ status: "collecting" })}>Вернуться к сборке</Button><Button type="button" disabled={saving} className="accent-button" onClick={() => void issue()}><ArrowUpFromLine size={16}/>{saving ? "Выдаём..." : "Выдать"}</Button></>}</div>
      </div>
    </section> : <ManualIssue data={data} onDone={loadWarehouse}/>}
  </div>;
}

function ManualIssue({ data, onDone }: { data: WarehouseData; onDone: () => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [productId, setProductId] = useState("");
  const [cellId, setCellId] = useState("");
  const [unit, setUnit] = useState("кг");
  const product = data.products.find((p) => p.id === productId);
  const available = data.stocks.filter((s) => s.productId === productId && Number(s.quantity) > 0);
  useEffect(() => { if (product) setUnit(product.unit); setCellId(""); }, [productId, product]);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const f = new FormData(e.currentTarget); if (!product) return;
    const input = Number(String(f.get("quantity") || "").replace(",", ".")); const converted = convert(input, unit, product.unit);
    if (!converted || converted <= 0) return toast.error("Проверьте количество и единицу");
    setSaving(true);
    try {
      await json<{ ok: boolean }>("/api/department-warehouse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "issue", productId, cellId, quantity: converted, recipient: f.get("recipient"), documentNumber: f.get("documentNumber"), comment: f.get("comment") }) });
      toast.success("Материал выдан"); await onDone(); e.currentTarget.reset(); setProductId(""); setCellId("");
    } catch (err) { toast.error(err instanceof Error ? err.message : "Ошибка выдачи"); } finally { setSaving(false); }
  };
  return <form onSubmit={submit} className="panel p-5 sm:p-6"><div><p className="text-xs font-black uppercase tracking-[.14em] text-slate-400">Ручная выдача</p><h3 className="mt-1 text-xl font-black">Быстрое списание одной позиции</h3><p className="mt-1 text-sm text-slate-500">Для редких случаев без сканера. Основной рабочий процесс остаётся через QR-сборку.</p></div><div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4"><div><Label>Материал *</Label><select value={productId} onChange={(e) => setProductId(e.target.value)} className="mt-1.5 h-10 w-full rounded-md border bg-white px-3 text-sm" required><option value="">Выберите...</option>{data.products.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.barcode}</option>)}</select></div><div><Label>Место хранения *</Label><select value={cellId} onChange={(e) => setCellId(e.target.value)} className="mt-1.5 h-10 w-full rounded-md border bg-white px-3 text-sm" required><option value="">Выберите...</option>{available.map((s) => { const c = data.cells.find((x) => x.id === s.cellId); return <option key={s.cellId} value={s.cellId}>{c?.code || "—"} · {fmt(Number(s.quantity))} {product?.unit}</option>; })}</select></div><div className="grid grid-cols-[1fr_105px] gap-2"><div><Label>Количество *</Label><Input name="quantity" inputMode="decimal" required className="mt-1.5"/></div><div><Label>Ед.</Label><select value={unit} onChange={(e) => setUnit(e.target.value)} className="mt-1.5 h-10 w-full rounded-md border bg-white px-3 text-sm">{units.map((u) => <option key={u}>{u}</option>)}</select></div></div><div><Label>Кому выдано</Label><Input name="recipient" className="mt-1.5"/></div><div><Label>Документ</Label><Input name="documentNumber" className="mt-1.5"/></div><div className="md:col-span-2"><Label>Комментарий</Label><Input name="comment" className="mt-1.5"/></div></div><Button disabled={saving || !productId || !cellId} className="accent-button mt-5"><ArrowUpFromLine size={16}/>{saving ? "Выдаём..." : "Выдать материал"}</Button></form>;
}

export function DepartmentPaintIssueEnhancer() {
  useEffect(() => {
    if (!window.location.pathname.startsWith("/department/paint")) return;
    const enhance = () => {
      document.querySelectorAll<HTMLFormElement>("form").forEach((form) => {
        const title = form.querySelector("h2")?.textContent?.trim();
        if (title !== "Выдача / смешивание" || form.dataset.qrIssue === "1") return;
        form.dataset.qrIssue = "1";
        const parent = form.parentElement;
        if (!parent) return;
        parent.style.display = "none";
        const host = document.createElement("div"); host.dataset.qrIssueHost = "1";
        parent.insertAdjacentElement("afterend", host);
        const root = createRoot(host); mounted.set(host, root); root.render(<QrIssueWorkflow/>);
      });
    };
    enhance();
    const observer = new MutationObserver(enhance); observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return null;
}
