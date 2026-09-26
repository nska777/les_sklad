"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Download, FileSpreadsheet, RefreshCw, Trash2 } from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type Rack = { id: string; code: string; name: string; storageType: string };
type Cell = { id: string; rackId: string; code: string; rowIndex?: number; columnIndex?: number };
type Product = { id: string; name: string; sku: string; barcode: string; oneCId?: string | null; category: string; subcategory: string; brand: string; color: string; ral: string; unit: string; packType: string; packSize: number };
type Stock = { productId: string; cellId: string; quantity: number };
type Movement = { id: string; type: string; productId: string; productName: string; productSku: string; productUnit: string; fromCellCode: string; toCellCode: string; quantity: number; recipient: string; comment: string; operator: string; documentNumber: string; sourceName: string; sourceLocation: string; createdAt: string };
type Inventory = { id: string; createdBy: string; createdAt: string; snapshotJson: string };
type Snapshot = { warehouse?: { code: string; name: string }; racks: Rack[]; cells: Cell[]; products: Product[]; stocks: Stock[]; movements: Movement[]; inventories: Inventory[]; error?: string };
type InventoryRow = { productId?: string; name?: string; sku?: string; unit?: string; cellId?: string; cellCode?: string; quantity?: number };

type Mounts = { storage: HTMLElement | null; receipt: HTMLElement | null; issue: HTMLElement | null; inventory: HTMLElement | null; inventoryList: HTMLElement | null };
const emptyMounts: Mounts = { storage: null, receipt: null, issue: null, inventory: null, inventoryList: null };
const fmt = (v: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 9 }).format(v);
const stamp = () => new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
const dateText = (v: string) => new Date(v).toLocaleString("ru-RU");

function titleRows(title: string, subtitle: string, headers: string[], rows: Array<Array<string | number>>) {
  return [[title], [subtitle], [`Сформировано: ${new Date().toLocaleString("ru-RU")}`], [], headers, ...rows];
}

function styleSheet(ws: XLSX.WorkSheet, widths: number[]) {
  ws["!cols"] = widths.map((wch) => ({ wch }));
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");
  ws["!merges"] = [XLSX.utils.decode_range(`A1:${XLSX.utils.encode_col(range.e.c)}1`), XLSX.utils.decode_range(`A2:${XLSX.utils.encode_col(range.e.c)}2`), XLSX.utils.decode_range(`A3:${XLSX.utils.encode_col(range.e.c)}3`)];
  ws["!autofilter"] = { ref: `A5:${XLSX.utils.encode_col(range.e.c)}${range.e.r + 1}` };
  ws["!rows"] = [{ hpt: 28 }, { hpt: 20 }, { hpt: 18 }, { hpt: 8 }, { hpt: 22 }];
}

function addSheet(wb: XLSX.WorkBook, name: string, title: string, subtitle: string, headers: string[], rows: Array<Array<string | number>>, widths: number[]) {
  const ws = XLSX.utils.aoa_to_sheet(titleRows(title, subtitle, headers, rows));
  styleSheet(ws, widths);
  XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
}

function saveWorkbook(wb: XLSX.WorkBook, name: string) {
  XLSX.writeFile(wb, `${name}_${stamp()}.xlsx`, { compression: true });
}

function locationText(cell: Cell | undefined, rack: Rack | undefined) {
  if (!cell) return "—";
  if (rack?.storageType === "floor") return `Напольная зона ${rack.code} · ${cell.code}`;
  const shelf = typeof cell.rowIndex === "number" ? ` · полка ${cell.rowIndex + 1}` : "";
  return `Стеллаж ${rack?.code || "—"} · ${cell.code}${shelf}`;
}

export function WarehouseExcelTools() {
  const [mounts, setMounts] = useState<Mounts>(emptyMounts);
  const [data, setData] = useState<Snapshot | null>(null);
  const [busyId, setBusyId] = useState("");

  const load = useCallback(async () => {
    const r = await fetch("/api/department-warehouse", { cache: "no-store" });
    const body = await r.json() as Snapshot;
    if (!r.ok) throw new Error(body.error || "Не удалось загрузить склад");
    setData(body);
    return body;
  }, []);

  useEffect(() => {
    void load().catch(() => undefined);
    const timer = window.setInterval(() => void load().catch(() => undefined), 5000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    const created: HTMLElement[] = [];
    let hiddenInventoryList: HTMLElement | null = null;
    const findHeading = (text: string) => Array.from(document.querySelectorAll("h2")).find((node) => node.textContent?.trim() === text) as HTMLElement | undefined;
    const createMount = (heading: HTMLElement, key: keyof Omit<Mounts, "inventoryList">) => {
      if (mounts[key]) return;
      const el = document.createElement("span");
      el.className = "ml-3 inline-flex align-middle";
      heading.insertAdjacentElement("afterend", el);
      created.push(el);
      setMounts((cur) => ({ ...cur, [key]: el }));
    };
    const locate = () => {
      const storage = findHeading("Склад в 3D"); if (storage) createMount(storage, "storage");
      const receipt = findHeading("Приход и оприходование"); if (receipt) createMount(receipt, "receipt");
      const issue = findHeading("Выдача / смешивание"); if (issue) createMount(issue, "issue");
      const inventory = findHeading("Инвентаризация");
      if (inventory) {
        createMount(inventory, "inventory");
        const section = inventory.closest("section");
        if (section && !mounts.inventoryList) {
          const oldList = Array.from(section.children).find((node) => node instanceof HTMLElement && node.classList.contains("mt-5")) as HTMLElement | undefined;
          if (oldList) { oldList.style.display = "none"; hiddenInventoryList = oldList; }
          const el = document.createElement("div"); el.className = "mt-5"; section.appendChild(el); created.push(el); setMounts((cur) => ({ ...cur, inventoryList: el }));
        }
      }
    };
    locate();
    const timer = window.setInterval(locate, 350);
    return () => { window.clearInterval(timer); created.forEach((el) => el.remove()); if (hiddenInventoryList) hiddenInventoryList.style.display = ""; };
  }, [mounts]);

  const exportStorage = async () => {
    try {
      const d = await load();
      const productById = new Map(d.products.map((p) => [p.id, p]));
      const cellById = new Map(d.cells.map((c) => [c.id, c]));
      const rackById = new Map(d.racks.map((r) => [r.id, r]));
      const active = d.stocks.filter((s) => Number(s.quantity) > 0);
      const totals = new Map<string, number>();
      active.forEach((s) => totals.set(s.productId, (totals.get(s.productId) || 0) + Number(s.quantity)));
      const wb = XLSX.utils.book_new();
      addSheet(wb, "Сводка", "СКЛАД КРАСКИ — СВОДКА ОСТАТКОВ", `Материалов: ${totals.size} · занятых мест: ${new Set(active.map((s) => s.cellId)).size}`, ["Материал", "Артикул", "ID 1С", "Штрихкод", "Категория", "Ед.", "Общий остаток", "Мест хранения"], d.products.filter((p) => totals.has(p.id)).map((p) => [p.name, p.sku, p.oneCId || "", p.barcode, p.category, p.unit, totals.get(p.id) || 0, active.filter((s) => s.productId === p.id).length]), [42, 18, 18, 22, 18, 10, 16, 16]);
      addSheet(wb, "По ячейкам", "СКЛАД КРАСКИ — ФАКТИЧЕСКОЕ ХРАНЕНИЕ", "Все материалы, которые физически размещены по стеллажам, ячейкам и напольным зонам", ["Материал", "Артикул", "Штрихкод", "Ед.", "Количество", "Место хранения", "Код ячейки", "Стеллаж/зона"], active.map((s) => { const p = productById.get(s.productId); const c = cellById.get(s.cellId); const r = c ? rackById.get(c.rackId) : undefined; return [p?.name || "", p?.sku || "", p?.barcode || "", p?.unit || "", Number(s.quantity), locationText(c, r), c?.code || "", r?.code || ""]; }), [42, 18, 22, 10, 16, 38, 14, 16]);
      saveWorkbook(wb, "Склад_краски_остатки"); toast.success("Excel склада сформирован");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Не удалось сформировать Excel"); }
  };

  const exportMovements = async (kind: "receipt" | "issue") => {
    try {
      const d = await load();
      const rows = d.movements.filter((m) => kind === "receipt" ? m.type === "Приход" : m.type.includes("Выдача"));
      const wb = XLSX.utils.book_new();
      const title = kind === "receipt" ? "СКЛАД КРАСКИ — ЖУРНАЛ ПРИХОДОВ" : "СКЛАД КРАСКИ — ЖУРНАЛ ВЫДАЧ";
      const summary = new Map<string, { name: string; sku: string; unit: string; quantity: number }>();
      rows.forEach((m) => { const cur = summary.get(m.productId) || { name: m.productName, sku: m.productSku, unit: m.productUnit, quantity: 0 }; cur.quantity += Number(m.quantity); summary.set(m.productId, cur); });
      addSheet(wb, kind === "receipt" ? "Приходы" : "Выдачи", title, `Операций: ${rows.length}`, ["Дата/время", "Материал", "Артикул", "Количество", "Ед.", kind === "receipt" ? "Куда" : "Откуда", "Документ", kind === "receipt" ? "От кого" : "Получатель", kind === "receipt" ? "Откуда пришло" : "Тип операции", "Оператор", "Комментарий"], rows.map((m) => [dateText(m.createdAt), m.productName, m.productSku, Number(m.quantity), m.productUnit, kind === "receipt" ? m.toCellCode : m.fromCellCode, m.documentNumber, kind === "receipt" ? m.sourceName : m.recipient, kind === "receipt" ? m.sourceLocation : m.type, m.operator, m.comment]), [20, 42, 18, 14, 10, 14, 18, 24, 24, 20, 34]);
      addSheet(wb, "Сводка", `${title} — СВОДКА`, "Итоги сгруппированы по материалу", ["Материал", "Артикул", "Ед.", "Итого"], Array.from(summary.values()).map((x) => [x.name, x.sku, x.unit, x.quantity]), [44, 20, 10, 16]);
      saveWorkbook(wb, kind === "receipt" ? "Склад_краски_приходы" : "Склад_краски_выдачи"); toast.success("Excel сформирован");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Не удалось сформировать Excel"); }
  };

  const inventories = useMemo(() => data?.inventories || [], [data?.inventories]);
  const inventoryRows = (item: Inventory) => { try { const value = JSON.parse(item.snapshotJson) as unknown; return Array.isArray(value) ? value as InventoryRow[] : []; } catch { return []; } };

  const exportInventory = (item: Inventory) => {
    const rows = inventoryRows(item);
    const wb = XLSX.utils.book_new();
    const cellById = new Map((data?.cells || []).map((c) => [c.id, c]));
    const rackById = new Map((data?.racks || []).map((r) => [r.id, r]));
    const totals = new Map<string, { name: string; sku: string; unit: string; quantity: number }>();
    rows.forEach((r) => { const key = r.productId || `${r.name}-${r.sku}`; const cur = totals.get(key) || { name: r.name || "", sku: r.sku || "", unit: r.unit || "", quantity: 0 }; cur.quantity += Number(r.quantity || 0); totals.set(key, cur); });
    addSheet(wb, "Остатки", "ИНВЕНТАРИЗАЦИЯ СКЛАДА КРАСКИ", `Дата: ${dateText(item.createdAt)} · Снял: ${item.createdBy}`, ["Материал", "Артикул", "Количество", "Ед.", "Ячейка", "Место хранения"], rows.map((r) => { const c = r.cellId ? cellById.get(r.cellId) : undefined; const rack = c ? rackById.get(c.rackId) : undefined; return [r.name || "", r.sku || "", Number(r.quantity || 0), r.unit || "", r.cellCode || c?.code || "", locationText(c, rack)]; }), [44, 20, 16, 10, 14, 36]);
    addSheet(wb, "Сводка", "ИНВЕНТАРИЗАЦИЯ — СВОДКА", `Позиций: ${rows.length}`, ["Материал", "Артикул", "Ед.", "Общий остаток"], Array.from(totals.values()).map((x) => [x.name, x.sku, x.unit, x.quantity]), [44, 20, 10, 18]);
    saveWorkbook(wb, `Инвентаризация_${item.createdAt.slice(0, 10)}`);
  };

  const deleteInventory = async (item: Inventory) => {
    if (!confirm(`Удалить инвентаризацию от ${dateText(item.createdAt)}?`)) return;
    setBusyId(item.id);
    try {
      const r = await fetch("/api/department-warehouse-inventory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", id: item.id }) });
      const body = await r.json() as { error?: string };
      if (!r.ok) throw new Error(body.error || "Не удалось удалить инвентаризацию");
      await load(); toast.success("Инвентаризация удалена");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Не удалось удалить"); }
    finally { setBusyId(""); }
  };

  const excelButton = (label: string, action: () => void) => <Button type="button" variant="outline" size="sm" className="border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100" onClick={action}><FileSpreadsheet size={15}/> {label}</Button>;

  return <>
    {mounts.storage ? createPortal(excelButton("Excel остатков", () => void exportStorage()), mounts.storage) : null}
    {mounts.receipt ? createPortal(excelButton("Excel приходов", () => void exportMovements("receipt")), mounts.receipt) : null}
    {mounts.issue ? createPortal(excelButton("Excel выдач", () => void exportMovements("issue")), mounts.issue) : null}
    {mounts.inventory ? createPortal(<span className="inline-flex gap-2">{excelButton("Excel всех снимков", () => {
      const wb = XLSX.utils.book_new(); inventories.forEach((item, i) => { const rows = inventoryRows(item); addSheet(wb, `Инв_${i + 1}`, `ИНВЕНТАРИЗАЦИЯ ${dateText(item.createdAt)}`, `Снял: ${item.createdBy}`, ["Материал", "Артикул", "Количество", "Ед.", "Ячейка"], rows.map((r) => [r.name || "", r.sku || "", Number(r.quantity || 0), r.unit || "", r.cellCode || ""]), [44, 20, 16, 10, 14]); }); if (inventories.length) saveWorkbook(wb, "Инвентаризации_склад_краски"); else toast.info("Инвентаризаций пока нет"); })}<Button type="button" variant="outline" size="sm" onClick={() => void load()}><RefreshCw size={15}/> Обновить</Button></span>, mounts.inventory) : null}
    {mounts.inventoryList ? createPortal(<div className="space-y-2">{inventories.map((item) => { const rows = inventoryRows(item); return <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-3"><div><b>{dateText(item.createdAt)}</b><div className="text-xs text-slate-500">Снял: {item.createdBy} · позиций: {rows.length}</div></div><div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" className="text-emerald-700" onClick={() => exportInventory(item)}><Download size={14}/> Excel</Button><Button type="button" size="sm" variant="outline" className="text-red-600" disabled={busyId === item.id} onClick={() => void deleteInventory(item)}><Trash2 size={14}/> {busyId === item.id ? "Удаление..." : "Удалить"}</Button></div></div>; })}{!inventories.length && <div className="rounded-xl border border-dashed p-8 text-center text-sm text-slate-400">Снимков остатков пока нет</div>}</div>, mounts.inventoryList) : null}
  </>;
}
