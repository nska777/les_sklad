"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { ArrowLeft, Loader2, Plus, ShieldCheck, UserCog, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

type Role = "admin" | "manager" | "storekeeper" | "viewer";
type User = { id: string; username: string; name: string; role: Role; active: boolean; createdAt: string };
type Me = { username: string; name: string; role: Role };

const roleLabel: Record<Role, string> = {
  admin: "Администратор",
  manager: "Заведующий складом",
  storekeeper: "Кладовщик",
  viewer: "Только просмотр",
};

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
      const [meResponse, usersResponse] = await Promise.all([
        fetch("/api/auth/me", { cache: "no-store" }),
        fetch("/api/admin/users", { cache: "no-store" }),
      ]);
      if (meResponse.ok) setMe(((await meResponse.json()) as { user?: Me }).user || null);
      const body = await usersResponse.json() as { users?: User[]; error?: string };
      if (!usersResponse.ok) throw new Error(body.error || "Нет доступа");
      setUsers(body.users || []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось загрузить пользователей");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const createUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", username: form.get("username"), name: form.get("name"), password: form.get("password"), role: form.get("role") }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Не удалось создать пользователя");
      toast.success("Пользователь создан");
      setCreateOpen(false);
      await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Ошибка создания"); }
    finally { setSaving(false); }
  };

  const updateUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing) return;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update", id: editing.id, name: form.get("name"), password: form.get("password"), role: form.get("role"), active: form.get("active") === "on" }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Не удалось сохранить пользователя");
      toast.success("Пользователь обновлён");
      setEditing(null);
      await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Ошибка сохранения"); }
    finally { setSaving(false); }
  };

  return <main className="min-h-screen px-3 py-4 text-[var(--foreground)] sm:px-5 lg:px-7">
    <div className="mx-auto max-w-[1400px] space-y-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div><Link href="/" className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-blue-700 hover:underline"><ArrowLeft size={16} /> Назад в склад</Link><p className="eyebrow">Администрирование</p><h1 className="page-title">Пользователи и роли</h1><p className="page-description">Персональные логины. Действия склада сохраняются от имени вошедшего сотрудника.</p></div>
        <div className="flex flex-wrap items-center gap-2">{me && <div className="flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm"><ShieldCheck size={17} className="text-blue-600" /><div><b>{me.name}</b><div className="text-xs text-slate-500">{roleLabel[me.role]}</div></div></div>}<Button onClick={() => setCreateOpen(true)} className="accent-button"><Plus /> Новый пользователь</Button></div>
      </div>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {(["admin", "manager", "storekeeper", "viewer"] as Role[]).map((role) => <div key={role} className="panel p-4"><div className="flex items-center gap-2 font-bold"><UserCog size={18} />{roleLabel[role]}</div><p className="mt-2 text-sm leading-6 text-slate-500">{role === "admin" ? "Полный доступ, пользователи, настройки и все операции." : role === "manager" ? "Все складские операции и контроль, без управления пользователями." : role === "storekeeper" ? "Приёмка, размещение, перемещение, выдача и корректировки." : "Просмотр остатков, 3D, истории и этикеток без изменений."}</p></div>)}
      </section>

      <section className="panel overflow-hidden">
        <div className="flex items-center justify-between border-b border-black/10 p-4"><div className="flex items-center gap-2 font-bold"><Users size={19} /> Сотрудники</div><span className="text-sm text-slate-500">{users.length}</span></div>
        {loading ? <div className="flex min-h-72 items-center justify-center"><Loader2 className="animate-spin" /></div> : <div className="divide-y divide-black/10">{users.map((user) => <div key={user.id} className="grid gap-3 p-4 sm:grid-cols-[1fr_200px_110px_auto] sm:items-center"><div><div className="font-bold">{user.name}</div><div className="mt-1 font-mono text-xs text-slate-500">{user.username}</div></div><div><span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold">{roleLabel[user.role]}</span></div><div className={`text-sm font-semibold ${user.active ? "text-emerald-700" : "text-red-600"}`}>{user.active ? "Активен" : "Отключён"}</div><Button variant="outline" size="sm" onClick={() => setEditing(user)}>Изменить</Button></div>)}</div>}
      </section>
    </div>

    <Dialog open={createOpen} onOpenChange={setCreateOpen}><DialogContent className="sm:max-w-lg"><form onSubmit={createUser}><DialogHeader><DialogTitle>Новый пользователь</DialogTitle><DialogDescription>Логин хранится в нижнем регистре. Пароль — минимум 6 символов.</DialogDescription></DialogHeader><div className="mt-5 space-y-4"><div><Label>ФИО / имя</Label><Input name="name" required className="mt-2" placeholder="Иван Иванов" /></div><div><Label>Логин</Label><Input name="username" required className="mt-2" placeholder="ivan" /></div><div><Label>Роль</Label><NativeSelect name="role" defaultValue="storekeeper" className="mt-2 w-full">{Object.entries(roleLabel).map(([value, label]) => <NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}</NativeSelect></div><div><Label>Пароль</Label><Input name="password" type="password" minLength={6} required className="mt-2" /></div></div><DialogFooter className="mt-6"><Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Отмена</Button><Button disabled={saving} className="accent-button">{saving ? <Loader2 className="animate-spin" /> : <Plus />} Создать</Button></DialogFooter></form></DialogContent></Dialog>

    <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}><DialogContent className="sm:max-w-lg">{editing && <form key={editing.id} onSubmit={updateUser}><DialogHeader><DialogTitle>Изменить пользователя</DialogTitle><DialogDescription>{editing.username}. Оставьте новый пароль пустым, если менять его не нужно.</DialogDescription></DialogHeader><div className="mt-5 space-y-4"><div><Label>ФИО / имя</Label><Input name="name" required defaultValue={editing.name} className="mt-2" /></div><div><Label>Роль</Label><NativeSelect name="role" defaultValue={editing.role} className="mt-2 w-full">{Object.entries(roleLabel).map(([value, label]) => <NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}</NativeSelect></div><div><Label>Новый пароль</Label><Input name="password" type="password" minLength={6} className="mt-2" placeholder="Не менять" /></div><label className="flex cursor-pointer items-center gap-3 rounded-xl border p-3"><input type="checkbox" name="active" defaultChecked={editing.active} /><span className="font-semibold">Пользователь активен</span></label></div><DialogFooter className="mt-6"><Button type="button" variant="outline" onClick={() => setEditing(null)}>Отмена</Button><Button disabled={saving} className="accent-button">Сохранить</Button></DialogFooter></form>}</DialogContent></Dialog>
  </main>;
}
