"use client";

import { FormEvent, useState } from "react";
import { Loader2, LockKeyhole, TreePine } from "lucide-react";
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
      body: JSON.stringify({ password: form.get("password") }),
    });
    if (response.ok) window.location.href = "/";
    else {
      const body = await response.json() as { error?: string };
      setError(body.error || "Не удалось войти");
      setLoading(false);
    }
  }

  return <main className="flex min-h-screen items-center justify-center p-5 text-[var(--foreground)]">
    <section className="panel w-full max-w-md p-7 sm:p-9">
      <div className="mb-7 flex items-center gap-3"><div className="brand-mark"><TreePine size={22} /></div><div><b>РУССКИЙ ЛЕС · СКЛАД</b><p className="text-xs text-[var(--muted-foreground)]">Защищённый доступ</p></div></div>
      <div className="mb-6"><LockKeyhole className="mb-4 text-orange-500" size={34} /><h1 className="text-2xl font-bold">Вход на склад</h1><p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">Введите пароль, который выдал заведующий складом.</p></div>
      <form onSubmit={submit} className="space-y-4"><div><Label htmlFor="password">Пароль</Label><Input id="password" name="password" type="password" autoComplete="current-password" required autoFocus className="mt-2 h-12" placeholder="Введите пароль" /></div>{error && <p className="text-sm font-medium text-red-600">{error}</p>}<Button className="accent-button h-12 w-full" disabled={loading}>{loading ? <Loader2 className="animate-spin" /> : <LockKeyhole />} Войти</Button></form>
    </section>
  </main>;
}
