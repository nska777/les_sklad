"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Boxes, Layers3, LogOut, PaintBucket, Settings, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

type WarehouseCode = "hardware" | "paint" | "ldsp";
type User = { name: string; role: "admin" | "manager" | "storekeeper" | "viewer"; warehouse: WarehouseCode; warehouses: WarehouseCode[] };
const roleLabel: Record<User["role"], string> = { admin: "Администратор", manager: "Заведующий", storekeeper: "Кладовщик", viewer: "Просмотр" };
const warehouseLabel: Record<WarehouseCode, string> = { hardware: "Фурнитура", paint: "Краска", ldsp: "ЛДСП" };
const warehouseIcon = { hardware: Boxes, paint: PaintBucket, ldsp: Layers3 } as const;

export function SessionMenu() {
  const [user, setUser] = useState<User | null>(null);
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);

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

  const switchWarehouse = async (warehouse: WarehouseCode) => {
    if (warehouse === user.warehouse || switching) return;
    setSwitching(true);
    const response = await fetch("/api/auth/switch-warehouse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ warehouse }) });
    const body = await response.json() as { redirect?: string };
    if (response.ok) window.location.href = body.redirect || "/departments";
    else setSwitching(false);
  };

  return <div className="no-print fixed bottom-4 left-4 z-[70] sm:bottom-5 sm:left-5">
    <button type="button" onClick={() => setOpen((value) => !value)} aria-label={`Профиль: ${user.name}`} title={`${user.name} · ${roleLabel[user.role]}`} className="flex h-11 w-11 items-center justify-center rounded-full border border-black/10 bg-white/95 shadow-lg backdrop-blur transition hover:bg-white hover:shadow-xl">
      <ShieldCheck size={20} className="text-blue-600" />
    </button>

    {open && <div className="absolute bottom-14 left-0 w-[min(90vw,320px)] rounded-2xl border border-black/10 bg-white/95 p-3 shadow-2xl backdrop-blur">
      <div className="flex items-center gap-2 rounded-xl bg-slate-50 p-3"><ShieldCheck className="text-blue-600" size={18} /><div className="min-w-0"><div className="truncate text-sm font-bold">{user.name}</div><div className="text-xs text-slate-500">{roleLabel[user.role]} · {warehouseLabel[user.warehouse]}</div></div></div>
      {user.warehouses?.length > 1 && <div className="mt-2 rounded-xl border p-2"><div className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">Переключить склад</div><div className="grid gap-1">{user.warehouses.map((code) => { const Icon = warehouseIcon[code]; return <button key={code} type="button" disabled={switching} onClick={() => void switchWarehouse(code)} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold transition ${code === user.warehouse ? "bg-slate-950 text-white" : "hover:bg-slate-100"}`}><Icon size={15} /> {warehouseLabel[code]}</button>; })}</div></div>}
      <div className="mt-2 grid gap-2">
        {user.warehouses?.length > 1 && <Button asChild variant="outline" size="sm" className="justify-start"><Link href="/departments"><Boxes /> Все доступные склады</Link></Button>}
        {user.role === "admin" && <Button asChild variant="outline" size="sm" className="justify-start"><Link href="/settings/users"><Settings /> Пользователи и права</Link></Button>}
        <Button variant="outline" size="sm" className="justify-start text-red-600" onClick={() => void logout()}><LogOut /> Выйти</Button>
      </div>
    </div>}
  </div>;
}
