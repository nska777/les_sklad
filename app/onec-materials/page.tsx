"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { ArrowLeft, Database, Loader2, PackagePlus, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

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
};

type Cell = { id: string; code: string; blocked: boolean };
type ApiResult = { items: Item[]; stats: { total: number; linked: number }; error?: string };

export default function OneCMaterialsPage() {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [stats, setStats] = useState({ total: 0, linked: 0 });
  const [cells, setCells] = useState<Cell[]>([]);
  const [selected, setSelected] = useState<Item | null>(null);
  const [cellId, setCellId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [operator, setOperator] = useState("Кладовщик");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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
      } catch { /* основная ошибка будет видна при размещении */ }
    })();
  }, []);

  const openPlacement = (item: Item) => {
    setSelected(item);
    setCellId("");
    setQuantity("1");
  };

  const place = async () => {
    if (!selected || !cellId || Number(quantity) <= 0) return toast.error("Выберите ячейку и количество");
    setSaving(true);
    try {
      const response = await fetch("/api/onec-materials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "place", onecMaterialId: selected.id, cellId, quantity: Number(quantity), operator }),
      });
      const result = await response.json() as { error?: string; internalCode?: string };
      if (!response.ok) throw new Error(result.error || "Не удалось разместить материал");
      toast.success("Материал размещён", { description: result.internalCode ? `Код: ${result.internalCode}` : undefined });
      setSelected(null);
      await loadItems(query);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось разместить материал");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="min-h-screen px-4 py-6 text-[var(--foreground)] sm:px-7">
      <div className="mx-auto max-w-[1500px] space-y-5">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <Link href="/" className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-[#315840] hover:underline"><ArrowLeft size={16} /> Назад в склад</Link>
            <p className="eyebrow">Справочник 1С</p>
            <h1 className="page-title">Материалы из 1С</h1>
            <p className="page-description">Поиск начинается с первых введённых букв. Справочник не меняет фактический склад, пока материал не будет размещён в ячейке.</p>
          </div>
          <div className="flex gap-3">
            <div className="metric-card min-w-36"><div><p>В справочнике</p><strong>{stats.total}</strong></div><Database /></div>
            <div className="metric-card min-w-36"><div><p>Уже заведено</p><strong>{stats.linked}</strong></div><PackagePlus /></div>
          </div>
        </div>

        <section className="panel overflow-hidden">
          <div className="border-b border-black/7 p-4 sm:p-5">
            <div className="relative max-w-3xl">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#7d8981]" size={19} />
              <Input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Начните вводить: Hettich, евровинт, шуруп..." className="h-12 pl-11 text-base" />
              {loading && <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-[#7d8981]" size={18} />}
            </div>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Материал</TableHead><TableHead className="text-right">По 1С</TableHead><TableHead className="text-right">Резерв / вычет</TableHead><TableHead className="text-right">Доступно</TableHead><TableHead className="text-right">Размещено</TableHead><TableHead>Внутренний код</TableHead><TableHead className="w-36" /></TableRow></TableHeader>
              <TableBody>{items.map((item) => {
                const left = item.available1c - item.placedQuantity;
                return <TableRow key={item.id}>
                  <TableCell className="min-w-[340px]"><div className="font-semibold">{item.name}</div><div className="mt-1 text-xs text-[#7a877f]">Строка Excel: {item.sourceRow}</div></TableCell>
                  <TableCell className="text-right font-semibold">{item.quantity1c.toLocaleString("ru-RU")}</TableCell>
                  <TableCell className="text-right">{item.reserved1c ? item.reserved1c.toLocaleString("ru-RU") : "—"}</TableCell>
                  <TableCell className="text-right font-semibold">{item.available1c.toLocaleString("ru-RU")}</TableCell>
                  <TableCell className="text-right"><div className="font-semibold">{item.placedQuantity.toLocaleString("ru-RU")}</div><div className={`text-xs ${left < 0 ? "text-red-600" : "text-[#7a877f]"}`}>Осталось: {left.toLocaleString("ru-RU")}</div></TableCell>
                  <TableCell>{item.internalCode ? <span className="rounded-lg bg-[#e7eee9] px-2.5 py-1 font-mono text-xs font-bold text-[#315840]">{item.internalCode}</span> : <span className="text-sm text-[#7a877f]">Создастся автоматически</span>}</TableCell>
                  <TableCell><Button onClick={() => openPlacement(item)} className="accent-button"><PackagePlus /> Разместить</Button></TableCell>
                </TableRow>;
              })}</TableBody>
            </Table>
            {!loading && !items.length && <div className="p-12 text-center text-[#748078]">Совпадений не найдено</div>}
          </div>
        </section>
      </div>

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="sm:max-w-2xl">
          {selected && <>
            <DialogHeader><DialogTitle>Разместить материал на складе</DialogTitle><DialogDescription>При первом размещении система автоматически создаст постоянный код товара и его QR/штрихкод.</DialogDescription></DialogHeader>
            <div className="mt-4 rounded-2xl border border-black/10 bg-[#f7f9f7] p-4">
              <div className="font-bold">{selected.name}</div>
              <div className="mt-2 grid gap-2 text-sm sm:grid-cols-3"><span>По 1С: <b>{selected.quantity1c.toLocaleString("ru-RU")}</b></span><span>Доступно: <b>{selected.available1c.toLocaleString("ru-RU")}</b></span><span>Размещено: <b>{selected.placedQuantity.toLocaleString("ru-RU")}</b></span></div>
              {selected.internalCode && <div className="mt-4 flex items-center gap-4 rounded-xl bg-white p-3"><QRCodeSVG value={selected.barcode || selected.internalCode} size={72} /><div><div className="text-xs text-[#7a877f]">Внутренний код товара</div><div className="font-mono text-lg font-bold">{selected.internalCode}</div></div></div>}
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div><Label>Стеллаж / полка / ячейка</Label><NativeSelect value={cellId} onChange={(event) => setCellId(event.target.value)} className="mt-2 w-full"><NativeSelectOption value="">Выберите ячейку</NativeSelectOption>{cells.map((cell) => <NativeSelectOption key={cell.id} value={cell.id}>{cell.code}</NativeSelectOption>)}</NativeSelect></div>
              <div><Label>Фактическое количество</Label><Input type="number" min="0.001" step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="mt-2" /></div>
              <div className="sm:col-span-2"><Label>Кто разместил</Label><Input value={operator} onChange={(event) => setOperator(event.target.value)} className="mt-2" /></div>
            </div>
            <DialogFooter className="mt-6"><Button variant="outline" onClick={() => setSelected(null)}>Отмена</Button><Button disabled={saving || !cellId || Number(quantity) <= 0} onClick={() => void place()} className="accent-button">{saving ? <Loader2 className="animate-spin" /> : <PackagePlus />} Разместить</Button></DialogFooter>
          </>}
        </DialogContent>
      </Dialog>
    </main>
  );
}
