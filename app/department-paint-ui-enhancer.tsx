"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot, Root } from "react-dom/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pencil, PackagePlus } from "lucide-react";

type Product = {
  id: string; name: string; sku: string; unit: string; category: string; brand: string; color: string; ral: string;
  packType: string; packSize: number; minStock: number; comment: string; createdAt: string; source: string;
};
type Cell = { id: string; code: string; label: string };
type ReceiptData = { products: Product[]; cells: Cell[]; units: string[] };

const mounted = new WeakMap<Element, Root>();

async function fetchReceiptData(): Promise<ReceiptData> {
  const r = await fetch("/api/department-warehouse-receipt", { cache: "no-store" });
  const body = await r.json() as ReceiptData & { error?: string };
  if (!r.ok) throw new Error(body.error || "Не удалось загрузить данные прихода");
  return body;
}

function SmartReceipt() {
  const [data, setData] = useState<ReceiptData>({ products: [], cells: [], units: ["кг", "г", "мг", "л", "мл", "шт."] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [productId, setProductId] = useState("");
  const [newMode, setNewMode] = useState(false);
  const [unit, setUnit] = useState("кг");

  const load = useCallback(async () => {
    try { setData(await fetchReceiptData()); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Ошибка загрузки"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const selected = useMemo(() => data.products.find((p) => p.id === productId), [data.products, productId]);
  useEffect(() => { if (selected?.unit) setUnit(selected.unit); }, [selected]);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setSaving(true);
    try {
      const r = await fetch("/api/department-warehouse-receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentNumber: f.get("documentNumber"),
          sourceName: f.get("sourceName"),
          productId: newMode ? "" : productId,
          newProductName: newMode ? f.get("newProductName") : "",
          quantity: f.get("quantity"),
          unit: f.get("unit"),
          cellId: f.get("cellId"),
          comment: f.get("comment"),
        }),
      });
      const body = await r.json() as { error?: string; created?: boolean; unplaced?: boolean };
      if (!r.ok) throw new Error(body.error || "Не удалось оприходовать");
      toast.success(body.created ? "Новый материал создан и оприходован" : "Приход оприходован", {
        description: body.unplaced ? "Материал добавлен в «Материалы» и ожидает размещения." : "Материал сразу размещён в выбранном месте.",
      });
      setTimeout(() => window.location.reload(), 500);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Ошибка прихода"); }
    finally { setSaving(false); }
  };

  return <form onSubmit={submit} className="panel p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-xl font-black">Приход и оприходование</h2><p className="mt-1 text-sm text-slate-500">Документ обязателен. Материал можно выбрать из базы или создать новый. Разместить по ячейке можно сразу или позже.</p></div>
      <span className="rounded-full bg-orange-50 px-3 py-1.5 text-xs font-bold text-orange-700">Фактический приход</span>
    </div>

    <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <div><Label>Документ / накладная *</Label><Input name="documentNumber" required className="mt-1.5" placeholder="Например: НК-245 от 27.09.2026"/></div>
      <div><Label>Поставщик / источник</Label><Input name="sourceName" className="mt-1.5" placeholder="Например: ООО Color Mix"/></div>
      <div className="md:col-span-2"><Label>Материал *</Label><select className="mt-1.5 h-10 w-full rounded-md border bg-white px-3 text-sm" value={newMode ? "__new" : productId} onChange={(e) => { const v = e.target.value; setNewMode(v === "__new"); setProductId(v === "__new" ? "" : v); }} required><option value="">Выберите материал...</option><option value="__new">＋ Новый материал, которого ещё нет</option>{data.products.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.sku} · {p.unit}</option>)}</select></div>
      {newMode && <div className="md:col-span-2 xl:col-span-2"><Label>Наименование нового материала *</Label><Input name="newProductName" required className="mt-1.5" placeholder="Например: Грунт полиуретановый белый"/></div>}
      <div><Label>Количество *</Label><Input name="quantity" required inputMode="decimal" className="mt-1.5" placeholder="Например: 48,125750"/></div>
      <div><Label>Единица *</Label><select name="unit" value={unit} onChange={(e) => setUnit(e.target.value)} className="mt-1.5 h-10 w-full rounded-md border bg-white px-3 text-sm" required>{data.units.map((u) => <option key={u} value={u}>{u}</option>)}</select></div>
      <div className="md:col-span-2"><Label>Куда разместить</Label><select name="cellId" className="mt-1.5 h-10 w-full rounded-md border bg-white px-3 text-sm"><option value="">Не размещать сейчас — оставить в ожидании</option>{data.cells.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.label}</option>)}</select><p className="mt-1 text-xs text-slate-400">Можно не выбирать. Материал появится сверху во вкладке «Материалы» и его можно будет распределить позже.</p></div>
      <div className="md:col-span-2"><Label>Комментарий</Label><Input name="comment" className="mt-1.5" placeholder="Например: Принято по факту, без размещения"/></div>
    </div>
    <Button disabled={saving || loading || (!productId && !newMode)} className="accent-button mt-5"><PackagePlus size={16}/>{saving ? "Оприходование..." : "Оприходовать"}</Button>
  </form>;
}

function EditProductModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const [saving, setSaving] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setSaving(true);
    try {
      const r = await fetch("/api/department-warehouse-receipt", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "editProduct", id: product.id, ...Object.fromEntries(f.entries()) }),
      });
      const body = await r.json() as { error?: string };
      if (!r.ok) throw new Error(body.error || "Не удалось сохранить материал");
      toast.success("Материал обновлён", { description: "Изменение записано во вкладку «Движения»." });
      onClose();
      setTimeout(() => window.location.reload(), 350);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Ошибка сохранения"); }
    finally { setSaving(false); }
  };
  return <div className="fixed inset-0 z-[120] grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <form onSubmit={submit} className="w-full max-w-3xl rounded-3xl border bg-white p-6 shadow-2xl">
      <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[.18em] text-blue-600">Редактирование материала</p><h3 className="mt-1 text-2xl font-black">{product.name}</h3></div><button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full border text-xl">×</button></div>
      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <div><Label>Наименование</Label><Input name="name" defaultValue={product.name} className="mt-1.5" required/></div>
        <div><Label>Артикул</Label><Input name="sku" defaultValue={product.sku} className="mt-1.5" required/></div>
        <div><Label>Категория</Label><Input name="category" defaultValue={product.category} className="mt-1.5" placeholder="Например: Лакокрасочные материалы"/></div>
        <div><Label>Бренд</Label><Input name="brand" defaultValue={product.brand} className="mt-1.5" placeholder="Например: Sayerlack"/></div>
        <div><Label>Цвет</Label><Input name="color" defaultValue={product.color} className="mt-1.5" placeholder="Например: Белый"/></div>
        <div><Label>RAL / код цвета</Label><Input name="ral" defaultValue={product.ral} className="mt-1.5" placeholder="Например: 9016"/></div>
        <div><Label>Единица</Label><select name="unit" defaultValue={product.unit} className="mt-1.5 h-10 w-full rounded-md border bg-white px-3 text-sm">{["кг", "г", "мг", "л", "мл", "шт."].map((u) => <option key={u}>{u}</option>)}</select></div>
        <div><Label>Тип тары</Label><select name="packType" defaultValue={product.packType} className="mt-1.5 h-10 w-full rounded-md border bg-white px-3 text-sm">{["", "ведро", "банка", "канистра", "бутылка", "бочка", "мешок", "коробка", "без тары"].map((u) => <option key={u} value={u}>{u || "Не указано"}</option>)}</select></div>
        <div><Label>Вес / объём тары</Label><Input name="packSize" defaultValue={String(product.packSize || "")} inputMode="decimal" className="mt-1.5"/></div>
        <div><Label>Мин. остаток</Label><Input name="minStock" defaultValue={String(product.minStock || "")} inputMode="decimal" className="mt-1.5"/></div>
        <div className="md:col-span-2 xl:col-span-2"><Label>Комментарий *</Label><Input name="comment" defaultValue={product.comment} className="mt-1.5" required placeholder="Обязательно укажите причину изменения"/></div>
      </div>
      <div className="mt-5 flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Отмена</Button><Button disabled={saving} className="accent-button"><Pencil size={15}/>{saving ? "Сохранение..." : "Сохранить изменения"}</Button></div>
    </form>
  </div>;
}

export function DepartmentPaintUiEnhancer() {
  const [products, setProducts] = useState<Product[]>([]);
  const [editing, setEditing] = useState<Product | null>(null);

  useEffect(() => {
    if (!window.location.pathname.startsWith("/department/paint")) return;
    let alive = true;
    void fetchReceiptData().then((d) => { if (alive) setProducts(d.products); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!window.location.pathname.startsWith("/department/paint")) return;
    const enhance = () => {
      // Replace the old receipt form with the redesigned, optional-placement form.
      document.querySelectorAll<HTMLFormElement>("form").forEach((form) => {
        if (form.querySelector("h2")?.textContent?.trim() !== "Приход и оприходование") return;
        if (form.dataset.smartReceipt === "1") return;
        form.dataset.smartReceipt = "1";
        form.style.display = "none";
        const host = document.createElement("div");
        host.dataset.smartReceiptHost = "1";
        form.insertAdjacentElement("afterend", host);
        const root = createRoot(host); mounted.set(host, root); root.render(<SmartReceipt />);
      });

      // Materials: no checkboxes, newest first, mark fresh records, add a quiet Edit button.
      document.querySelectorAll("table").forEach((table) => {
        const headers = Array.from(table.querySelectorAll("thead th"));
        if (!headers.some((h) => h.textContent?.trim() === "Материал") || !headers.some((h) => h.textContent?.includes("Штрихкод"))) return;
        const firstHeader = headers[0] as HTMLElement | undefined;
        if (firstHeader?.querySelector('input[type="checkbox"]')) firstHeader.style.display = "none";
        const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>("tbody tr"));
        const bySku = new Map(products.map((p) => [p.sku, p]));
        const sortable: Array<{ row: HTMLTableRowElement; product: Product | undefined }> = [];
        rows.forEach((row) => {
          const cells = Array.from(row.children) as HTMLElement[];
          if (cells[0]?.querySelector('input[type="checkbox"]')) cells[0].style.display = "none";
          const sku = row.querySelector(".font-mono")?.textContent?.trim() || "";
          const p = bySku.get(sku);
          sortable.push({ row, product: p });
          if (!p) return;
          const nameCell = cells.find((c) => c.querySelector(".font-bold"));
          if (nameCell && !nameCell.querySelector("[data-new-badge]") && Date.now() - new Date(p.createdAt).getTime() < 48 * 3600_000) {
            const badge = document.createElement("span"); badge.dataset.newBadge = "1"; badge.textContent = "Новое";
            badge.className = "ml-2 inline-flex rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-orange-700";
            nameCell.querySelector(".font-bold")?.appendChild(badge);
          }
          const last = cells[cells.length - 1];
          if (last && !last.querySelector("[data-edit-product]")) {
            const btn = document.createElement("button"); btn.type = "button"; btn.dataset.editProduct = p.id;
            btn.className = "ml-2 inline-flex items-center rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-600 shadow-sm transition hover:border-blue-300 hover:text-blue-700";
            btn.textContent = "Редактировать";
            btn.onclick = () => setEditing(p);
            last.appendChild(btn);
          }
        });
        const body = table.querySelector("tbody");
        if (body && sortable.some((x) => x.product)) {
          sortable.sort((a, b) => new Date(b.product?.createdAt || 0).getTime() - new Date(a.product?.createdAt || 0).getTime());
          sortable.forEach(({ row }) => body.appendChild(row));
        }
      });
    };
    enhance();
    const observer = new MutationObserver(enhance);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [products]);

  return editing ? <EditProductModal product={editing} onClose={() => setEditing(null)} /> : null;
}
