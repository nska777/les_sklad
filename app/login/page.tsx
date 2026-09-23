"use client";

import Link from "next/link";
import { FormEvent, Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Boxes, Layers3, Loader2, LockKeyhole, PaintBucket, TreePine, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type WarehouseCode = "hardware" | "paint" | "ldsp";

const departments: Array<{ code: WarehouseCode; name: string; icon: typeof Boxes; note: string }> = [
  { code: "hardware", name: "Склад фурнитуры", icon: Boxes, note: "Фурнитура и комплектующие" },
  { code: "paint", name: "Склад краски", icon: PaintBucket, note: "Краски, лаки, эмали" },
  { code: "ldsp", name: "Склад ЛДСП", icon: Layers3, note: "Листы и плитные материалы" },
];

function LoginContent() {
  const params = useSearchParams();
  const initialWarehouse = params.get("warehouse") as WarehouseCode | null;
  const [warehouse, setWarehouse] = useState<WarehouseCode>(initialWarehouse && departments.some((item) => item.code === initialWarehouse) ? initialWarehouse : "hardware");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const active = useMemo(() => departments.find((item) => item.code === warehouse)!, [warehouse]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: form.get("username"), password: form.get("password"), warehouse }),
    });
    const body = await response.json() as { error?: string; redirect?: string };
    if (response.ok) window.location.href = body.redirect || (warehouse === "hardware" ? "/warehouse" : `/department/${warehouse}`);
    else {
      setError(body.error || "Не удалось войти");
      setLoading(false);
    }
  }

  return <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,.98),rgba(244,246,241,.92)_42%,rgba(236,239,232,.98)_100%)] p-4 text-[var(--foreground)] sm:p-6">
    <div className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-6xl items-center justify-center sm:min-h-[calc(100vh-3rem)]">
      <section className="grid w-full overflow-hidden rounded-[32px] border border-white/80 bg-white/75 shadow-[0_30px_90px_rgba(30,45,30,.14)] backdrop-blur-xl lg:grid-cols-[1.05fr_.95fr]">
        <div className="border-b border-black/5 p-6 sm:p-9 lg:border-b-0 lg:border-r">
          <div className="mb-8 flex items-center gap-3">
            <div className="brand-mark"><TreePine size={22} /></div>
            <div><b>РУССКИЙ ЛЕС · RL СКЛАД</b><p className="text-xs text-[var(--muted-foreground)]">Доступ по подразделениям</p></div>
          </div>
          <div className="mb-5"><h1 className="text-2xl font-black tracking-tight sm:text-3xl">Выберите склад</h1><p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">После входа сотрудник увидит только данные назначенного ему подразделения.</p></div>
          <div className="grid gap-3">
            {departments.map((department) => {
              const Icon = department.icon;
              const selected = warehouse === department.code;
              return <button key={department.code} type="button" onClick={() => { setWarehouse(department.code); setError(""); }} className={`flex items-center gap-4 rounded-2xl border p-4 text-left transition ${selected ? "border-slate-900 bg-slate-950 text-white shadow-lg" : "border-black/10 bg-white/80 hover:-translate-y-0.5 hover:border-black/20 hover:shadow-md"}`}>
                <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${selected ? "bg-white/12" : "bg-slate-100 text-slate-800"}`}><Icon size={21} /></span>
                <span className="min-w-0"><span className="block font-extrabold">{department.name}</span><span className={`mt-0.5 block text-xs ${selected ? "text-white/65" : "text-slate-500"}`}>{department.note}</span></span>
              </button>;
            })}
          </div>
          <Link href="/departments" className="mt-6 inline-flex text-sm font-semibold text-slate-500 transition hover:text-slate-950">← Вернуться к подразделениям</Link>
        </div>
        <div className="p-6 sm:p-9 lg:p-10">
          <div className="mb-7"><LockKeyhole className="mb-4 text-orange-500" size={34} /><div className="text-xs font-bold uppercase tracking-[.16em] text-slate-400">Авторизация</div><h2 className="mt-2 text-2xl font-black">{active.name}</h2><p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">Введите персональный логин и пароль. Все складские операции будут записываться от имени вошедшего сотрудника.</p></div>
          <form onSubmit={submit} className="space-y-4">
            <div><Label htmlFor="username">Логин</Label><div className="relative mt-2"><UserRound className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} /><Input id="username" name="username" autoComplete="username" required autoFocus className="h-12 pl-10" placeholder={warehouse === "paint" ? "Например: mariana" : "Например: roman"} /></div></div>
            <div><Label htmlFor="password">Пароль</Label><Input id="password" name="password" type="password" autoComplete="current-password" required className="mt-2 h-12" placeholder="Введите пароль" /></div>
            {error && <p className="rounded-xl bg-red-50 p-3 text-sm font-medium text-red-700">{error}</p>}
            <Button className="accent-button h-12 w-full" disabled={loading}>{loading ? <Loader2 className="animate-spin" /> : <LockKeyhole />} Войти в {active.name.toLowerCase()}</Button>
          </form>
        </div>
      </section>
    </div>
  </main>;
}

export default function LoginPage() {
  return <Suspense fallback={<main className="flex min-h-screen items-center justify-center"><Loader2 className="animate-spin text-orange-500" size={34} /></main>}><LoginContent /></Suspense>;
}
