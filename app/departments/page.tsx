"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Boxes, Layers3, Loader2, PaintBucket, TreePine } from "lucide-react";

type WarehouseCode = "hardware" | "paint" | "ldsp";
type Me = { name: string; role: string; warehouse: WarehouseCode; warehouses: WarehouseCode[] };

const departments: Array<{ code: WarehouseCode; name: string; description: string; icon: typeof Boxes; accent: string; badge: string }> = [
  { code: "hardware", name: "Склад фурнитуры", description: "Фурнитура и комплектующие", icon: Boxes, accent: "from-slate-900 to-slate-700", badge: "Работает" },
  { code: "paint", name: "Склад краски", description: "Краски, эмали, лаки и расходные материалы", icon: PaintBucket, accent: "from-orange-500 to-amber-400", badge: "Работает" },
  { code: "ldsp", name: "Склад ЛДСП", description: "Листы, декоры и плитные материалы", icon: Layers3, accent: "from-zinc-700 to-stone-500", badge: "Подготовлен" },
];

export default function DepartmentsPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState<WarehouseCode | null>(null);

  useEffect(() => {
    void fetch("/api/auth/me", { cache: "no-store" })
      .then(async (response) => response.ok ? (await response.json() as { user?: Me }).user || null : null)
      .then(setMe)
      .finally(() => setLoading(false));
  }, []);

  const available = useMemo(() => {
    if (!me) return [];
    return departments.filter((department) => me.warehouses?.includes(department.code));
  }, [me]);

  const openWarehouse = async (warehouse: WarehouseCode) => {
    setSwitching(warehouse);
    const response = await fetch("/api/auth/switch-warehouse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ warehouse }),
    });
    const body = await response.json() as { redirect?: string; error?: string };
    if (response.ok) window.location.href = body.redirect || (warehouse === "hardware" ? "/warehouse" : `/department/${warehouse}`);
    else {
      alert(body.error || "Не удалось открыть склад");
      setSwitching(null);
    }
  };

  if (loading) return <main className="flex min-h-screen items-center justify-center"><Loader2 className="animate-spin text-orange-500" size={34} /></main>;

  return <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,.95),rgba(244,246,241,.9)_38%,rgba(236,239,232,.96)_100%)] px-4 py-8 text-slate-950 sm:px-6 sm:py-12">
    <div className="mx-auto max-w-6xl">
      <div className="mb-8 flex items-center gap-3 sm:mb-12">
        <div className="brand-mark"><TreePine size={22} /></div>
        <div><div className="text-[15px] font-extrabold tracking-tight">РУССКИЙ ЛЕС · RL СКЛАД</div><div className="text-xs text-slate-500">{me?.name || "Пользователь"}</div></div>
      </div>

      <section className="mb-8 max-w-3xl sm:mb-10">
        <span className="inline-flex rounded-full border border-black/10 bg-white/75 px-3 py-1 text-xs font-semibold text-slate-600 shadow-sm backdrop-blur">Единая складская система</span>
        <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-5xl">Выберите склад</h1>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        {available.map((department) => {
          const Icon = department.icon;
          return <button key={department.code} type="button" onClick={() => void openWarehouse(department.code)} disabled={switching !== null} className="group relative overflow-hidden rounded-[28px] border border-white/80 bg-white/85 p-5 text-left shadow-[0_20px_70px_rgba(32,45,32,.10)] backdrop-blur-xl transition duration-300 hover:-translate-y-1 hover:shadow-[0_26px_80px_rgba(32,45,32,.16)] disabled:opacity-60 sm:p-6">
            <div className={`absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r ${department.accent}`} />
            <div className="flex items-start justify-between gap-4"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-lg"><Icon size={23} /></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600">{department.badge}</span></div>
            <h2 className="mt-8 text-xl font-black tracking-tight">{department.name}</h2>
            <p className="mt-2 min-h-12 text-sm leading-6 text-slate-500">{department.description}</p>
            <div className="mt-7 flex items-center justify-between border-t border-slate-100 pt-4 text-sm font-bold"><span>{switching === department.code ? "Открываю…" : "Открыть склад"}</span><span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-950 text-white transition group-hover:translate-x-1">{switching === department.code ? <Loader2 size={17} className="animate-spin" /> : <ArrowRight size={17} />}</span></div>
          </button>;
        })}
      </div>

      {!available.length && <div className="rounded-2xl border bg-white/80 p-6 text-sm text-slate-600">Для вашего аккаунта пока не назначен склад. Обратитесь к администратору.</div>}
    </div>
  </main>;
}
