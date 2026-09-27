"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, Download, FileSpreadsheet, Pencil, RefreshCw, Save, Trash2, UserRound, X } from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

 type Rack = { id: string; code: string; name: string; storageType: string };
 type Cell = { id: string; rackId: string; code: string; rowIndex?: number };
 type Product = { id: string; name: string; sku: string; barcode: string; oneCId?: string | null; category: string; unit: string };
 type Stock = { productId: string; cellId: string; quantity: number };
 type Movement = { id: string; type: string; productId: string; productName: string; productSku: string; productUnit: string; fromCellCode: string; toCellCode: string; quantity: number; recipient: string; comment: string; operator: string; documentNumber: string; sourceName: string; sourceLocation: string; createdAt: string };
 type Inventory = { id: string; createdBy: string; createdAt: string; snapshotJson: string };
 type InventoryRow = { productId?: string; name?: string; sku?: string; unit?: string; cellId?: string; cellCode?: string; quantity?: number };
 type Snapshot = { racks: Rack[]; cells: Cell[]; products: Product[]; stocks: Stock[]; movements: Movement[]; inventories: Inventory[]; error?: string };

const dateText = (value: string) => new Date(value).toLocaleString("ru-RU");
const fileStamp = () => new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");

function addSheet(wb: XLSX.WorkBook, name: string, title: string, subtitle: string, headers: string[], rows: Array<Array<string | number>>, widths: number[]) {
  const ws = XLSX.utils.aoa_to_sheet([[title], [subtitle], [`Сформировано: ${new Date().toLocaleString("ru-RU")}`], [], headers, ...rows]);
  const endCol = XLSX.utils.encode_col(Math.max(0, headers.length - 1));
  ws["!merges"] = [XLSX.utils.decode_range(`A1:${endCol}1`), XLSX.utils.decode_range(`A2:${endCol}2`), XLSX.utils.decode_range(`A3:${endCol}3`)];
  ws["!cols"] = widths.map((wch) => ({ wch }));
  ws["!rows"] = [{ hpt: 28 }, { hpt: 20 }, { hpt: 18 }, { hpt: 8 }, { hpt: 22 }];
  ws["!autofilter"] = { ref: `A5:${endCol}${Math.max(5, rows.length + 5)}` };
  XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
}

function save(wb: XLSX.WorkBook, prefix: string) {
  XLSX.writeFile(wb, `${prefix}_${fileStamp()}.xlsx`, { compression: true });
}

function parseInventory(item: Inventory): InventoryRow[] {
  try {
    const value = JSON.parse(item.snapshotJson) as unknown;
    return Array.isArray(value) ? value as InventoryRow[] : [];
  } catch { return []; }
}

export function WarehouseExcelToolsV2() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [activeTab, setActiveTab] = useState("");
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const [busyId, setBusyId] = useState("");
  const [currentUsername, setCurrentUsername] = useState("");
  const [editing, setEditing] = useState<Inventory | null>(null);
  const [editRows, setEditRows] = useState<InventoryRow[]>([]);
  const mountRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<Element | null>(null);
  const hiddenInventoryRef = useRef<HTMLElement | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/department-warehouse", { cache: "no-store" });
    const body = await response.json() as Snapshot;
    if (!response.ok) throw new Error(body.error || "Не удалось загрузить склад");
    setData(body);
    return body;
  }, []);

  useEffect(() => { void load().catch(() => undefined); }, [load]);
  useEffect(() => {
    void fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ user?: { username?: string } }>)
      .then((body) => setCurrentUsername(String(body.user?.username || "").toLowerCase()))
      .catch(() => setCurrentUsername(""));
  }, []);

  useEffect(() => {
    if (activeTab !== "Инвентаризация") return;
    const timer = window.setInterval(() => { void load().catch(() => undefined); }, 1500);
    return () => window.clearInterval(timer);
  }, [activeTab, load]);

  useEffect(() => {
    const sync = () => {
      const activeButton = document.querySelector('[role="tab"][data-state="active"]') as HTMLElement | null;
      const panel = document.querySelector('[role="tabpanel"][data-state="active"]');
      const label = activeButton?.textContent?.trim() || "";
      const supported = ["Склад", "Приход", "Выдача", "Инвентаризация"].includes(label);

      if (!supported || !panel) {
        if (mountRef.current) { mountRef.current.remove(); mountRef.current = null; setMount(null); }
        if (hiddenInventoryRef.current) { hiddenInventoryRef.current.style.display = ""; hiddenInventoryRef.current = null; }
        panelRef.current = null;
        if (activeTab) setActiveTab("");
        return;
      }

      if (panelRef.current !== panel) {
        if (mountRef.current) mountRef.current.remove();
        if (hiddenInventoryRef.current) { hiddenInventoryRef.current.style.display = ""; hiddenInventoryRef.current = null; }
        const host = document.createElement("div");
        host.className = "mb-3";
        panel.insertBefore(host, panel.firstChild);
        mountRef.current = host;
        panelRef.current = panel;
        setMount(host);
      }

      if (label === "Инвентаризация" && !hiddenInventoryRef.current) {
        const heading = Array.from(panel.querySelectorAll("h2")).find((x) => x.textContent?.trim() === "Инвентаризация");
        const section = heading?.closest("section");
        const oldList = section ? Array.from(section.children).find((node) => node instanceof HTMLElement && node.classList.contains("mt-5")) as HTMLElement | undefined : undefined;
        if (oldList) { oldList.style.display = "none"; hiddenInventoryRef.current = oldList; }
      }
      if (label !== "Инвентаризация" && hiddenInventoryRef.current) { hiddenInventoryRef.current.style.display = ""; hiddenInventoryRef.current = null; }
      if (activeTab !== label) { setActiveTab(label); void load().catch(() => undefined); }
    };
    sync();
    const timer = window.setInterval(sync, 300);
    return () => {
      window.clearInterval(timer);
      mountRef.current?.remove();
      if (hiddenInventoryRef.current) hiddenInventoryRef.current.style.display = "";
    };
  }, [activeTab, load]);

  const indexes = useMemo(() => {
    const products = new Map((data?.products || []).map((x) => [x.id, x]));
    const cells = new Map((data?.cells || []).map((x) => [x.id, x]));
    const racks = new Map((data?.racks || []).map((x) => [x.id, x]));
    return { products, cells, racks };
  }, [data]);

  const place = (cellId?: string) => {
    if (!cellId) return "—";
    const cell = indexes.cells.get(cellId);
    const rack = cell ? indexes.racks.get(cell.rackId) : undefined;
    if (!cell) return "—";
    if (rack?.storageType === "floor") return `Напольная зона ${rack.code} · ${cell.code}`;
    return `Стеллаж ${rack?.code || "—"} · ${cell.code}${typeof cell.rowIndex === "number" ? ` · полка ${cell.rowIndex + 1}` : ""}`;
  };

  const exportStorage = async () => {
    try {
      const d = await load();
      const productById = new Map(d.products.map((x) => [x.id, x]));
      const totals = new Map<string, number>();
      d.stocks.filter((x) => Number(x.quantity) > 0).forEach((x) => totals.set(x.productId, (totals.get(x.productId) || 0) + Number(x.quantity)));
      const wb = XLSX.utils.book_new();
      addSheet(wb, "Сводка", "СКЛАД КРАСКИ — СВОДКА ОСТАТКОВ", `Материалов на хранении: ${totals.size}`, ["Материал", "Артикул", "ID 1С", "Штрихкод", "Категория", "Ед.", "Общий остаток", "Мест хранения"], d.products.filter((p) => totals.has(p.id)).map((p) => [p.name, p.sku, p.oneCId || "", p.barcode, p.category, p.unit, totals.get(p.id) || 0, d.stocks.filter((s) => s.productId === p.id && Number(s.quantity) > 0).length]), [44, 18, 18, 22, 18, 10, 18, 16]);
      addSheet(wb, "По ячейкам", "СКЛАД КРАСКИ — РАЗМЕЩЕНИЕ ПО ЯЧЕЙКАМ", "Фактически размещённые остатки", ["Материал", "Артикул", "Штрихкод", "Количество", "Ед.", "Место хранения", "Код ячейки"], d.stocks.filter((x) => Number(x.quantity) > 0).map((s) => { const p = productById.get(s.productId); const c = d.cells.find((x) => x.id === s.cellId); return [p?.name || "", p?.sku || "", p?.barcode || "", Number(s.quantity), p?.unit || "", place(s.cellId), c?.code || ""]; }), [44, 18, 22, 16, 10, 42, 14]);
      save(wb, "Склад_краски_остатки"); toast.success("Excel склада готов");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Не удалось сформировать Excel"); }
  };

  const exportMovements = async (kind: "receipt" | "issue") => {
    try {
      const d = await load();
      const rows = d.movements.filter((m) => kind === "receipt" ? m.type === "Приход" : m.type.includes("Выдача"));
      const summary = new Map<string, { name: string; sku: string; unit: string; quantity: number }>();
      rows.forEach((m) => { const cur = summary.get(m.productId) || { name: m.productName, sku: m.productSku, unit: m.productUnit, quantity: 0 }; cur.quantity += Number(m.quantity); summary.set(m.productId, cur); });
      const wb = XLSX.utils.book_new();
      const title = kind === "receipt" ? "СКЛАД КРАСКИ — ПРИХОДЫ" : "СКЛАД КРАСКИ — ВЫДАЧИ";
      addSheet(wb, kind === "receipt" ? "Приходы" : "Выдачи", title, `Операций: ${rows.length}`, ["Дата/время", "Материал", "Артикул", "Количество", "Ед.", kind === "receipt" ? "Куда" : "Откуда", "Документ", kind === "receipt" ? "От кого пришло" : "Получатель", kind === "receipt" ? "Откуда пришло" : "Тип операции", "Оператор", "Комментарий"], rows.map((m) => [dateText(m.createdAt), m.productName, m.productSku, Number(m.quantity), m.productUnit, kind === "receipt" ? m.toCellCode : m.fromCellCode, m.documentNumber, kind === "receipt" ? m.sourceName : m.recipient, kind === "receipt" ? m.sourceLocation : m.type, m.operator, m.comment]), [20, 44, 18, 14, 10, 14, 20, 26, 24, 20, 34]);
      addSheet(wb, "Сводка", `${title} — СВОДКА`, "Итоги по материалам", ["Материал", "Артикул", "Ед.", "Итого"], Array.from(summary.values()).map((x) => [x.name, x.sku, x.unit, x.quantity]), [44, 20, 10, 18]);
      save(wb, kind === "receipt" ? "Склад_краски_приходы" : "Склад_краски_выдачи"); toast.success("Excel готов");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Не удалось сформировать Excel"); }
  };

  const inventories = useMemo(() => data?.inventories || [], [data]);
  const canManageInventory = currentUsername === "roman" || currentUsername === "artashes";

  const exportInventory = (item: Inventory) => {
    const rows = parseInventory(item);
    const totals = new Map<string, { name: string; sku: string; unit: string; quantity: number }>();
    rows.forEach((r) => { const key = r.productId || `${r.name}-${r.sku}`; const cur = totals.get(key) || { name: r.name || "", sku: r.sku || "", unit: r.unit || "", quantity: 0 }; cur.quantity += Number(r.quantity || 0); totals.set(key, cur); });
    const wb = XLSX.utils.book_new();
    addSheet(wb, "Остатки", "ИНВЕНТАРИЗАЦИЯ СКЛАДА КРАСКИ", `Дата: ${dateText(item.createdAt)} · Снял: ${item.createdBy}`, ["Материал", "Артикул", "Количество", "Ед.", "Ячейка", "Место хранения"], rows.map((r) => [r.name || "", r.sku || "", Number(r.quantity || 0), r.unit || "", r.cellCode || "", place(r.cellId)]), [44, 20, 16, 10, 14, 42]);
    addSheet(wb, "Сводка", "ИНВЕНТАРИЗАЦИЯ — СВОДКА", `Строк остатков: ${rows.length}`, ["Материал", "Артикул", "Ед.", "Общий остаток"], Array.from(totals.values()).map((x) => [x.name, x.sku, x.unit, x.quantity]), [44, 20, 10, 18]);
    save(wb, `Инвентаризация_${item.createdAt.slice(0, 10)}`);
  };

  const exportAllInventories = () => {
    if (!inventories.length) return toast.info("Инвентаризаций пока нет");
    const wb = XLSX.utils.book_new();
    inventories.forEach((item, index) => {
      const rows = parseInventory(item);
      addSheet(wb, `Инв_${index + 1}`, `ИНВЕНТАРИЗАЦИЯ ${dateText(item.createdAt)}`, `Снял: ${item.createdBy}`, ["Материал", "Артикул", "Количество", "Ед.", "Ячейка"], rows.map((r) => [r.name || "", r.sku || "", Number(r.quantity || 0), r.unit || "", r.cellCode || ""]), [44, 20, 16, 10, 14]);
    });
    save(wb, "Инвентаризации_склад_краски");
  };

  const deleteInventory = async (item: Inventory) => {
    if (!confirm(`Удалить инвентаризацию от ${dateText(item.createdAt)}?`)) return;
    setBusyId(item.id);
    try {
      const response = await fetch("/api/department-warehouse-inventory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", id: item.id }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "Не удалось удалить инвентаризацию");
      await load(); toast.success("Инвентаризация удалена");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Не удалось удалить"); }
    finally { setBusyId(""); }
  };

  const openEdit = (item: Inventory) => {
    setEditing(item);
    setEditRows(parseInventory(item).map((row) => ({ ...row })));
  };

  const saveEdit = async () => {
    if (!editing) return;
    setBusyId(editing.id);
    try {
      const response = await fetch("/api/department-warehouse-inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update", id: editing.id, rows: editRows }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "Не удалось сохранить инвентаризацию");
      setEditing(null);
      await load();
      toast.success("Инвентаризация обновлена");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Не удалось сохранить"); }
    finally { setBusyId(""); }
  };

  if (!mount) return null;

  const excelButton = (label: string, action: () => void) => <Button type="button" variant="outline" size="sm" className="border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100" onClick={action}><FileSpreadsheet size={15}/> {label}</Button>;

  const portal = createPortal(<div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2">
      {activeTab === "Склад" && excelButton("Скачать Excel склада", () => void exportStorage())}
      {activeTab === "Приход" && excelButton("Скачать Excel приходов", () => void exportMovements("receipt"))}
      {activeTab === "Выдача" && excelButton("Скачать Excel выдач", () => void exportMovements("issue"))}
      {activeTab === "Инвентаризация" && <>
        {excelButton("Скачать все инвентаризации", exportAllInventories)}
        <Button type="button" variant="outline" size="sm" onClick={() => void load()}><RefreshCw size={15}/> Обновить</Button>
      </>}
    </div>

    {activeTab === "Инвентаризация" && <div className="grid gap-3">
      {inventories.map((item) => {
        const rows = parseInventory(item);
        const locations = new Set(rows.map((row) => row.cellId || row.cellCode).filter(Boolean)).size;
        return <div key={item.id} className="rounded-2xl border bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-700"><CalendarDays size={18}/></span>
                <div><div className="font-black text-slate-900">Инвентаризация · {dateText(item.createdAt)}</div><div className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-slate-500"><span className="inline-flex items-center gap-1"><UserRound size={13}/> {item.createdBy}</span><span>Позиций: <b className="text-slate-700">{rows.length}</b></span><span>Мест хранения: <b className="text-slate-700">{locations}</b></span></div></div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100" onClick={() => exportInventory(item)}><Download size={14}/> Excel остатков</Button>
              {canManageInventory && <Button type="button" size="sm" variant="outline" onClick={() => openEdit(item)}><Pencil size={14}/> Редактировать</Button>}
              {canManageInventory && <Button type="button" size="sm" variant="outline" className="text-red-600" disabled={busyId === item.id} onClick={() => void deleteInventory(item)}><Trash2 size={14}/> {busyId === item.id ? "Удаление..." : "Удалить"}</Button>}
            </div>
          </div>
          <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">Excel прикреплён к этому снимку логически: кнопка формирует файл именно по остаткам, зафиксированным в указанную дату и время, а не по текущему складу.</div>
        </div>;
      })}
      {!inventories.length && <div className="rounded-2xl border border-dashed bg-white/70 p-8 text-center text-sm text-slate-400">Инвентаризаций пока нет. Нажмите «Зафиксировать остатки сейчас» — снимок сразу появится здесь.</div>}
    </div>}
  </div>, mount);

  return <>
    {portal}
    {editing && createPortal(<div className="fixed inset-0 z-[50000] flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) setEditing(null); }}>
      <div className="max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-[28px] border bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b p-5 sm:p-6">
          <div><div className="text-xs font-black uppercase tracking-[.14em] text-blue-600">Редактирование снимка</div><h2 className="mt-1 text-2xl font-black">Инвентаризация · {dateText(editing.createdAt)}</h2><p className="mt-1 text-sm text-slate-500">Меняются только данные сохранённого снимка. Текущие остатки склада это действие не изменяет.</p></div>
          <button type="button" onClick={() => setEditing(null)} className="rounded-xl p-2 hover:bg-slate-100"><X/></button>
        </div>
        <div className="max-h-[60vh] overflow-auto p-4 sm:p-6">
          <div className="space-y-2">{editRows.map((row, index) => <div key={`${row.productId || row.name}-${row.cellId || row.cellCode}-${index}`} className="grid gap-3 rounded-xl border p-3 sm:grid-cols-[1fr_180px] sm:items-center">
            <div className="min-w-0"><div className="truncate font-bold">{row.name || "Материал"}</div><div className="mt-0.5 text-xs text-slate-500">{row.sku || "без артикула"} · {row.cellCode || "без ячейки"} · {row.unit || ""}</div></div>
            <label className="text-xs font-semibold text-slate-600">Количество<input type="number" min="0" step="0.000000001" value={Number(row.quantity || 0)} onChange={(e) => setEditRows((current) => current.map((x, i) => i === index ? { ...x, quantity: Math.max(0, Number(e.target.value) || 0) } : x))} className="mt-1 h-10 w-full rounded-xl border px-3 text-sm outline-none focus:border-blue-500"/></label>
          </div>)}</div>
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t bg-slate-50 p-4 sm:p-5"><Button type="button" variant="outline" onClick={() => setEditing(null)}>Отмена</Button><Button type="button" className="bg-blue-600 text-white hover:bg-blue-700" disabled={busyId === editing.id} onClick={() => void saveEdit()}><Save size={15}/> {busyId === editing.id ? "Сохранение..." : "Сохранить изменения"}</Button></div>
      </div>
    </div>, document.body)}
  </>;
}
