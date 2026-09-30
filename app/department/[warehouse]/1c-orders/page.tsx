"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

type ApiErrorBody = {
  error?: string | { message?: string };
};

type TaskLine = {
  lineId: string;
  productId: string;
  sku: string;
  name: string;
  unit: string;
  plannedQuantity: number;
  issuedQuantity: number;
  reservedQuantity: number;
  remainingQuantity: number;
  status: string;
};

type Task = {
  documentId: string;
  documentNumber: string;
  documentDate: string;
  operation: string;
  warehouseCode: string;
  status: string;
  sourceUser: string;
  customerOrderId: string;
  comment: string;
  summary: { plannedQuantity: number; issuedQuantity: number; remainingQuantity: number };
  items: TaskLine[];
};

type TasksResponse = ApiErrorBody & {
  tasks?: Task[];
};

type IssueResponse = ApiErrorBody & {
  shortage?: boolean;
  line?: {
    issuedQuantity?: number;
  };
};

const statusLabel: Record<string, string> = {
  received: "Новое",
  in_progress: "В работе",
  partial: "Частично выдано",
  waiting_supply: "Ожидает пополнения",
  ready_for_completion: "Готово к довыдаче",
  completed: "Выполнено",
  cancelled: "Отменено",
};

const warehouseLabel: Record<string, string> = {
  hardware: "Склад фурнитуры",
  paint: "Склад краски",
  ldsp: "Склад ЛДСП",
};

function apiMessage(body: ApiErrorBody, fallback: string) {
  if (typeof body.error === "string") return body.error;
  if (body.error && typeof body.error === "object" && typeof body.error.message === "string") return body.error.message;
  return fallback;
}

export default function OnecOrdersPage() {
  const params = useParams<{ warehouse: string }>();
  const warehouse = String(params?.warehouse || "");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/integration/1c/tasks?warehouse=${encodeURIComponent(warehouse)}`, { cache: "no-store" });
      const body = await response.json() as TasksResponse;
      if (!response.ok) throw new Error(apiMessage(body, "Не удалось загрузить задания"));
      setTasks(Array.isArray(body.tasks) ? body.tasks : []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, [warehouse]);

  useEffect(() => { if (warehouse) void load(); }, [warehouse, load]);

  const counters = useMemo(() => ({
    total: tasks.length,
    waiting: tasks.filter((task) => task.status === "waiting_supply").length,
    active: tasks.filter((task) => ["received", "in_progress", "partial", "ready_for_completion"].includes(task.status)).length,
  }), [tasks]);

  async function start(task: Task) {
    setBusy(task.documentId);
    setMessage("");
    try {
      const response = await fetch(`/api/integration/1c/orders/${encodeURIComponent(task.documentId)}/wms-event`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "start", operationId: `START-${task.documentId}-${Date.now()}` }),
      });
      const body = await response.json() as ApiErrorBody;
      if (!response.ok) throw new Error(apiMessage(body, "Не удалось начать сборку"));
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка");
    } finally {
      setBusy("");
    }
  }

  async function issue(task: Task, line: TaskLine, quantity: number) {
    if (!quantity || quantity <= 0) return;
    setBusy(`${task.documentId}:${line.lineId}`);
    setMessage("");
    try {
      const response = await fetch(`/api/integration/1c/tasks/${encodeURIComponent(task.documentId)}/issue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineId: line.lineId, quantity, operationId: `ISSUE-${task.documentId}-${line.lineId}-${Date.now()}` }),
      });
      const body = await response.json() as IssueResponse;
      if (!response.ok) throw new Error(apiMessage(body, "Не удалось выполнить выдачу"));
      if (body.shortage) setMessage(`Выдано доступное количество. Недостача по «${line.name}» поставлена в ожидание закупки.`);
      else setMessage(`«${line.name}» выдано: ${body.line?.issuedQuantity ?? quantity} ${line.unit}`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка выдачи");
    } finally {
      setBusy("");
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 p-4 md:p-8 text-slate-900">
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link href={`/department/${warehouse}`} className="text-sm font-medium text-blue-600 hover:underline">← Назад на склад</Link>
            <h1 className="mt-2 text-3xl font-bold">Задания из 1С</h1>
            <p className="text-sm text-slate-500">{warehouseLabel[warehouse] || warehouse}</p>
          </div>
          <button onClick={() => void load()} className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-medium hover:bg-slate-100">Обновить</button>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl bg-white p-4 shadow-sm"><div className="text-sm text-slate-500">Открытых заданий</div><div className="text-3xl font-bold">{counters.total}</div></div>
          <div className="rounded-2xl bg-white p-4 shadow-sm"><div className="text-sm text-slate-500">В работе</div><div className="text-3xl font-bold">{counters.active}</div></div>
          <div className="rounded-2xl bg-white p-4 shadow-sm"><div className="text-sm text-slate-500">Ожидают закупки</div><div className="text-3xl font-bold text-amber-600">{counters.waiting}</div></div>
        </div>

        {message ? <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">{message}</div> : null}
        {loading ? <div className="rounded-2xl bg-white p-8 text-center text-slate-500">Загрузка заданий…</div> : null}
        {!loading && !tasks.length ? <div className="rounded-2xl bg-white p-10 text-center text-slate-500">Открытых заданий из 1С сейчас нет.</div> : null}

        {tasks.map((task) => (
          <section key={task.documentId} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 p-5">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-bold">{task.documentNumber}</h2>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${task.status === "waiting_supply" ? "bg-amber-100 text-amber-800" : task.status === "ready_for_completion" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"}`}>{statusLabel[task.status] || task.status}</span>
                </div>
                <div className="mt-1 text-sm text-slate-500">1С ID: {task.documentId}{task.sourceUser ? ` · ${task.sourceUser}` : ""}</div>
                {task.comment ? <div className="mt-2 text-sm">{task.comment}</div> : null}
              </div>
              {task.status === "received" ? <button disabled={busy === task.documentId} onClick={() => void start(task)} className="rounded-xl bg-blue-600 px-4 py-2 font-semibold text-white disabled:opacity-50">Начать сборку</button> : null}
            </div>

            <div className="grid grid-cols-3 gap-2 bg-slate-50 px-5 py-3 text-sm">
              <div><span className="text-slate-500">По документу:</span> <b>{task.summary.plannedQuantity}</b></div>
              <div><span className="text-slate-500">Выдано:</span> <b>{task.summary.issuedQuantity}</b></div>
              <div><span className="text-slate-500">Осталось:</span> <b>{task.summary.remainingQuantity}</b></div>
            </div>

            <div className="divide-y divide-slate-100">
              {task.items.map((line) => (
                <div key={line.lineId} className="grid gap-4 p-5 lg:grid-cols-[1fr_150px_190px] lg:items-center">
                  <div>
                    <div className="font-semibold">{line.name}</div>
                    <div className="mt-1 text-xs text-slate-500">{line.sku || line.productId} · строка {line.lineId}</div>
                    <div className="mt-2 flex flex-wrap gap-3 text-sm">
                      <span>Нужно: <b>{line.plannedQuantity} {line.unit}</b></span>
                      <span>Выдано: <b>{line.issuedQuantity} {line.unit}</b></span>
                      <span>Осталось: <b>{line.remainingQuantity} {line.unit}</b></span>
                    </div>
                  </div>
                  <div className={`rounded-xl px-3 py-2 text-center text-sm font-medium ${line.status === "waiting_supply" ? "bg-amber-50 text-amber-800" : line.status === "completed" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-700"}`}>{statusLabel[line.status] || line.status}</div>
                  <button
                    disabled={line.remainingQuantity <= 0 || busy === `${task.documentId}:${line.lineId}` || task.status === "received"}
                    onClick={() => void issue(task, line, line.remainingQuantity)}
                    className="rounded-xl bg-orange-500 px-4 py-2.5 font-semibold text-white hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Выдать доступное
                  </button>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
