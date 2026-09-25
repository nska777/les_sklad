"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { ArrowLeft, Boxes, Layers3, Loader2, PaintBucket, Plus, ShieldCheck, UserCog, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

type Role = "admin" | "manager" | "storekeeper" | "viewer";
type WarehouseCode = "hardware" | "paint" | "ldsp";
type User = { id: string; username: string; name: string; role: Role; warehouseCode: string; warehouses: WarehouseCode[]; active: boolean; createdAt: string };
type Me = { username: string; name: string; role: Role; warehouse?: WarehouseCode; warehouses?: WarehouseCode[] };

const roleLabel: Record<Role, string> = { admin: "Администратор", manager: "Заведующий складом", storekeeper: "Кладовщик", viewer: "Только просмотр" };
const warehouseLabel: Record<WarehouseCode, string> = { hardware: "Склад фурнитуры", paint: "Склад краски", ldsp: "Склад ЛДСП" };
const warehouseIcon = { hardware: Boxes, paint: PaintBucket, ldsp: Layers3 } as const;
const warehouseCodes: WarehouseCode[] = ["hardware", "paint", "ldsp"];

function selectedWarehouses(form: FormData): WarehouseCode[] {
  return warehouseCodes.filter((code) => form.get(`warehouse_${code}`) === "on");
}

function WarehouseChecks({ defaults = ["hardware"], disabled = false }: { defaults?: WarehouseCode[]; disabled?: boolean }) {
  return <div className="grid gap-2 sm:grid-cols-3">
    {warehouseCodes.map((code) => {
      const Icon = warehouseIcon[code];
      return <label key={code} className="flex cursor-pointer items-center gap-2 rounded-xl border bg-white p-3 text-sm font-semibold">
        <input type="checkbox" name={`warehouse_${code}`} defaultChecked={defaults.includes(code)} disabled={disabled} />
        <Icon size={16} className="text-orange-500" /> {warehouseLabel[code].replace("Склад ", "")}
      </label>;
    })}
  </div>;
}

export default function UsersSettingsPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [meResponse, usersResponse] = await Promise.all([fetch("/api/auth/me", { cache: "no-store" }), fetch("/api/admin/users", { cache: "no-store" })]);
      if (meResponse.ok) setMe(((await meResponse.json()) as { user?: Me }).user || null);
      const body = await usersResponse.json() as { users?: User[]; error?: string };
      if (!usersResponse.ok) throw new Error(body.error || "Нет доступа");
      setUsers((body.users || []).map((user) => ({ ...user, warehouses: user.warehouses?.length ? user.warehouses : ["hardware"] })));
    } catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось загрузить пользователей"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const createUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const role = String(form.get("role")) as Role;
    const warehouses = role === "admin" ? warehouseCodes : selectedWarehouses(form);
    if (!warehouses.length) return toast.error("Назначьте хотя бы один склад");
    setSaving(true);
    try {
      const response = await fetch("/api/admin/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create", username: form.get("username"), name: form.get("name"), password: form.get("password"), role, warehouses }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Не удалось создать пользователя");
      toast.success("Пользователь создан"); setCreateOpen(false); await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Ошибка создания"); }
    finally { setSaving(false); }
  };

  const updateUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!editing) return;
    const form = new FormData(event.currentTarget);
    const role = String(form.get("role")) as Role;
    const warehouses = role === "admin" ? warehouseCodes : selectedWarehouses(form);
    if (!warehouses.length) return toast.error("Назначьте хотя бы один склад");
    setSaving(true);
    try {
      const response = await fetch("/api/admin/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "update", id: editing.id, name: form.get("name"), password: form.get("password"), role, warehouses, active: form.get("active") === "on" }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Не удалось сохранить пользователя");
      toast.success("Пользователь обновлён"); setEditing(null); await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Ошибка сохранения"); }
    finally { setSaving(false); }
  };

  return <main className="min-h-screen px-3 py-4 text-[var(--foreground)] sm:px-5 lg:px-7">
    <div className="mx-auto max-w-[1400px] space-y-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div><Link href="/departments" className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-blue-700 hover:underline"><ArrowLeft size={16} /> К складам</Link><p className="eyebrow">Администрирование</p><h1 className="page-title">Пользователи и доступы</h1><p className="page-description">Один аккаунт может иметь доступ к одному или нескольким складам.</p></div>
        <div className="flex flex-wrap items-center gap-2">{me && <div className="flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm"><ShieldCheck size={17} className="text-blue-600" /><div><b>{me.name}</b><div className="text-xs text-slate-500">{roleLabel[me.role]}</div></div></div>}<Button onClick={() => setCreateOpen(true)} className="accent-button"><Plus /> Новый пользователь</Button></div>
      </div>

      <section className="grid gap-3 md:grid-cols-3">
        {warehouseCodes.map((code) => { const Icon = warehouseIcon[code]; const count = users.filter((user) => user.active && user.warehouses.includes(code)).length; return <div key={code} className="panel p-4"><div className="flex items-center justify-between"><div className="flex items-center gap-2 font-bold"><Icon size={18} /> {warehouseLabel[code]}</div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-500">{count}</span></div></div>; })}
      </section>

      <section className="panel overflow-hidden">
        <div className="flex items-center justify-between border-b border-black/10 p-4"><div className="flex items-center gap-2 font-bold"><Users size={19} /> Сотрудники</div><span className="text-sm text-slate-500">{users.length}</span></div>
        {loading ? <div className="flex min-h-72 items-center justify-center"><Loader2 className="animate-spin" /></div> : <div className="divide-y divide-black/10">{users.map((user) => <div key={user.id} className="grid gap-3 p-4 lg:grid-cols-[1fr_180px_1fr_100px_auto] lg:items-center"><div><div className="font-bold">{user.name}</div><div className="mt-1 font-mono text-xs text-slate-500">{user.username}</div></div><div><span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold">{roleLabel[user.role]}</span></div><div className="flex flex-wrap gap-1.5">{user.warehouses.map((code) => <span key={code} className="rounded-full border bg-white px-2.5 py-1 text-xs font-semibold">{warehouseLabel[code].replace("Склад ", "")}</span>)}</div><div className={`text-sm font-semibold ${user.active ? "text-emerald-700" : "text-red-600"}`}>{user.active ? "Активен" : "Отключён"}</div><Button variant="outline" size="sm" onClick={() => setEditing(user)}>Изменить</Button></div>)}</div>}
      </section>
    </div>

    <Dialog open={createOpen} onOpenChange={setCreateOpen}><DialogContent className="sm:max-w-xl"><form onSubmit={createUser}><DialogHeader><DialogTitle>Новый пользователь</DialogTitle><DialogDescription>Назначьте один или несколько складов. Администратор получает доступ ко всем.</DialogDescription></DialogHeader><div className="mt-5 space-y-4"><div><Label>ФИО / имя</Label><Input name="name" required className="mt-2" /></div><div><Label>Логин</Label><Input name="username" required className="mt-2" /></div><div><Label>Роль</Label><NativeSelect name="role" defaultValue="storekeeper" className="mt-2 w-full">{Object.entries(roleLabel).map(([value, label]) => <NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}</NativeSelect></div><div><Label>Доступ к складам</Label><div className="mt-2"><WarehouseChecks defaults={["hardware"]} /></div></div><div><Label>Пароль</Label><Input name="password" type="password" minLength={6} required className="mt-2" /></div></div><DialogFooter className="mt-6"><Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Отмена</Button><Button disabled={saving} className="accent-button">{saving ? <Loader2 className="animate-spin" /> : <Plus />} Создать</Button></DialogFooter></form></DialogContent></Dialog>

    <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}><DialogContent className="sm:max-w-xl">{editing && <form key={editing.id} onSubmit={updateUser}><DialogHeader><DialogTitle>Изменить пользователя</DialogTitle><DialogDescription>{editing.username}</DialogDescription></DialogHeader><div className="mt-5 space-y-4"><div><Label>ФИО / имя</Label><Input name="name" required defaultValue={editing.name} className="mt-2" /></div><div><Label>Роль</Label><NativeSelect name="role" defaultValue={editing.role} className="mt-2 w-full">{Object.entries(roleLabel).map(([value, label]) => <NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}</NativeSelect></div><div><Label>Доступ к складам</Label><div className="mt-2"><WarehouseChecks defaults={editing.warehouses} /></div></div><div><Label>Новый пароль</Label><Input name="password" type="password" minLength={6} className="mt-2" placeholder="Не менять" /></div><label className="flex cursor-pointer items-center gap-3 rounded-xl border p-3"><input type="checkbox" name="active" defaultChecked={editing.active} /><span className="font-semibold">Пользователь активен</span></label></div><DialogFooter className="mt-6"><Button type="button" variant="outline" onClick={() => setEditing(null)}>Отмена</Button><Button disabled={saving} className="accent-button"><UserCog size={16} /> Сохранить</Button></DialogFooter></form>}</DialogContent></Dialog>
  </main>;
}
