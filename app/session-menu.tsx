"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LogOut, Settings, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

type User = { name: string; role: "admin" | "manager" | "storekeeper" | "viewer" };
const roleLabel: Record<User["role"], string> = { admin: "Администратор", manager: "Заведующий", storekeeper: "Кладовщик", viewer: "Просмотр" };

export function SessionMenu() {
  const [user, setUser] = useState<User | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    void fetch("/api/auth/me", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) return;
      const body = await response.json() as { user?: User };
      setUser(body.user || null);
    }).catch(() => undefined);
  }, []);

  if (!user) return null;

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  return <div className="no-print fixed bottom-4 left-4 z-[70] sm:bottom-5 sm:left-5">
    <button
      type="button"
      onClick={() => setOpen((value) => !value)}
      aria-label={`Профиль: ${user.name}`}
      title={`${user.name} · ${roleLabel[user.role]}`}
      className="flex h-11 w-11 items-center justify-center rounded-full border border-black/10 bg-white/95 shadow-lg backdrop-blur transition hover:bg-white hover:shadow-xl"
    >
      <ShieldCheck size={20} className="text-blue-600" />
    </button>

    {open && <div className="absolute bottom-14 left-0 w-[min(88vw,290px)] rounded-2xl border border-black/10 bg-white/95 p-3 shadow-2xl backdrop-blur">
      <div className="flex items-center gap-2 rounded-xl bg-slate-50 p-3">
        <ShieldCheck className="text-blue-600" size={18} />
        <div className="min-w-0">
          <div className="truncate text-sm font-bold">{user.name}</div>
          <div className="text-xs text-slate-500">{roleLabel[user.role]}</div>
        </div>
      </div>
      <div className="mt-2 grid gap-2">
        {user.role === "admin" && <Button asChild variant="outline" size="sm" className="justify-start"><Link href="/settings/users"><Settings /> Пользователи и роли</Link></Button>}
        <Button variant="outline" size="sm" className="justify-start text-red-600" onClick={() => void logout()}><LogOut /> Выйти</Button>
      </div>
    </div>}
  </div>;
}
