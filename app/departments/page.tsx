"use client";

import Link from "next/link";
import { ArrowRight, Boxes, Layers3, PaintBucket, TreePine } from "lucide-react";

const departments = [
  {
    code: "hardware",
    name: "Склад фурнитуры",
    description: "Действующий склад фурнитуры и комплектующих",
    icon: Boxes,
    accent: "from-slate-900 to-slate-700",
    badge: "Работает",
  },
  {
    code: "paint",
    name: "Склад краски",
    description: "Краски, эмали, лаки, грунты и расходные материалы",
    icon: PaintBucket,
    accent: "from-orange-500 to-amber-400",
    badge: "Новый раздел",
  },
  {
    code: "ldsp",
    name: "Склад ЛДСП",
    description: "Листы, декоры и материалы плитного склада",
    icon: Layers3,
    accent: "from-zinc-700 to-stone-500",
    badge: "Подготовлен",
  },
];

export default function DepartmentsPage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,.95),rgba(244,246,241,.9)_38%,rgba(236,239,232,.96)_100%)] px-4 py-8 text-slate-950 sm:px-6 sm:py-12">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex items-center gap-3 sm:mb-12">
          <div className="brand-mark"><TreePine size={22} /></div>
          <div>
            <div className="text-[15px] font-extrabold tracking-tight">РУССКИЙ ЛЕС · RL СКЛАД</div>
            <div className="text-xs text-slate-500">Выберите подразделение</div>
          </div>
        </div>

        <section className="mb-8 max-w-3xl sm:mb-10">
          <span className="inline-flex rounded-full border border-black/10 bg-white/75 px-3 py-1 text-xs font-semibold text-slate-600 shadow-sm backdrop-blur">Единая складская система</span>
          <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-5xl">Какой склад открыть?</h1>
        </section>

        <div className="grid gap-4 md:grid-cols-3">
          {departments.map((department) => {
            const Icon = department.icon;
            return (
              <Link
                key={department.code}
                href={`/login?warehouse=${department.code}`}
                className="group relative overflow-hidden rounded-[28px] border border-white/80 bg-white/85 p-5 shadow-[0_20px_70px_rgba(32,45,32,.10)] backdrop-blur-xl transition duration-300 hover:-translate-y-1 hover:shadow-[0_26px_80px_rgba(32,45,32,.16)] sm:p-6"
              >
                <div className={`absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r ${department.accent}`} />
                <div className="flex items-start justify-between gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-lg"><Icon size={23} /></div>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600">{department.badge}</span>
                </div>
                <h2 className="mt-8 text-xl font-black tracking-tight">{department.name}</h2>
                <p className="mt-2 min-h-12 text-sm leading-6 text-slate-500">{department.description}</p>
                <div className="mt-7 flex items-center justify-between border-t border-slate-100 pt-4 text-sm font-bold">
                  <span>Перейти к авторизации</span>
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-950 text-white transition group-hover:translate-x-1"><ArrowRight size={17} /></span>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </main>
  );
}
