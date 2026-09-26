"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { ArrowLeft, Loader2, Search, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";

type Location = { cellId: string; cellCode: string; rackCode: string; storageType: string; quantity: number };
type ExcessItem = { catalogId: string; productId: string; name: string; sku: string; barcode: string; unit: string; productUnit: string; quantity1c: number; fact: number; excess: number; locations: Location[] };
type ApiData = { items: ExcessItem[]; totalPositions?: number; error?: string };
type ActionDraft = { type: "issue" | "adjust"; item: ExcessItem } | null;

const fmt = (v: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 9 }).format(v);
const preciseUnits = ["кг", "г", "мг", "л", "мл", "мкл", "шт."];

export default function ExcessPage() {
  const params = useParams<{ warehouse: string }>();
  const warehouse = String(params?.warehouse || "paint");
  const base = `/department/${warehouse}`;
  const [data, setData] = useState<ApiData>({ items: [] });
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<ActionDraft>(null);
  const [cellId, setCellId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [inputUnit, setInputUnit] = useState("кг");
  const [recipient, setRecipient] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/department-onec/excess", { cache: "no-store" });
      const body = await r.json() as ApiData;
      if (!r.ok) throw new Error(body.error || "Не удалось загрузить излишки");
      setData(body);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? data.items.filter((x) => `${x.name} ${x.sku} ${x.barcode}`.toLowerCase().includes(q)) : data.items;
  }, [data.items, query]);

  const totalExcess = data.items.reduce((sum, x) => sum + Number(x.excess || 0), 0);

  const openAction = (type: "issue" | "adjust", item: ExcessItem) => {
    setDraft({ type, item });
    setCellId(item.locations[0]?.cellId || "");
    setQuantity(type === "adjust" ? String(item.excess) : "");
    setInputUnit(preciseUnits.includes(item.unit) ? item.unit : "кг");
    setRecipient("");
  };

  const submit = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const payload = draft.type === "issue"
        ? { action: "issue", catalogId: draft.item.catalogId, cellId, quantity, inputUnit, recipient }
        : { action: "adjust", catalogId: draft.item.catalogId, cellId, targetExcess: quantity, inputUnit };
      const r = await fetch("/api/department-onec/excess", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await r.json() as { error?: string };
      if (!r.ok) throw new Error(body.error || "Операция не выполнена");
      toast.success(draft.type === "issue" ? "Излишек выдан" : "Излишек скорректирован");
      setDraft(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  };

  return <main className="min-h-screen px-4 py-5 text-[var(--foreground)] sm:px-7">
    <div className="mx-auto max-w-[1650px] space-y-4">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <Link href={base} data-same-tab="true" className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-blue-700 hover:underline"><ArrowLeft size={16}/> Назад в склад</Link>
          <p className="eyebrow">Фактический остаток выше 1С</p>
          <h1 className="page-title">Излишки</h1>
          <p className="page-description">Сюда автоматически попадает всё количество, которое физически превышает остаток в 1С.</p>
        </div>
        <Link href={`${base}/onec-materials`} data-same-tab="true" className="inline-flex h-10 items-center gap-2 rounded-xl border bg-white px-4 font-semibold">Материалы из 1С</Link>
      </div>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="panel p-5"><div className="text-sm text-slate-500">Позиций с излишком</div><div className="mt-1 text-3xl font-black">{data.items.length}</div></div>
        <div className="panel p-5"><div className="text-sm text-slate-500">Суммарный излишек</div><div className="mt-1 text-3xl font-black">{fmt(totalExcess)}</div><div className="mt-1 text-xs text-slate-400">Сумма разных единиц только для ориентира</div></div>
        <div className="panel p-5"><div className="flex items-center gap-2 text-sm font-bold text-amber-700"><TriangleAlert size={18}/> Контроль</div><div className="mt-2 text-sm text-slate-500">Выдача излишка не может уменьшить фактический остаток ниже количества 1С.</div></div>
      </section>

      <section className="panel overflow-hidden p-0">
        <div className="border-b p-4"><div className="relative max-w-2xl"><Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input value={query} onChange={(e)=>setQuery(e.target.value)} className="h-12 w-full rounded-xl border pl-10 pr-3" placeholder="Название, артикул, штрихкод..."/></div></div>
        {loading ? <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin"/></div> : <div className="divide-y">
          {filtered.map((item) => <article key={item.catalogId} className="grid gap-4 p-4 sm:p-5 xl:grid-cols-[1.6fr_.5fr_.5fr_.5fr_1.3fr_auto] xl:items-center">
            <div><div className="font-black">{item.name}</div><div className="mt-1 text-xs text-slate-400">{item.sku} · {item.barcode || "без штрихкода"}</div></div>
            <div><div className="text-xs text-slate-500">По 1С</div><div className="font-black">{fmt(item.quantity1c)} {item.unit}</div></div>
            <div><div className="text-xs text-slate-500">Факт</div><div className="font-black">{fmt(item.fact)} {item.unit}</div></div>
            <div><div className="text-xs text-amber-700">Излишек</div><div className="text-lg font-black text-amber-700">+{fmt(item.excess)} {item.unit}</div></div>
            <div><div className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-500">Где лежит</div><div className="flex flex-wrap gap-1.5">{item.locations.map((loc)=><span key={loc.cellId} className="rounded-full border bg-white px-2.5 py-1 text-xs font-semibold">{loc.storageType === "floor" ? "Пол" : `Стеллаж ${loc.rackCode}`} · {loc.cellCode} · {fmt(loc.quantity)} {item.unit}</span>)}</div></div>
            <div className="flex gap-2 xl:flex-col"><button onClick={()=>openAction("issue", item)} className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-bold text-white">Выдать</button><button onClick={()=>openAction("adjust", item)} className="rounded-xl border bg-white px-4 py-2 text-sm font-bold">Редактировать</button></div>
          </article>)}
          {!filtered.length && <div className="p-12 text-center text-slate-400">Излишков нет</div>}
        </div>}
      </section>
    </div>

    {draft && <div className="fixed inset-0 z-[50000] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm" onMouseDown={(e)=>{if(e.target===e.currentTarget&&!busy)setDraft(null);}}>
      <section className="w-full max-w-xl rounded-[28px] bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4"><div><div className="text-xs font-black uppercase tracking-[.14em] text-amber-600">{draft.type === "issue" ? "Выдача излишка" : "Корректировка излишка"}</div><h2 className="mt-1 text-2xl font-black">{draft.item.name}</h2><p className="mt-1 text-sm text-slate-500">Сейчас излишек: {fmt(draft.item.excess)} {draft.item.unit}</p></div><button onClick={()=>setDraft(null)} className="rounded-xl p-2 hover:bg-slate-100"><X/></button></div>
        <div className="mt-5"><label className="mb-1.5 block text-sm font-bold">{draft.type === "issue" ? "Из какой ячейки" : "Ячейка для увеличения"}</label><select value={cellId} onChange={(e)=>setCellId(e.target.value)} className="h-12 w-full rounded-xl border bg-white px-3"><option value="">Выберите...</option>{draft.item.locations.map((loc)=><option key={loc.cellId} value={loc.cellId}>{loc.storageType === "floor" ? "Напольная зона" : `Стеллаж ${loc.rackCode}`} · {loc.cellCode} · {fmt(loc.quantity)} {draft.item.unit}</option>)}</select></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_150px]"><div><label className="mb-1.5 block text-sm font-bold">{draft.type === "issue" ? "Количество" : "Новый общий излишек"}</label><input value={quantity} onChange={(e)=>setQuantity(e.target.value)} inputMode="decimal" className="h-11 w-full rounded-xl border px-3" placeholder="0,000001"/></div><div><label className="mb-1.5 block text-sm font-bold">Единица</label><select value={inputUnit} onChange={(e)=>setInputUnit(e.target.value)} className="h-11 w-full rounded-xl border bg-white px-3">{preciseUnits.map((u)=><option key={u}>{u}</option>)}</select></div></div>
        {draft.type === "issue" && <div className="mt-4"><label className="mb-1.5 block text-sm font-bold">Получатель / комментарий</label><input value={recipient} onChange={(e)=>setRecipient(e.target.value)} className="h-11 w-full rounded-xl border px-3"/></div>}
        <button disabled={busy || !quantity || (draft.type === "issue" && !cellId)} onClick={()=>void submit()} className="mt-5 h-12 w-full rounded-xl bg-orange-500 font-bold text-white disabled:opacity-50">{busy ? "Сохранение..." : draft.type === "issue" ? "Выдать из излишков" : "Сохранить излишек"}</button>
      </section>
    </div>}
  </main>;
}
