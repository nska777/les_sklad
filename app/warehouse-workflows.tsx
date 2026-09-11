"use client";

import { FormEvent, useMemo, useState } from "react";
import { ArrowDownToLine, ArrowRightLeft, ArrowUpFromLine, ClipboardList, FileText, Loader2, PackageCheck, ScanLine } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { TabsContent } from "@/components/ui/tabs";
import { QRCodeSVG } from "qrcode.react";

type Product = { id: string; name: string; sku: string; unit: string };
type Cell = { id: string; code: string; blocked: boolean };
type Stock = { productId: string; cellId: string; quantity: number };
type Document = { id: string; number: string; type: "receipt" | "issue"; status: string; recipient: string; productId: string; productName: string; productUnit: string; plannedQuantity: number; processedQuantity: number };

type Props = {
  products: Product[];
  cells: Cell[];
  stocks: Stock[];
  documents: Document[];
  operator: string;
  setOperator: (value: string) => void;
  reload: () => Promise<void>;
};

export function WarehouseWorkflows({ products, cells, stocks, documents, operator, setOperator, reload }: Props) {
  const [saving, setSaving] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState("");
  const [issueCell, setIssueCell] = useState("");
  const [issueQuantity, setIssueQuantity] = useState("");
  const [scan, setScan] = useState("");
  const [transferProduct, setTransferProduct] = useState("");
  const [transferFrom, setTransferFrom] = useState("");
  const issueDocuments = documents.filter((document) => document.type === "issue" && document.status !== "completed");
  const activeIssue = issueDocuments.find((document) => document.id === selectedIssue) || issueDocuments[0];
  const locations = activeIssue ? stocks.filter((stock) => stock.productId === activeIssue.productId && stock.quantity > 0) : [];
  const totals = useMemo(() => new Map(products.map((product) => [product.id, stocks.filter((stock) => stock.productId === product.id).reduce((sum, stock) => sum + stock.quantity, 0)])), [products, stocks]);
  const transferLocations = stocks.filter((stock) => stock.productId === transferProduct && stock.quantity > 0);

  const post = async (payload: Record<string, unknown>) => {
    const response = await fetch("/api/warehouse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const result = await response.json() as { error?: string };
    if (!response.ok) throw new Error(result.error || "Операция не выполнена");
    await reload();
  };

  const receive = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget); setSaving(true);
    try {
      await post({ action: "receiveStock", documentNumber: form.get("documentNumber"), supplier: form.get("supplier"), oneCId: form.get("oneCId"), productId: form.get("productId"), cellId: form.get("cellId"), quantity: form.get("quantity"), comment: form.get("comment"), operator });
      event.currentTarget.reset(); toast.success("Товар принят и размещён");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Ошибка приёмки"); } finally { setSaving(false); }
  };

  const createIssue = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget); setSaving(true);
    try {
      await post({ action: "createIssue", documentNumber: form.get("documentNumber"), recipient: form.get("recipient"), oneCId: form.get("oneCId"), productId: form.get("productId"), quantity: form.get("quantity"), comment: form.get("comment"), operator });
      event.currentTarget.reset(); toast.success("Задание на выдачу создано");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Ошибка задания"); } finally { setSaving(false); }
  };

  const scanCell = (event: FormEvent) => {
    event.preventDefault(); const value = scan.trim().toUpperCase(); const cell = cells.find((item) => item.code.toUpperCase() === value);
    const location = cell && locations.find((item) => item.cellId === cell.id);
    if (!cell || cell.blocked || !location) { toast.error("В этой ячейке нет материала из задания"); return; }
    setIssueCell(cell.id); setIssueQuantity(String(Math.min(location.quantity, (activeIssue?.plannedQuantity || 0) - (activeIssue?.processedQuantity || 0)))); setScan(""); toast.success(`Ячейка ${cell.code} подтверждена`);
  };

  const issue = async () => {
    if (!activeIssue || !issueCell || Number(issueQuantity) <= 0) return toast.error("Выберите задание, ячейку и количество");
    setSaving(true);
    try { await post({ action: "issueStock", documentId: activeIssue.id, cellId: issueCell, quantity: Number(issueQuantity), operator }); setIssueCell(""); setIssueQuantity(""); toast.success(`Материал выдан: ${activeIssue.recipient}`); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Ошибка выдачи"); } finally { setSaving(false); }
  };

  const transfer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget); setSaving(true);
    try {
      await post({ action: "transferStock", productId: transferProduct, fromCellId: transferFrom,
        toCellId: form.get("toCellId"), quantity: form.get("quantity"), comment: form.get("comment"), operator });
      event.currentTarget.reset(); setTransferProduct(""); setTransferFrom("");
      toast.success("Материал перемещён", { description: "Остатки обеих ячеек обновлены" });
    } catch (error) { toast.error(error instanceof Error ? error.message : "Ошибка перемещения"); }
    finally { setSaving(false); }
  };

  return <>
    <TabsContent value="receipt" className="space-y-5">
      <div><p className="eyebrow">Фактический приход</p><h1 className="page-title">Принять товар</h1><p className="page-description">Сверьте накладную, укажите реальное количество и сразу положите материал в ячейку.</p></div>
      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <form onSubmit={receive} className="panel p-5 sm:p-7"><div className="panel-title"><div><span>Документ приёмки</span><h2>Что приехало и куда положили</h2></div><ArrowDownToLine /></div><div className="form-grid">
          <div><Label>Номер накладной *</Label><Input name="documentNumber" required placeholder="ПР-000145" /></div><div><Label>Поставщик</Label><Input name="supplier" placeholder="Название поставщика" /></div>
          <div className="sm:col-span-2"><Label>Материал *</Label><NativeSelect name="productId" required className="w-full"><NativeSelectOption value="">Выберите материал</NativeSelectOption>{products.map((p) => <NativeSelectOption key={p.id} value={p.id}>{p.name} · {p.sku}</NativeSelectOption>)}</NativeSelect></div>
          <div><Label>Фактическое количество *</Label><Input name="quantity" type="number" min="0.001" step="any" required placeholder="500" /></div><div><Label>Ячейка *</Label><NativeSelect name="cellId" required className="w-full"><NativeSelectOption value="">Выберите ячейку</NativeSelectOption>{cells.filter((c) => !c.blocked).map((c) => <NativeSelectOption key={c.id} value={c.id}>{c.code}</NativeSelectOption>)}</NativeSelect></div>
          <div><Label>ID документа 1С</Label><Input name="oneCId" placeholder="Необязательно" /></div><div><Label>Кладовщик</Label><Input value={operator} onChange={(e) => setOperator(e.target.value)} /></div><div className="sm:col-span-2"><Label>Комментарий</Label><Input name="comment" placeholder="Повреждения или расхождения" /></div>
        </div><div className="mt-6 flex justify-end"><Button disabled={saving || !products.length || !cells.length} className="h-11 bg-[#173f2b] text-white">{saving ? <Loader2 className="animate-spin" /> : <PackageCheck />} Принять и разместить</Button></div></form>
        <aside className="rounded-2xl bg-[#173f2b] p-6 text-white"><p className="text-xs font-bold uppercase tracking-[.12em] text-[#afc8b6]">Порядок работы</p><ol className="workflow-list"><li><b>1</b><span>Сверьте товар с накладной</span></li><li><b>2</b><span>Пересчитайте фактическое количество</span></li><li><b>3</b><span>Выберите материал</span></li><li><b>4</b><span>Укажите ячейку хранения</span></li></ol><p className="mt-6 border-t border-white/15 pt-5 text-sm leading-6 text-[#c7d8cd]">Если штрихкода нет — добавьте материал. Система сама создаст внутренний QR-код для печати.</p></aside>
      </div>
    </TabsContent>
    <TabsContent value="transfer" className="space-y-5">
      <div><p className="eyebrow">Адресное хранение</p><h1 className="page-title">Переместить материал</h1><p className="page-description">Перенесите нужное количество из одной ячейки в другую. Общий остаток материала не изменится.</p></div>
      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <form onSubmit={transfer} className="panel p-5 sm:p-7">
          <div className="panel-title"><div><span>Внутреннее перемещение</span><h2>Откуда и куда перенести</h2></div><ArrowRightLeft /></div>
          <div className="form-grid mt-6">
            <div className="sm:col-span-2"><Label>Материал *</Label><NativeSelect value={transferProduct} onChange={(event) => { setTransferProduct(event.target.value); setTransferFrom(""); }} required className="w-full"><NativeSelectOption value="">Выберите материал с остатком</NativeSelectOption>{products.filter((product) => (totals.get(product.id) || 0) > 0).map((product) => <NativeSelectOption key={product.id} value={product.id}>{product.name} · всего {totals.get(product.id)} {product.unit}</NativeSelectOption>)}</NativeSelect></div>
            <div><Label>Из ячейки *</Label><NativeSelect value={transferFrom} onChange={(event) => setTransferFrom(event.target.value)} required className="w-full"><NativeSelectOption value="">Где материал лежит сейчас</NativeSelectOption>{transferLocations.map((stock) => <NativeSelectOption key={stock.cellId} value={stock.cellId}>{cells.find((cell) => cell.id === stock.cellId)?.code} · доступно {stock.quantity}</NativeSelectOption>)}</NativeSelect></div>
            <div><Label>В ячейку *</Label><NativeSelect name="toCellId" required className="w-full"><NativeSelectOption value="">Новое место хранения</NativeSelectOption>{cells.filter((cell) => !cell.blocked && cell.id !== transferFrom).map((cell) => <NativeSelectOption key={cell.id} value={cell.id}>{cell.code}</NativeSelectOption>)}</NativeSelect></div>
            <div><Label>Количество *</Label><Input name="quantity" type="number" min="0.001" step="any" required placeholder="Например, 25" /></div>
            <div><Label>Кладовщик</Label><Input value={operator} onChange={(event) => setOperator(event.target.value)} /></div>
            <div className="sm:col-span-2"><Label>Комментарий</Label><Input name="comment" placeholder="Причина перемещения — необязательно" /></div>
          </div>
          <Button disabled={saving || !transferProduct || !transferFrom} className="accent-button mt-6 h-12 w-full">{saving ? <Loader2 className="animate-spin" /> : <ArrowRightLeft />} Переместить и обновить остатки</Button>
        </form>
        <aside className="scan-console rounded-3xl p-6 text-white"><p className="text-xs font-bold uppercase tracking-[.12em] text-blue-200">Как это работает</p><ol className="workflow-list mt-5"><li><b>1</b><span>Выберите материал</span></li><li><b>2</b><span>Укажите текущую ячейку</span></li><li><b>3</b><span>Выберите новую ячейку</span></li><li><b>4</b><span>Введите переносимое количество</span></li></ol><p className="mt-6 border-t border-white/15 pt-5 text-sm leading-6 text-slate-300">Система уменьшит остаток в старой ячейке, увеличит его в новой и запишет обе операции в историю.</p></aside>
      </div>
    </TabsContent>
    <TabsContent value="issue" className="space-y-5">
      <div><p className="eyebrow">Расход материалов</p><h1 className="page-title">Выдать по документу</h1><p className="page-description">Создайте задание из бумаги или 1С, затем подтвердите ячейку и фактическую выдачу.</p></div>
      <div className="grid gap-5 xl:grid-cols-[.8fr_1.2fr]">
        <form onSubmit={createIssue} className="panel p-5 sm:p-7"><div className="panel-title"><div><span>Матбухгалтер</span><h2>Новое задание</h2></div><FileText /></div><div className="mt-6 space-y-4"><div><Label>Номер документа *</Label><Input name="documentNumber" required placeholder="ТР-000146" /></div><div><Label>Получатель / цех *</Label><Input name="recipient" required placeholder="Петров · Раскройный цех" /></div><div><Label>Материал *</Label><NativeSelect name="productId" required className="w-full"><NativeSelectOption value="">Выберите материал</NativeSelectOption>{products.map((p) => <NativeSelectOption key={p.id} value={p.id}>{p.name} · остаток {totals.get(p.id) || 0} {p.unit}</NativeSelectOption>)}</NativeSelect></div><div><Label>Количество *</Label><Input name="quantity" type="number" min="0.001" step="any" required placeholder="100" /></div><div><Label>ID документа 1С</Label><Input name="oneCId" placeholder="Необязательно" /></div><div><Label>Комментарий</Label><Input name="comment" placeholder="Для заказа или участка" /></div></div><Button disabled={saving || !products.length} className="mt-6 w-full bg-[#173f2b] text-white">{saving ? <Loader2 className="animate-spin" /> : <ClipboardList />} Создать задание</Button></form>
        <section className="panel p-5 sm:p-7"><div className="panel-title"><div><span>Кладовщик</span><h2>Подтвердить выдачу</h2></div><ArrowUpFromLine /></div>{!issueDocuments.length ? <div className="py-16 text-center text-sm text-[#748078]">Нет заданий, ожидающих выдачу</div> : <div className="mt-6 space-y-5">
          <div><Label>Задание</Label><NativeSelect value={activeIssue?.id || ""} onChange={(e) => { setSelectedIssue(e.target.value); setIssueCell(""); setIssueQuantity(""); }} className="w-full">{issueDocuments.map((d) => <NativeSelectOption key={d.id} value={d.id}>{d.number} · {d.productName} · {d.recipient}</NativeSelectOption>)}</NativeSelect></div>
          {activeIssue && <div className="rounded-xl border border-[#dfe7e1] bg-[#f7faf7] p-4"><div className="flex flex-wrap justify-between gap-3"><div><p className="text-xs text-[#748078]">Получатель</p><b>{activeIssue.recipient}</b></div><div className="text-right"><p className="text-xs text-[#748078]">Осталось выдать</p><b className="text-lg">{activeIssue.plannedQuantity - activeIssue.processedQuantity} {activeIssue.productUnit}</b></div></div><div className="mt-4 border-t border-black/7 pt-4"><b>{activeIssue.productName}</b><p className="mt-1 text-sm text-[#657269]">Где лежит: {locations.map((s) => `${cells.find((c) => c.id === s.cellId)?.code} — ${s.quantity}`).join(", ") || "остаток не найден"}</p></div></div>}
          <form onSubmit={scanCell}><Label>Сканируйте QR-код ячейки</Label><div className="mt-2 flex gap-2"><Input value={scan} onChange={(e) => setScan(e.target.value)} placeholder="Например, R01-A01" className="h-12 font-mono" /><Button type="submit" variant="outline" className="h-12"><ScanLine /> Проверить</Button></div></form>
          <div className="grid gap-4 sm:grid-cols-2"><div><Label>Подтверждённая ячейка</Label><NativeSelect value={issueCell} onChange={(e) => { const id = e.target.value; setIssueCell(id); const location = locations.find((x) => x.cellId === id); if (location && activeIssue) setIssueQuantity(String(Math.min(location.quantity, activeIssue.plannedQuantity - activeIssue.processedQuantity))); }} className="w-full"><NativeSelectOption value="">Отсканируйте или выберите</NativeSelectOption>{locations.map((s) => <NativeSelectOption key={s.cellId} value={s.cellId}>{cells.find((c) => c.id === s.cellId)?.code} · {s.quantity}</NativeSelectOption>)}</NativeSelect></div><div><Label>Фактически выдаётся</Label><Input value={issueQuantity} onChange={(e) => setIssueQuantity(e.target.value)} type="number" min="0.001" step="any" /></div></div>
          <div><Label>Кладовщик</Label><Input value={operator} onChange={(e) => setOperator(e.target.value)} /></div><Button disabled={saving || !activeIssue || !issueCell} onClick={() => void issue()} className="h-12 w-full bg-[#ef6b36] text-white">{saving ? <Loader2 className="animate-spin" /> : <PackageCheck />} Подтвердить фактическую выдачу</Button>
        </div>}</section>
      </div>
    </TabsContent>
  </>;
}

export function ProductLabels({ products }: { products: Array<Product & { barcode: string }> }) {
  const [selected, setSelected] = useState("");
  const product = products.find((item) => item.id === selected) || products[0];
  return <TabsContent value="labels" className="space-y-5">
    <div><p className="eyebrow">Товар без заводского кода</p><h1 className="page-title">Этикетки материалов</h1><p className="page-description">Выберите материал, распечатайте его внутренний QR-код и наклейте на пачку, коробку или рулон.</p></div>
    <div className="grid gap-5 lg:grid-cols-[1fr_420px]"><section className="panel p-5 sm:p-7"><Label>Материал</Label><NativeSelect value={product?.id || ""} onChange={(e) => setSelected(e.target.value)} className="mt-2 w-full"><NativeSelectOption value="">Выберите материал</NativeSelectOption>{products.map((item) => <NativeSelectOption key={item.id} value={item.id}>{item.name} · {item.sku}</NativeSelectOption>)}</NativeSelect><div className="mt-6 rounded-xl bg-blue-50/70 p-4 text-sm leading-6 text-slate-600"><b className="text-slate-900">Как использовать:</b><br />1. Наклейте этикетку на упаковку товара.<br />2. При размещении сканируйте сначала товар, затем QR ячейки.<br />3. Количество введите вручную или упаковками.</div></section>{product ? <section className="panel p-6"><div className="label-card"><QRCodeSVG value={product.barcode} size={190} level="M" /><strong>{product.barcode}</strong><b>{product.name}</b><small>{product.sku} · РУССКИЙ ЛЕС · СКЛАД</small></div><Button className="mt-4 w-full" variant="outline" onClick={() => window.print()}>Печать этикетки</Button></section> : <section className="panel flex min-h-80 items-center justify-center p-6 text-sm text-slate-500">Сначала добавьте материал</section>}</div>
  </TabsContent>;
}
