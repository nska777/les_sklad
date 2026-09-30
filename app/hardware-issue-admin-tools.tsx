"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MapPin, Trash2 } from "lucide-react";
import { toast } from "sonner";

type Rack = { id: string; name: string; code: string };
type Cell = { id: string; rackId: string; code: string };
type Product = { id: string; sku: string; barcode: string };
type Stock = { productId: string; cellId: string; quantity: number };
type Doc = { id: string; number: string; type: string; status: string; oneCId: string | null; processedQuantity: number };
type Snapshot = { racks: Rack[]; cells: Cell[]; products: Product[]; stocks: Stock[]; documents: Doc[] };

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

export function HardwareIssueAdminTools() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [admin, setAdmin] = useState(false);
  const [documentId, setDocumentId] = useState("");
  const [barcode, setBarcode] = useState("");
  const [deleteHost, setDeleteHost] = useState<HTMLElement | null>(null);
  const [addressHost, setAddressHost] = useState<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);
  const markedInProgress = useRef(new Set<string>());

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
      const panelTitle = Array.from(document.querySelectorAll("h2")).find((n) => n.textContent?.trim() === "Собрать и выдать");
      const panel = panelTitle?.closest("section.panel");
      const select = panel
        ? Array.from(panel.querySelectorAll("select"))
            .map((node) => node as unknown as HTMLSelectElement)
            .find((s) => Array.from(s.options).some((o) => o.textContent?.includes("поз.")))
        : null;
      const selectedId = select?.value || "";
      setDocumentId(selectedId);
      if (select?.parentElement) setDeleteHost(host("delete", select.parentElement, true));

      const dialog = document.querySelector<HTMLElement>("[role='dialog']");
      if (!dialog) {
        setAddressHost(null);
        setBarcode("");
        return;
      }
      const marker = Array.from(dialog.querySelectorAll<HTMLElement>("p")).find((n) => n.textContent?.trim() === "Текущая позиция");
      const card = marker?.closest(".rounded-2xl");
      if (card) setAddressHost(host("address", card, true));
      setBarcode(dialog.querySelector<HTMLElement>("[data-barcode-value]")?.dataset.barcodeValue?.trim().toUpperCase() || "");

      const verifiedTitle = Array.from(dialog.querySelectorAll<HTMLElement>("div")).find((n) => n.textContent?.trim() === "Отсканируйте штрихкод материала");
      const verifiedStep = verifiedTitle?.closest<HTMLElement>(".rounded-2xl");
      if (selectedId && verifiedStep?.className.includes("emerald")) markProgress(selectedId);
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

  const rows = data?.documents.filter((row) => row.id === documentId && row.type === "issue") || [];
  const current = rows[0];
  const canDelete = Boolean(admin && current && !current.oneCId && current.status !== "completed" && rows.every((row) => Number(row.processedQuantity || 0) === 0));

  const addresses = useMemo(() => {
    if (!data || !barcode) return [];
    const product = data.products.find((p) => p.barcode?.trim().toUpperCase() === barcode || p.sku?.trim().toUpperCase() === barcode);
    if (!product) return [];
    return data.stocks.filter((s) => s.productId === product.id && s.quantity > 0).map((s) => {
      const cell = data.cells.find((c) => c.id === s.cellId);
      const rack = cell ? data.racks.find((r) => r.id === cell.rackId) : undefined;
      return { id: s.cellId, rack: rack?.name || rack?.code || "Стеллаж", rackCode: rack?.code || "", cell: cell?.code || "—", quantity: s.quantity };
    });
  }, [barcode, data]);

  const remove = async () => {
    if (!current || !canDelete || busy) return;
    if (!window.confirm(`Удалить заказ ${current.number}?`)) return;
    setBusy(true);
    try {
      const response = await fetch("/api/warehouse/issues/admin-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: current.id }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "Не удалось удалить заказ");
      toast.success(`Заказ ${current.number} удалён`);
      window.dispatchEvent(new Event("hardware:refresh-now"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось удалить заказ");
    } finally {
      setBusy(false);
    }
  };

  const statusText = current?.status === "in_progress" ? "Сборка начата" : current?.status === "partial" ? "Выдано частично" : "Новое задание";
  const statusClass = current?.status === "in_progress" || current?.status === "partial" ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600";

  return <>
    {deleteHost && current && createPortal(
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusClass}`}>{statusText}</span>
        {canDelete && <button type="button" disabled={busy} onClick={() => void remove()} className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700 hover:bg-red-100 disabled:opacity-50"><Trash2 size={16} />{busy ? "Удаление..." : "Удалить заказ"}</button>}
        {admin && current.oneCId && <span className="text-xs text-slate-500">Связан с 1С — удаление через отмену документа.</span>}
      </div>, deleteHost)}

    {addressHost && createPortal(
      <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-center gap-2 text-sm font-extrabold"><MapPin size={18} className="text-orange-600" /> Место хранения</div>
        <div className="mt-2 space-y-2">
          {addresses.length ? addresses.map((item) => <div key={item.id} className="flex flex-col justify-between gap-1 rounded-xl bg-white px-3 py-2 sm:flex-row sm:items-center"><div><b>{item.rack}</b>{item.rackCode && <span className="ml-1 text-xs text-slate-500">({item.rackCode})</span>}<div className="text-sm">Ячейка: <span className="font-mono font-bold">{item.cell}</span></div></div><b className="text-sm text-emerald-700">Доступно: {Number(item.quantity).toLocaleString("ru-RU")}</b></div>) : <span className="text-sm text-slate-600">Адрес хранения не найден</span>}
        </div>
      </div>, addressHost)}
  </>;
}
