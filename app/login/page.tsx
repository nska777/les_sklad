"use client";

import { FormEvent, useState } from "react";
import { Loader2, LockKeyhole, TreePine, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: form.get("username"), password: form.get("password") }),
    });
    const body = await response.json() as { error?: string; redirect?: string };
    if (response.ok) window.location.href = body.redirect || "/";
    else {
      setError(body.error || "Не удалось войти");
      setLoading(false);
    }
  }

  return <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,.98),rgba(244,246,241,.92)_42%,rgba(236,239,232,.98)_100%)] p-4 text-[var(--foreground)] sm:p-6">
    <div className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-5xl items-center justify-center sm:min-h-[calc(100vh-3rem)]">
      <section className="grid w-full overflow-hidden rounded-[32px] border border-white/80 bg-white/80 shadow-[0_30px_90px_rgba(30,45,30,.14)] backdrop-blur-xl lg:grid-cols-[1.05fr_.95fr]">
        <div className="border-b border-black/5 p-7 sm:p-10 lg:border-b-0 lg:border-r">
          <div className="flex items-center gap-3">
            <div className="brand-mark"><TreePine size={22} /></div>
            <div><b>РУССКИЙ ЛЕС · RL СКЛАД</b><p className="text-xs text-[var(--muted-foreground)]">Единая складская система</p></div>
          </div>
          <div className="mt-12 max-w-xl">
            <div className="text-xs font-bold uppercase tracking-[.18em] text-orange-500">WMS / ERP</div>
            <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-5xl">Один вход для всех складов</h1>
            <p className="mt-5 text-sm leading-7 text-slate-500 sm:text-base">После авторизации система сама покажет только те склады и данные, к которым у сотрудника есть доступ.</p>
          </div>
        </div>
        <div className="p-7 sm:p-10 lg:p-12">
          <LockKeyhole className="mb-5 text-orange-500" size={36} />
          <div className="text-xs font-bold uppercase tracking-[.16em] text-slate-400">Авторизация</div>
          <h2 className="mt-2 text-2xl font-black">Вход в RL Склад</h2>
          <form onSubmit={submit} className="mt-8 space-y-4">
            <div><Label htmlFor="username">Логин</Label><div className="relative mt-2"><UserRound className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} /><Input id="username" name="username" autoComplete="username" required autoFocus className="h-12 pl-10" placeholder="Введите логин" /></div></div>
            <div><Label htmlFor="password">Пароль</Label><Input id="password" name="password" type="password" autoComplete="current-password" required className="mt-2 h-12" placeholder="Введите пароль" /></div>
            {error && <p className="rounded-xl bg-red-50 p-3 text-sm font-medium text-red-700">{error}</p>}
            <Button className="accent-button h-12 w-full" disabled={loading}>{loading ? <Loader2 className="animate-spin" /> : <LockKeyhole />} Войти в систему</Button>
          </form>
        </div>
      </section>
    </div>
  </main>;
}
