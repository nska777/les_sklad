"use client";

import { FormEvent, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRightLeft,
  ArrowUpFromLine,
  CheckCircle2,
  ClipboardList,
  FileText,
  Loader2,
  PackageCheck,
  Plus,
  QrCode,
  ScanLine,
  Trash2,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { ProductBarcode } from "@/components/product-barcode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { TabsContent } from "@/components/ui/tabs";

type Product = { id: string; name: string; sku: string; barcode: string; unit: string };
type Cell = { id: string; code: string; blocked: boolean };
type Stock = { productId: string; cellId: string; quantity: number };
type Document = {
  id: string;
  number: string;
  type: "receipt" | "issue";
  status: string;
  recipient: string;
  oneCId?: string | null;
  comment?: string;
  lineId: string;
  productId: string;
  productName: string;
  productSku?: string;
  productUnit: string;
  plannedQuantity: number;
  processedQuantity: number;
};
type IssueLineDraft = { id: string; productId: string; quantity: string };
type IssueGroup = {
  id: string;
  number: string;
  recipient: string;
  status: string;
  rows: Document[];
};

type Props = {
  products: Product[];
  cells: Cell[];
  stocks: Stock[];
  documents: Document[];
  operator: string;
  setOperator: (value: string) => void;
  reload: () => Promise<void>;
};

const qty = (value: number) => Number(value || 0).toLocaleString("ru-RU", { maximumFractionDigits: 3 });
const newDraftLine = (): IssueLineDraft => ({ id: crypto.randomUUID(), productId: "", quantity: "" });

export function WarehouseWorkflows({ products, cells, stocks, documents, operator, setOperator, reload }: Props) {
  const [saving, setSaving] = useState(false);
  const [transferProduct, setTransferProduct] = useState("");
  const [transferFrom, setTransferFrom] = useState("");

  const [issueNumber, setIssueNumber] = useState("");
  const [issueRecipient, setIssueRecipient] = useState("");
  const [issueOneCId, setIssueOneCId] = useState("");
  const [issueComment, setIssueComment] = useState("");
  const [issueDraftLines, setIssueDraftLines] = useState<IssueLineDraft[]>([newDraftLine()]);
  const [selectedIssue, setSelectedIssue] = useState("");
  const [selectedLine, setSelectedLine] = useState("");
  const [documentScan, setDocumentScan] = useState("");
  const [cellScan, setCellScan] = useState("");
  const [issueCell, setIssueCell] = useState("");
  const [issueQuantity, setIssueQuantity] = useState("");

  const totals = useMemo(() => new Map(products.map((product) => [
    product.id,
    stocks.filter((stock) => stock.productId === product.id).reduce((sum, stock) => sum + stock.quantity, 0),
  ])), [products, stocks]);
  const transferLocations = stocks.filter((stock) => stock.productId === transferProduct && stock.quantity > 0);

  const issueGroups = useMemo<IssueGroup[]>(() => {
    const grouped = new Map<string, IssueGroup>();
    for (const row of documents) {
      if (row.type !== "issue" || row.status === "completed") continue;
      const current = grouped.get(row.id) || { id: row.id, number: row.number, recipient: row.recipient, status: row.status, rows: [] };
      current.rows.push(row);
      grouped.set(row.id, current);
    }
    return Array.from(grouped.values());
  }, [documents]);

  const activeIssue = issueGroups.find((document) => document.id === selectedIssue) || issueGroups[0];
  const activeLine = activeIssue?.rows.find((row) => row.lineId === selectedLine)
    || activeIssue?.rows.find((row) => row.processedQuantity < row.plannedQuantity)
    || activeIssue?.rows[0];
  const activeProduct = products.find((product) => product.id === activeLine?.productId);
  const locations = activeLine ? stocks.filter((stock) => stock.productId === activeLine.productId && stock.quantity > 0) : [];
  const remainingLine = activeLine ? Math.max(0, activeLine.plannedQuantity - activeLine.processedQuantity) : 0;

  const postWarehouse = async (payload: Record<string, unknown>) => {
    const response = await fetch("/api/warehouse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json() as { error?: string };
    if (!response.ok) throw new Error(result.error || "Операция не выполнена");
    await reload();
  };

  const postIssue = async (payload: Record<string, unknown>, reloadAfter = true) => {
    const response = await fetch("/api/warehouse/issues", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json() as { error?: string; documentId?: string; completed?: boolean };
    if (!response.ok) throw new Error(result.error || "Операция выдачи не выполнена");
    if (reloadAfter) await reload();
    return result;
  };

  const receive = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    try {
      await postWarehouse({
        action: "receiveStock",
        documentNumber: form.get("documentNumber"),
        supplier: form.get("supplier"),
        oneCId: form.get("oneCId"),
        productId: form.get("productId"),
        cellId: form.get("cellId"),
        quantity: form.get("quantity"),
        comment: form.get("comment"),
        operator,
      });
      event.currentTarget.reset();
      toast.success("Товар принят и размещён");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка приёмки");
    } finally { setSaving(false); }
  };

  const createIssueDocument = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const rows = issueDraftLines.filter((line) => line.productId && Number(line.quantity) > 0);
    if (!issueNumber.trim() || !issueRecipient.trim() || !rows.length) {
      return toast.error("Укажите номер документа, получателя и хотя бы одну позицию");
    }
    setSaving(true);
    try {
      let documentId = "";
      for (const [index, row] of rows.entries()) {
        const result = await postIssue({
          action: "createOrAddLine",
          documentNumber: issueNumber,
          recipient: issueRecipient,
          oneCId: issueOneCId,
          comment: issueComment,
          productId: row.productId,
          quantity: Number(row.quantity),
          operator,
        }, index === rows.length - 1);
        documentId = result.documentId || documentId;
      }
      setIssueNumber("");
      setIssueRecipient("");
      setIssueOneCId("");
      setIssueComment("");
      setIssueDraftLines([newDraftLine()]);
      if (documentId) setSelectedIssue(documentId);
      toast.success("Документ выдачи создан", { description: `Позиций: ${rows.length}` });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось создать документ");
      await reload();
    } finally { setSaving(false); }
  };

  const scanDocument = (event: FormEvent) => {
    event.preventDefault();
    const raw = documentScan.trim();
    const normalized = raw.toUpperCase().startsWith("ISSUE:") ? raw.slice(6).trim().toUpperCase() : raw.toUpperCase();
    const found = issueGroups.find((document) => document.number.toUpperCase() === normalized || document.id.toUpperCase() === normalized);
    if (!found) return toast.error("Документ по этому QR не найден или уже закрыт");
    setSelectedIssue(found.id);
    const firstPending = found.rows.find((row) => row.processedQuantity < row.plannedQuantity);
    setSelectedLine(firstPending?.lineId || found.rows[0]?.lineId || "");
    setDocumentScan("");
    setIssueCell("");
    setIssueQuantity("");
    toast.success(`Документ ${found.number} открыт`);
  };

  const chooseLine = (lineId: string) => {
    setSelectedLine(lineId);
    setIssueCell("");
    setIssueQuantity("");
    setCellScan("");
  };

  const scanCell = (event: FormEvent) => {
    event.preventDefault();
    if (!activeLine) return toast.error("Сначала выберите позицию документа");
    const value = cellScan.trim().toUpperCase();
    const cell = cells.find((item) => item.code.toUpperCase() === value);
    const location = cell && locations.find((item) => item.cellId === cell.id);
    if (!cell || cell.blocked || !location) return toast.error("В этой ячейке нет выбранного материала");
    setIssueCell(cell.id);
    setIssueQuantity(String(Math.min(location.quantity, remainingLine)));
    setCellScan("");
    toast.success(`Ячейка ${cell.code} подтверждена`);
  };

  const issueSelectedLine = async () => {
    if (!activeIssue || !activeLine || !issueCell || Number(issueQuantity) <= 0) {
      return toast.error("Выберите позицию, ячейку и количество");
    }
    setSaving(true);
    try {
      const result = await postIssue({
        action: "issueLine",
        documentId: activeIssue.id,
        lineId: activeLine.lineId,
        cellId: issueCell,
        quantity: Number(issueQuantity),
        operator,
      });
      setIssueCell("");
      setIssueQuantity("");
      setSelectedLine("");
      toast.success(result.completed ? `Документ ${activeIssue.number} полностью выдан` : `${activeLine.productName} выдан`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка выдачи");
    } finally { setSaving(false); }
  };

  const transfer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    try {
      await postWarehouse({
        action: "transferStock",
        productId: transferProduct,
        fromCellId: transferFrom,
        toCellId: form.get("toCellId"),
        quantity: form.get("quantity"),
        comment: form.get("comment"),
        operator,
      });
      event.currentTarget.reset();
      setTransferProduct("");
      setTransferFrom("");
      toast.success("Материал перемещён", { description: "Остатки обеих ячеек обновлены" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка перемещения");
    } finally { setSaving(false); }
  };

  return <>
    <TabsContent value="receipt" className="space-y-5">
      <div><p className="eyebrow">Фактический приход</p><h1 className="page-title">Принять товар</h1><p className="page-description">Сверьте накладную, укажите реальное количество и сразу положите материал в ячейку.</p></div>
      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <form onSubmit={receive} className="panel p-4 sm:p-6 lg:p-7">
          <div className="panel-title"><div><span>Документ приёмки</span><h2>Что приехало и куда положили</h2></div><ArrowDownToLine /></div>
          <div className="form-grid">
            <div><Label>Номер накладной *</Label><Input name="documentNumber" required placeholder="ПР-000145" /></div>
            <div><Label>Поставщик</Label><Input name="supplier" placeholder="Название поставщика" /></div>
            <div className="sm:col-span-2"><Label>Материал *</Label><NativeSelect name="productId" required className="w-full"><NativeSelectOption value="">Выберите материал</NativeSelectOption>{products.map((p) => <NativeSelectOption key={p.id} value={p.id}>{p.name} · {p.sku}</NativeSelectOption>)}</NativeSelect></div>
            <div><Label>Фактическое количество *</Label><Input name="quantity" type="number" min="0.001" step="any" required placeholder="500" /></div>
            <div><Label>Ячейка *</Label><NativeSelect name="cellId" required className="w-full"><NativeSelectOption value="">Выберите ячейку</NativeSelectOption>{cells.filter((c) => !c.blocked).map((c) => <NativeSelectOption key={c.id} value={c.id}>{c.code}</NativeSelectOption>)}</NativeSelect></div>
            <div><Label>ID документа 1С</Label><Input name="oneCId" placeholder="Необязательно" /></div>
            <div><Label>Кладовщик</Label><Input value={operator} onChange={(e) => setOperator(e.target.value)} /></div>
            <div className="sm:col-span-2"><Label>Комментарий</Label><Input name="comment" placeholder="Повреждения или расхождения" /></div>
          </div>
          <div className="mt-6 flex justify-end"><Button disabled={saving || !products.length || !cells.length} className="h-11 bg-[#173f2b] text-white">{saving ? <Loader2 className="animate-spin" /> : <PackageCheck />} Принять и разместить</Button></div>
        </form>
        <aside className="rounded-2xl bg-[#173f2b] p-6 text-white"><p className="text-xs font-bold uppercase tracking-[.12em] text-[#afc8b6]">Порядок работы</p><ol className="workflow-list"><li><b>1</b><span>Сверьте товар с накладной</span></li><li><b>2</b><span>Пересчитайте фактическое количество</span></li><li><b>3</b><span>Выберите материал</span></li><li><b>4</b><span>Укажите ячейку хранения</span></li></ol></aside>
      </div>
    </TabsContent>

    <TabsContent value="transfer" className="space-y-5">
      <div><p className="eyebrow">Адресное хранение</p><h1 className="page-title">Переместить материал</h1><p className="page-description">Перенесите нужное количество из одной ячейки в другую. Общий остаток материала не изменится.</p></div>
      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <form onSubmit={transfer} className="panel p-4 sm:p-6 lg:p-7">
          <div className="panel-title"><div><span>Внутреннее перемещение</span><h2>Откуда и куда перенести</h2></div><ArrowRightLeft /></div>
          <div className="form-grid mt-6">
            <div className="sm:col-span-2"><Label>Материал *</Label><NativeSelect value={transferProduct} onChange={(event) => { setTransferProduct(event.target.value); setTransferFrom(""); }} required className="w-full"><NativeSelectOption value="">Выберите материал с остатком</NativeSelectOption>{products.filter((product) => (totals.get(product.id) || 0) > 0).map((product) => <NativeSelectOption key={product.id} value={product.id}>{product.name} · всего {qty(totals.get(product.id) || 0)} {product.unit}</NativeSelectOption>)}</NativeSelect></div>
            <div><Label>Из ячейки *</Label><NativeSelect value={transferFrom} onChange={(event) => setTransferFrom(event.target.value)} required className="w-full"><NativeSelectOption value="">Где материал лежит сейчас</NativeSelectOption>{transferLocations.map((stock) => <NativeSelectOption key={stock.cellId} value={stock.cellId}>{cells.find((cell) => cell.id === stock.cellId)?.code} · доступно {qty(stock.quantity)}</NativeSelectOption>)}</NativeSelect></div>
            <div><Label>В ячейку *</Label><NativeSelect name="toCellId" required className="w-full"><NativeSelectOption value="">Новое место хранения</NativeSelectOption>{cells.filter((cell) => !cell.blocked && cell.id !== transferFrom).map((cell) => <NativeSelectOption key={cell.id} value={cell.id}>{cell.code}</NativeSelectOption>)}</NativeSelect></div>
            <div><Label>Количество *</Label><Input name="quantity" type="number" min="0.001" step="any" required placeholder="Например, 25" /></div>
            <div><Label>Кладовщик</Label><Input value={operator} onChange={(event) => setOperator(event.target.value)} /></div>
            <div className="sm:col-span-2"><Label>Комментарий</Label><Input name="comment" placeholder="Причина перемещения — необязательно" /></div>
          </div>
          <Button disabled={saving || !transferProduct || !transferFrom} className="accent-button mt-6 h-12 w-full">{saving ? <Loader2 className="animate-spin" /> : <ArrowRightLeft />} Переместить и обновить остатки</Button>
        </form>
        <aside className="scan-console rounded-3xl p-6 text-white"><p className="text-xs font-bold uppercase tracking-[.12em] text-blue-200">Как это работает</p><ol className="workflow-list mt-5"><li><b>1</b><span>Выберите материал</span></li><li><b>2</b><span>Укажите текущую ячейку</span></li><li><b>3</b><span>Выберите новую ячейку</span></li><li><b>4</b><span>Введите количество</span></li></ol></aside>
      </div>
    </TabsContent>

    <TabsContent value="issue" className="space-y-5">
      <div>
        <p className="eyebrow">Расход материалов</p>
        <h1 className="page-title">Выдача по документу</h1>
        <p className="page-description">Один QR открывает весь документ. Внутри — все позиции, их RL-коды, штрихкоды, остатки и адреса хранения.</p>
      </div>

      <div className="grid min-w-0 gap-5 2xl:grid-cols-[minmax(360px,.78fr)_minmax(0,1.5fr)]">
        <form onSubmit={createIssueDocument} className="panel min-w-0 p-4 sm:p-6">
          <div className="panel-title"><div><span>Матбухгалтер</span><h2>Сформировать документ</h2></div><FileText /></div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 2xl:grid-cols-1">
            <div><Label>Номер документа *</Label><Input value={issueNumber} onChange={(e) => setIssueNumber(e.target.value)} required placeholder="ТП-223445123" /></div>
            <div><Label>Получатель / цех *</Label><Input value={issueRecipient} onChange={(e) => setIssueRecipient(e.target.value)} required placeholder="Петров / лакокраска" /></div>
            <div><Label>ID документа 1С</Label><Input value={issueOneCId} onChange={(e) => setIssueOneCId(e.target.value)} placeholder="Необязательно" /></div>
            <div><Label>Комментарий</Label><Input value={issueComment} onChange={(e) => setIssueComment(e.target.value)} placeholder="Заказ, участок, примечание" /></div>
          </div>

          <div className="mt-6 flex items-center justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[.12em] text-slate-500">Состав документа</p><p className="mt-1 text-sm text-slate-500">Добавьте одну или несколько позиций.</p></div><Button type="button" size="sm" variant="outline" onClick={() => setIssueDraftLines((rows) => [...rows, newDraftLine()])}><Plus /> Позиция</Button></div>
          <div className="mt-3 space-y-3">
            {issueDraftLines.map((line, index) => <div key={line.id} className="rounded-2xl border border-black/10 bg-white/70 p-3">
              <div className="mb-2 flex items-center justify-between"><b className="text-sm">Позиция {index + 1}</b>{issueDraftLines.length > 1 && <button type="button" className="rounded-lg p-1.5 text-red-600 hover:bg-red-50" onClick={() => setIssueDraftLines((rows) => rows.filter((row) => row.id !== line.id))}><Trash2 size={16} /></button>}</div>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_110px] 2xl:grid-cols-1">
                <NativeSelect value={line.productId} onChange={(e) => setIssueDraftLines((rows) => rows.map((row) => row.id === line.id ? { ...row, productId: e.target.value } : row))} className="w-full"><NativeSelectOption value="">Выберите материал</NativeSelectOption>{products.map((product) => <NativeSelectOption key={product.id} value={product.id}>{product.name} · остаток {qty(totals.get(product.id) || 0)} {product.unit}</NativeSelectOption>)}</NativeSelect>
                <Input value={line.quantity} onChange={(e) => setIssueDraftLines((rows) => rows.map((row) => row.id === line.id ? { ...row, quantity: e.target.value } : row))} type="number" min="0.001" step="any" placeholder="Кол-во" />
              </div>
            </div>)}
          </div>
          <Button disabled={saving || !products.length} className="mt-5 h-12 w-full bg-[#173f2b] text-white">{saving ? <Loader2 className="animate-spin" /> : <ClipboardList />} Создать документ и общий QR</Button>
        </form>

        <section className="panel min-w-0 p-4 sm:p-6">
          <div className="panel-title"><div><span>Кладовщик</span><h2>Собрать и выдать</h2></div><ArrowUpFromLine /></div>
          {!issueGroups.length ? <div className="py-16 text-center text-sm text-slate-500">Нет документов, ожидающих выдачу</div> : <div className="mt-5 space-y-5">
            <form onSubmit={scanDocument} className="rounded-2xl border border-blue-200 bg-blue-50/60 p-3 sm:p-4">
              <Label>QR документа</Label>
              <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]"><Input value={documentScan} onChange={(e) => setDocumentScan(e.target.value)} placeholder="Сканируйте ISSUE:ТП-... или введите номер" className="h-11 font-mono" /><Button type="submit" variant="outline" className="h-11"><QrCode /> Открыть</Button></div>
            </form>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_190px]">
              <div className="min-w-0"><Label>Документ</Label><NativeSelect value={activeIssue?.id || ""} onChange={(e) => { setSelectedIssue(e.target.value); setSelectedLine(""); setIssueCell(""); setIssueQuantity(""); }} className="mt-2 w-full">{issueGroups.map((document) => <NativeSelectOption key={document.id} value={document.id}>{document.number} · {document.recipient} · {document.rows.length} поз.</NativeSelectOption>)}</NativeSelect></div>
              {activeIssue && <button type="button" data-code-zoom="qr" data-code-value={`ISSUE:${activeIssue.number}`} data-code-label={activeIssue.number} className="flex min-h-36 flex-col items-center justify-center rounded-2xl border border-black/10 bg-white p-3 text-center transition hover:border-blue-300 hover:shadow-sm"><QRCodeSVG value={`ISSUE:${activeIssue.number}`} size={92} /><b className="mt-2 font-mono text-xs">{activeIssue.number}</b><span className="mt-1 text-[11px] text-slate-500">Единый QR документа</span></button>}
            </div>

            {activeIssue && <>
              <div className="rounded-2xl bg-slate-50 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs text-slate-500">Получатель</p><b>{activeIssue.recipient}</b></div><div className="text-right"><p className="text-xs text-slate-500">Документ</p><b>{activeIssue.number}</b></div></div></div>

              <div className="space-y-2">
                {activeIssue.rows.map((row, index) => {
                  const product = products.find((item) => item.id === row.productId);
                  const done = row.processedQuantity >= row.plannedQuantity - 0.000001;
                  const rowLocations = stocks.filter((stock) => stock.productId === row.productId && stock.quantity > 0);
                  return <button key={row.lineId} type="button" disabled={done} onClick={() => chooseLine(row.lineId)} className={`grid w-full min-w-0 gap-3 rounded-2xl border p-3 text-left transition sm:grid-cols-[38px_minmax(0,1fr)_150px_auto] sm:items-center ${done ? "border-emerald-200 bg-emerald-50 opacity-80" : activeLine?.lineId === row.lineId ? "border-blue-400 bg-blue-50 shadow-sm" : "border-black/10 bg-white hover:border-blue-200"}`}>
                    <div className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold ${done ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-700"}`}>{done ? <CheckCircle2 size={18} /> : index + 1}</div>
                    <div className="min-w-0"><div className="break-words font-bold">{row.productName}</div><div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500"><span className="font-mono">{product?.sku || row.productSku}</span><span>Нужно: {qty(row.plannedQuantity)} {row.productUnit}</span><span>Выдано: {qty(row.processedQuantity)}</span></div><div className="mt-1 text-xs text-slate-500">Где лежит: {rowLocations.map((stock) => `${cells.find((cell) => cell.id === stock.cellId)?.code} — ${qty(stock.quantity)}`).join(", ") || "остаток не найден"}</div></div>
                    <div className="hidden overflow-hidden sm:block">{product && <ProductBarcode value={product.barcode || product.sku} name={product.name} compact className="w-full" />}</div>
                    <div className={`rounded-full px-2.5 py-1 text-xs font-bold ${done ? "bg-emerald-100 text-emerald-700" : "bg-orange-100 text-orange-700"}`}>{done ? "Выдано" : `Осталось ${qty(row.plannedQuantity - row.processedQuantity)}`}</div>
                  </button>;
                })}
              </div>

              {activeLine && remainingLine > 0 && <div className="rounded-2xl border border-black/10 bg-white p-4 sm:p-5">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[.12em] text-blue-600">Текущая позиция</p><h3 className="mt-1 text-lg font-bold">{activeLine.productName}</h3><p className="text-sm text-slate-500">Осталось выдать {qty(remainingLine)} {activeLine.productUnit}</p></div>{activeProduct && <div className="w-full max-w-[260px] overflow-hidden sm:w-[230px]"><ProductBarcode value={activeProduct.barcode || activeProduct.sku} name={activeProduct.name} compact className="w-full" /></div>}</div>

                <form onSubmit={scanCell}><Label>QR ячейки хранения</Label><div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]"><Input value={cellScan} onChange={(e) => setCellScan(e.target.value)} placeholder="Например, CT-011A" className="h-11 font-mono" /><Button type="submit" variant="outline" className="h-11"><ScanLine /> Проверить</Button></div></form>

                <div className="mt-4 grid gap-4 md:grid-cols-2"><div><Label>Подтверждённая ячейка</Label><NativeSelect value={issueCell} onChange={(e) => { const id = e.target.value; setIssueCell(id); const location = locations.find((item) => item.cellId === id); if (location) setIssueQuantity(String(Math.min(location.quantity, remainingLine))); }} className="mt-2 w-full"><NativeSelectOption value="">Отсканируйте или выберите</NativeSelectOption>{locations.map((stock) => <NativeSelectOption key={stock.cellId} value={stock.cellId}>{cells.find((cell) => cell.id === stock.cellId)?.code} · доступно {qty(stock.quantity)}</NativeSelectOption>)}</NativeSelect></div><div><Label>Фактически выдаётся</Label><Input className="mt-2" value={issueQuantity} onChange={(e) => setIssueQuantity(e.target.value)} type="number" min="0.001" max={remainingLine} step="any" /></div></div>
                <div className="mt-4"><Label>Кладовщик</Label><Input className="mt-2" value={operator} onChange={(e) => setOperator(e.target.value)} /></div>
                <Button disabled={saving || !issueCell || Number(issueQuantity) <= 0 || Number(issueQuantity) > remainingLine} onClick={() => void issueSelectedLine()} className="accent-button mt-5 h-12 w-full">{saving ? <Loader2 className="animate-spin" /> : <PackageCheck />} Подтвердить выдачу этой позиции</Button>
              </div>}
            </>}
          </div>}
        </section>
      </div>
    </TabsContent>
  </>;
}
