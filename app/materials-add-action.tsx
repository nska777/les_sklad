"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, FileSpreadsheet, Layers3, Loader2, PackagePlus, Plus } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Rack = { id: string; name: string; code: string };
type Cell = { id: string; rackId: string; code: string; rowIndex: number; columnIndex: number; blocked: boolean; side: "front" | "back" };
type Stock = { cellId: string; quantity: number };
type RackData = { racks: Rack[]; cells: Cell[]; stocks: Stock[] };
type User = { name?: string; role?: string };

function findMaterialsActionBar() {
  const headings = Array.from(document.querySelectorAll<HTMLElement>("h1"));
  const heading = headings.find((node) => node.textContent?.trim() === "Материалы склада");
  if (!heading) return null;
  const headerRow = heading.parentElement?.parentElement;
  if (!headerRow) return null;
  const children = Array.from(headerRow.children).filter((node): node is HTMLElement => node instanceof HTMLElement);
  return children.length > 1 ? children[children.length - 1] : null;
}

function hideDuplicateUserCard(actionBar: HTMLElement | null) {
  if (!actionBar) return;
  const roleWords = ["Администратор", "Заведующий", "Кладовщик", "Просмотр"];
  const children = Array.from(actionBar.children).filter((node): node is HTMLElement => node instanceof HTMLElement);
  for (const child of children) {
    if (child.matches("a,button")) continue;
    const text = child.textContent || "";
    if (roleWords.some((role) => text.includes(role))) {
      child.dataset.materialsDuplicateUserCard = "true";
      child.style.display = "none";
    }
  }
}

export function MaterialsAddAction() {
  const pathname = usePathname();
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [warehouse, setWarehouse] = useState<RackData>({ racks: [], cells: [], stocks: [] });
  const [user, setUser] = useState<User | null>(null);
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [rackId, setRackId] = useState("");
  const [side, setSide] = useState<"front" | "back">("front");
  const [shelf, setShelf] = useState("");
  const [cellId, setCellId] = useState("");

  useEffect(() => {
    if (pathname !== "/materials") {
      setTarget(null);
      return;
    }
    const resolve = () => {
      const actionBar = findMaterialsActionBar();
      hideDuplicateUserCard(actionBar);
      setTarget(actionBar);
    };
    resolve();
    const observer = new MutationObserver(resolve);
    observer.observe(document.body, { subtree: true, childList: true });
    const timer = window.setTimeout(resolve, 250);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
      document.querySelectorAll<HTMLElement>('[data-materials-duplicate-user-card="true"]').forEach((node) => {
        node.style.display = "";
        delete node.dataset.materialsDuplicateUserCard;
      });
    };
  }, [pathname]);

  const loadWarehouse = async () => {
    setLoading(true);
    try {
      const [warehouseResponse, meResponse] = await Promise.all([
        fetch("/api/rack-layout", { cache: "no-store" }),
        fetch("/api/auth/me", { cache: "no-store" }),
      ]);
      const result = await warehouseResponse.json() as Partial<RackData> & { error?: string };
      if (!warehouseResponse.ok) throw new Error(result.error || "Не удалось загрузить стеллажи");
      setWarehouse({
        racks: Array.isArray(result.racks) ? result.racks : [],
        cells: Array.isArray(result.cells) ? result.cells : [],
        stocks: Array.isArray(result.stocks) ? result.stocks : [],
      });
      if (meResponse.ok) {
        const me = await meResponse.json() as { user?: User };
        setUser(me.user || null);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось загрузить данные склада");
    } finally {
      setLoading(false);
    }
  };

  const occupiedCellIds = useMemo(
    () => new Set(warehouse.stocks.filter((stock) => Number(stock.quantity) > 0).map((stock) => stock.cellId)),
    [warehouse.stocks],
  );

  const rackCells = useMemo(
    () => warehouse.cells.filter((cell) => cell.rackId === rackId && !cell.blocked && !occupiedCellIds.has(cell.id)),
    [warehouse.cells, rackId, occupiedCellIds],
  );
  const hasBack = rackCells.some((cell) => cell.side === "back");
  const sideCells = rackCells.filter((cell) => cell.side === side);
  const shelves = useMemo(
    () => Array.from(new Set(sideCells.map((cell) => cell.rowIndex))).sort((a, b) => a - b),
    [sideCells],
  );
  const destinationCells = useMemo(() => {
    if (shelf === "") return [];
    return sideCells.filter((cell) => cell.rowIndex === Number(shelf)).sort((a, b) => a.columnIndex - b.columnIndex);
  }, [sideCells, shelf]);

  useEffect(() => {
    setSide("front");
    setShelf("");
    setCellId("");
  }, [rackId]);

  useEffect(() => {
    if (side === "back" && !hasBack) setSide("front");
    setShelf("");
    setCellId("");
  }, [side, hasBack]);

  useEffect(() => {
    setCellId("");
  }, [shelf]);

  const openManual = () => {
    setName("");
    setQuantity("");
    setRackId("");
    setSide("front");
    setShelf("");
    setCellId("");
    setOpen(true);
    void loadWarehouse();
  };

  const saveManual = async () => {
    const amount = Number(quantity);
    if (!name.trim()) return toast.error("Введите название материала");
    if (!Number.isFinite(amount) || amount <= 0) return toast.error("Введите фактическое количество");
    if (!rackId || shelf === "" || !cellId) return toast.error("Выберите стеллаж, полку и ячейку");
    setSaving(true);
    try {
      const response = await fetch("/api/materials/manual-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          quantity: amount,
          cellId,
          unit: "шт.",
          category: "Фурнитура",
          operator: user?.name || "Кладовщик",
        }),
      });
      const result = await response.json() as { error?: string; product?: { sku?: string; barcode?: string }; placement?: { cellCode?: string } };
      if (!response.ok) throw new Error(result.error || "Не удалось создать материал");
      toast.success("Материал создан и размещён", {
        description: `${result.product?.sku || "RL-код создан"} · ячейка ${result.placement?.cellCode || "выбрана"}`,
      });
      setOpen(false);
      window.setTimeout(() => window.location.reload(), 350);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось создать материал");
    } finally {
      setSaving(false);
    }
  };

  if (pathname !== "/materials") return null;

  const buttons = (
    <>
      <Link href="/materials/excess" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-orange-200 bg-orange-50 px-4 py-2.5 text-sm font-bold text-orange-800 transition hover:bg-orange-100 active:scale-[.98]">
        <AlertTriangle size={17} /> Излишки
      </Link>
      <a href="/api/stock-export?scope=all" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-bold text-emerald-800 transition hover:bg-emerald-100 active:scale-[.98]" title="Скачать Excel с фактическими остатками всего склада">
        <FileSpreadsheet size={17} /> Остатки Excel
      </a>
      <Link href="/onec-materials" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-bold text-blue-800 transition hover:bg-blue-100 active:scale-[.98]">
        <Plus size={18} /> Добавить из 1С
      </Link>
      <button type="button" onClick={openManual} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-orange-500 px-5 py-2.5 text-sm font-bold text-white shadow-md shadow-orange-200/60 transition hover:bg-orange-600 active:scale-[.98]">
        <PackagePlus size={18} /> Добавить материал
      </button>
    </>
  );

  return (
    <>
      {target ? createPortal(buttons, target) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Добавить материал вручную</DialogTitle>
            <DialogDescription>Материал создаётся вне справочника 1С. Система сама присвоит постоянный RL-код и штрихкод, затем сразу разместит фактическое количество в выбранную ячейку.</DialogDescription>
          </DialogHeader>

          {loading ? <div className="flex min-h-48 items-center justify-center"><Loader2 className="animate-spin" /></div> : <div className="mt-3 space-y-5">
            <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
              <div><Label>Название материала *</Label><Input className="mt-2" value={name} onChange={(event) => setName(event.target.value)} placeholder="Например: Ручка мебельная 128 мм" autoFocus /></div>
              <div><Label>Количество *</Label><Input className="mt-2" type="number" min="0.001" step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} placeholder="0" /></div>
            </div>

            <div className="rounded-2xl border border-blue-100 bg-blue-50/50 p-4">
              <div className="mb-3 flex items-center gap-2 font-bold text-slate-800"><Layers3 size={18} className="text-blue-600" /> Сразу разместить на складе</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2"><Label>1. Стеллаж *</Label><select value={rackId} onChange={(event) => setRackId(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-black/10 bg-white px-3 text-sm"><option value="">Выберите стеллаж</option>{warehouse.racks.map((rack) => <option key={rack.id} value={rack.id}>{rack.code} · {rack.name}</option>)}</select></div>
                <div><Label>2. Сторона *</Label><select value={side} disabled={!rackId} onChange={(event) => setSide(event.target.value as "front" | "back")} className="mt-2 h-11 w-full rounded-xl border border-black/10 bg-white px-3 text-sm disabled:bg-slate-100"><option value="front">Лицевая</option>{hasBack && <option value="back">Задняя</option>}</select></div>
                <div><Label>3. Полка *</Label><select value={shelf} disabled={!rackId} onChange={(event) => setShelf(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-black/10 bg-white px-3 text-sm disabled:bg-slate-100"><option value="">{rackId ? "Выберите полку" : "Сначала стеллаж"}</option>{shelves.map((row) => <option key={row} value={row}>Полка {row + 1}</option>)}</select></div>
                <div className="sm:col-span-2"><Label>4. Ячейка *</Label><select value={cellId} disabled={shelf === ""} onChange={(event) => setCellId(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-black/10 bg-white px-3 text-sm disabled:bg-slate-100"><option value="">{shelf === "" ? "Сначала полка" : "Выберите свободную ячейку"}</option>{destinationCells.map((cell) => <option key={cell.id} value={cell.id}>{cell.code} · место {String.fromCharCode(65 + cell.columnIndex)}</option>)}</select></div>
              </div>
              <p className="mt-3 text-xs leading-5 text-slate-500">Показываются только существующие свободные ячейки выбранного стеллажа, стороны и полки. Занятые и заблокированные ячейки исключены.</p>
            </div>
          </div>}

          <DialogFooter className="mt-5">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Отмена</Button>
            <Button type="button" className="accent-button" disabled={saving || loading || !name.trim() || Number(quantity) <= 0 || !cellId} onClick={() => void saveManual()}>
              {saving ? <Loader2 className="animate-spin" /> : <PackagePlus />} Создать и разместить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
