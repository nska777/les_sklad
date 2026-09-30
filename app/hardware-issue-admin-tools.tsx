"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MapPin, Trash2 } from "lucide-react";
import { toast } from "sonner";

type Rack = { id: string; name: string; code: string };
type Cell = { id: string; rackId: string; code: string };
type Product = { id: string; sku: string; barcode: string };
type Stock = { productId: string; cellId: string; quantity: number };
type Doc = { id: string; number: string; type: string; status: string; oneCId: string | null; lineId: string; productId: string; processedQuantity: number };
type Snapshot = { racks: Rack[]; cells: Cell[]; products: Product[]; stocks: Stock[]; documents: Doc[] };
type LiveProgress = {
  documentId: string;
  lineId: string;
  productVerified: boolean;
  cellId: string;
  cellCode: string;
  quantity: number;
  quantityVerified: boolean;
  updatedBy: string;
  updatedAt: string;
};

function host(key: string, anchor: globalThis.Element, after = false) {
  let node = document.querySelector<HTMLElement>(`[data-hw-tool="${key}"]`);
  if (!node) {
    node = document.createElement("div");
    node.dataset.hwTool = key;
    if (after) anchor.insertAdjacentElement("afterend", node);
    else anchor.appendChild(node);
  }
  return node;
}

function stepState(dialog: HTMLElement, title: string) {
  const titleNode = Array.from(dialog.querySelectorAll<HTMLElement>("div")).find((node) => node.textContent?.trim() === title);
  const step = titleNode?.closest<HTMLElement>(".rounded-2xl") || null;
  return { step, done: Boolean(step?.className.includes("emerald")) };
}

export function HardwareIssueAdminTools() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [admin, setAdmin] = useState(false);
  const [documentId, setDocumentId] = useState("");
  const [barcode, setBarcode] = useState("");
  const [deleteHost, setDeleteHost] = useState<HTMLElement | null>(null);
  const [addressHost, setAddressHost] = useState<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [remoteProgress, setRemoteProgress] = useState<LiveProgress | null>(null);
  const markedInProgress = useRef(new Set<string>());
  const lastProgressFingerprint = useRef("");

  useEffect(() => {
    if (window.location.pathname !== "/warehouse") return;
    void fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ user?: { role?: string } }>)
      .then((body) => setAdmin(body.user?.role === "admin"))
      .catch(() => setAdmin(false));

    const onSnapshot = (event: Event) => setData((event as CustomEvent<Snapshot>).detail);
    window.addEventListener("hardware:live-snapshot", onSnapshot as EventListener);
    return () => window.removeEventListener("hardware:live-snapshot", onSnapshot as EventListener);
  }, []);

  useEffect(() => {
    if (window.location.pathname !== "/warehouse") return;
    const markProgress = (id: string) => {
      if (!id || markedInProgress.current.has(id)) return;
      markedInProgress.current.add(id);
      void fetch("/api/warehouse/issues/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: id }),
      }).then((response) => {
        if (response.ok) window.dispatchEvent(new Event("hardware:refresh-now"));
        else markedInProgress.current.delete(id);
      }).catch(() => markedInProgress.current.delete(id));
    };

    const mount = () => {
      const panelTitle = Array.from(document.querySelectorAll("h2")).find((node) => node.textContent?.trim() === "Собрать и выдать");
      const panel = panelTitle?.closest("section.panel");
      const select = panel
        ? Array.from(panel.querySelectorAll("select"))
            .map((node) => node as unknown as HTMLSelectElement)
            .find((selectNode) => Array.from(selectNode.options).some((option) => option.textContent?.includes("поз.")))
        : null;
      const selectedId = select?.value || "";
      if (selectedId) setDocumentId(selectedId);
      if (panelTitle?.parentElement) setDeleteHost(host("delete", panelTitle.parentElement, true));

      const dialog = document.querySelector<HTMLElement>("[role='dialog']");
      if (!dialog) {
        setAddressHost(null);
        setBarcode("");
        return;
      }
      const marker = Array.from(dialog.querySelectorAll<HTMLElement>("p")).find((node) => node.textContent?.trim() === "Текущая позиция");
      const card = marker?.closest(".rounded-2xl");
      if (card) setAddressHost(host("address", card, true));
      setBarcode(dialog.querySelector<HTMLElement>("[data-barcode-value]")?.dataset.barcodeValue?.trim().toUpperCase() || "");

      const productStep = stepState(dialog, "Отсканируйте штрихкод материала");
      if (selectedId && productStep.done) markProgress(selectedId);
    };
    mount();
    const observer = new MutationObserver(mount);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    document.addEventListener("change", mount, true);
    return () => {
      observer.disconnect();
      document.removeEventListener("change", mount, true);
    };
  }, []);

  const effectiveDocumentId = documentId || data?.documents.find((row) => row.type === "issue" && row.status !== "completed")?.id || "";
  const rows = data?.documents.filter((row) => row.id === effectiveDocumentId && row.type === "issue") || [];
  const current = rows[0];
  const canDelete = Boolean(admin && current);
  const processedTotal = rows.reduce((sum, row) => sum + Number(row.processedQuantity || 0), 0);

  const currentProduct = useMemo(() => {
    if (!data || !barcode) return null;
    return data.products.find((product) => product.barcode?.trim().toUpperCase() === barcode || product.sku?.trim().toUpperCase() === barcode) || null;
  }, [barcode, data]);

  const currentLine = useMemo(() => {
    if (!currentProduct || !effectiveDocumentId || !data) return null;
    return data.documents.find((row) => row.id === effectiveDocumentId && row.productId === currentProduct.id) || null;
  }, [currentProduct, data, effectiveDocumentId]);

  const addresses = useMemo(() => {
    if (!data || !currentProduct) return [];
    return data.stocks.filter((stock) => stock.productId === currentProduct.id && stock.quantity > 0).map((stock) => {
      const cell = data.cells.find((item) => item.id === stock.cellId);
      const rack = cell ? data.racks.find((item) => item.id === cell.rackId) : undefined;
      return { id: stock.cellId, rack: rack?.name || rack?.code || "Стеллаж", rackCode: rack?.code || "", cell: cell?.code || "—", quantity: stock.quantity };
    });
  }, [currentProduct, data]);

  useEffect(() => {
    if (!effectiveDocumentId) {
      setRemoteProgress(null);
      return;
    }
    let stopped = false;
    const load = async () => {
      try {
        const response = await fetch(`/api/warehouse/issues/live-progress?documentId=${encodeURIComponent(effectiveDocumentId)}`, { cache: "no-store" });
        if (!response.ok) return;
        const body = await response.json() as { progress?: LiveProgress[] };
        if (stopped) return;
        const progress = currentLine
          ? body.progress?.find((item) => item.lineId === currentLine.lineId)
          : body.progress?.[0];
        setRemoteProgress(progress || null);
      } catch {
        // Синхронизация прогресса не должна блокировать выдачу.
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 1000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [currentLine, effectiveDocumentId]);

  useEffect(() => {
    if (!effectiveDocumentId || !currentLine) return;
    const timer = window.setInterval(() => {
      const dialog = document.querySelector<HTMLElement>("[role='dialog']");
      if (!dialog) return;
      const productStep = stepState(dialog, "Отсканируйте штрихкод материала");
      const cellStep = stepState(dialog, "Отсканируйте QR ячейки");
      const quantityStep = stepState(dialog, "Подтвердите количество");
      const cellText = cellStep.step?.textContent || "";
      const cellCode = /Ячейка подтверждена:\s*([^\s]+)/i.exec(cellText)?.[1] || "";
      const cellId = data?.cells.find((cell) => cell.code.toUpperCase() === cellCode.toUpperCase())?.id || "";
      const quantityInput = quantityStep.step?.querySelector("input[type='number']") as HTMLInputElement | null;
      const quantity = Number(quantityInput?.value || 0);
      const fingerprint = [effectiveDocumentId, currentLine.lineId, productStep.done, cellId, cellCode, quantity, quantityStep.done].join("|");
      if (fingerprint === lastProgressFingerprint.current) return;
      lastProgressFingerprint.current = fingerprint;
      if (!productStep.done && !cellStep.done && !quantityStep.done) return;
      void fetch("/api/warehouse/issues/live-progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId: effectiveDocumentId,
          lineId: currentLine.lineId,
          productVerified: productStep.done,
          cellId,
          cellCode,
          quantity: Number.isFinite(quantity) ? quantity : 0,
          quantityVerified: quantityStep.done,
        }),
      }).catch(() => undefined);
    }, 350);
    return () => window.clearInterval(timer);
  }, [currentLine, data?.cells, effectiveDocumentId]);

  const remove = async () => {
    if (!current || !canDelete || busy) return;
    const warnings = [
      `Удалить заявку ${current.number}?`,
      "",
      "Это действие доступно только администратору и отменить его нельзя.",
      processedTotal > 0 ? `По заявке уже выдано: ${processedTotal}. Выданный товар НЕ будет автоматически возвращён на склад.` : "По заявке ещё нет фактической выдачи.",
      current.oneCId ? `Заявка связана с 1С (${current.oneCId}). Удаление в WMS НЕ отменит исходный документ в 1С.` : "",
      "История уже выполненных складских движений будет сохранена.",
    ].filter(Boolean).join("\n");
    if (!window.confirm(warnings)) return;

    setBusy(true);
    try {
      const response = await fetch("/api/warehouse/issues/admin-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: current.id }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "Не удалось удалить заказ");
      toast.success(`Заявка ${current.number} удалена администратором`);
      setDocumentId("");
      window.dispatchEvent(new Event("hardware:refresh-now"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось удалить заказ");
    } finally {
      setBusy(false);
    }
  };

  const statusText = current?.status === "in_progress" ? "Сборка начата" : current?.status === "partial" ? "Выдано частично" : current?.status === "completed" ? "Завершено" : "Новое задание";
  const statusClass = current?.status === "in_progress" || current?.status === "partial" ? "bg-blue-100 text-blue-700" : current?.status === "completed" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600";

  return <>
    {deleteHost && current && createPortal(
      <div className="mb-4 mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white/80 p-3">
        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusClass}`}>{statusText}</span>
        {admin && <button type="button" disabled={busy} onClick={() => void remove()} className="inline-flex items-center gap-2 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm font-bold text-red-700 hover:bg-red-100 disabled:opacity-50"><Trash2 size={16} />{busy ? "Удаление..." : `Удалить заявку ${current.number}`}</button>}
        {!admin && <span className="text-xs text-slate-500">Удаление заявок доступно только администратору.</span>}
        {admin && current.oneCId && <span className="text-xs text-amber-700">Связано с 1С: удаление затронет только заявку WMS.</span>}
      </div>, deleteHost)}

    {addressHost && createPortal(
      <div className="space-y-3">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center gap-2 text-sm font-extrabold"><MapPin size={18} className="text-orange-600" /> Место хранения</div>
          <div className="mt-2 space-y-2">
            {addresses.length ? addresses.map((item) => <div key={item.id} className="flex flex-col justify-between gap-1 rounded-xl bg-white px-3 py-2 sm:flex-row sm:items-center"><div><b>{item.rack}</b>{item.rackCode && <span className="ml-1 text-xs text-slate-500">({item.rackCode})</span>}<div className="text-sm">Ячейка: <span className="font-mono font-bold">{item.cell}</span></div></div><b className="text-sm text-emerald-700">Доступно: {Number(item.quantity).toLocaleString("ru-RU")}</b></div>) : <span className="text-sm text-slate-600">Адрес хранения не найден</span>}
          </div>
        </div>

        {remoteProgress && <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
          <div className="text-sm font-extrabold text-blue-900">Синхронизация сборки</div>
          <div className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
            <div className={`rounded-xl px-3 py-2 ${remoteProgress.productVerified ? "bg-emerald-50 text-emerald-800" : "bg-white text-slate-500"}`}><b>1. Материал</b><div>{remoteProgress.productVerified ? "Подтверждён" : "Ожидает сканирования"}</div></div>
            <div className={`rounded-xl px-3 py-2 ${remoteProgress.cellCode ? "bg-emerald-50 text-emerald-800" : "bg-white text-slate-500"}`}><b>2. Ячейка</b><div>{remoteProgress.cellCode || "Ожидает сканирования"}</div></div>
            <div className={`rounded-xl px-3 py-2 ${remoteProgress.quantityVerified ? "bg-emerald-50 text-emerald-800" : "bg-white text-slate-500"}`}><b>3. Количество</b><div>{remoteProgress.quantity > 0 ? remoteProgress.quantity.toLocaleString("ru-RU") : "Ожидает подтверждения"}</div></div>
          </div>
          <div className="mt-2 text-xs text-blue-700">Обновляется между телефоном и компьютером автоматически · {remoteProgress.updatedBy || "кладовщик"}</div>
        </div>}
      </div>, addressHost)}
  </>;
}
