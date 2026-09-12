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
    if (response.ok) window.location.href = "/warehouse";
    else {
      const body = await response.json() as { error?: string };
      setError(body.error || "Не удалось войти");
      setLoading(false);
    }
  }

  return <main className="flex min-h-screen items-center justify-center p-4 text-[var(--foreground)] sm:p-6">
    <section className="panel w-full max-w-md p-6 sm:p-9">
      <div className="mb-7 flex items-center gap-3"><div className="brand-mark"><TreePine size={22} /></div><div><b>РУССКИЙ ЛЕС · СКЛАД</b><p className="text-xs text-[var(--muted-foreground)]">Персональный доступ</p></div></div>
      <div className="mb-6"><LockKeyhole className="mb-4 text-orange-500" size={34} /><h1 className="text-2xl font-bold">Вход на склад</h1><p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">Используйте свой логин. Все операции будут записываться от имени вошедшего сотрудника.</p></div>
      <form onSubmit={submit} className="space-y-4">
        <div><Label htmlFor="username">Логин</Label><div className="relative mt-2"><UserRound className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} /><Input id="username" name="username" autoComplete="username" required autoFocus className="h-12 pl-10" placeholder="Например: roman" defaultValue="admin" /></div></div>
        <div><Label htmlFor="password">Пароль</Label><Input id="password" name="password" type="password" autoComplete="current-password" required className="mt-2 h-12" placeholder="Введите пароль" /></div>
        {error && <p className="rounded-xl bg-red-50 p-3 text-sm font-medium text-red-700">{error}</p>}
        <Button className="accent-button h-12 w-full" disabled={loading}>{loading ? <Loader2 className="animate-spin" /> : <LockKeyhole />} Войти</Button>
      </form>
    </section>
  </main>;
}
