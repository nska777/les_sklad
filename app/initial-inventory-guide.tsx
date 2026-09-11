import { Boxes, Check, Grid3X3, PackagePlus, Printer } from "lucide-react";

export function InitialInventoryGuide({ racks, products, stocked }: { racks: number; products: number; stocked: number }) {
  const steps = [
    { title: "Создайте стеллажи", text: "Укажите полки и ячейки", icon: Grid3X3, done: racks > 0 },
    { title: "Добавьте материалы", text: "Название, единица и упаковка", icon: Boxes, done: products > 0 },
    { title: "Распечатайте QR", text: "Для товара и каждой ячейки", icon: Printer, done: products > 0 && racks > 0 },
    { title: "Посчитайте и разместите", text: "Товар → ячейка → количество", icon: PackagePlus, done: stocked > 0 },
  ];
  return <section className="onboarding-panel">
    <div className="onboarding-copy"><span className="glass-kicker">Первоначальное заполнение склада</span><h1>Занесите фактические остатки по местам</h1><p>Не переносите неправильные количества из 1С. Кладовщик пересчитывает то, что реально лежит на складе, и закрепляет материал за конкретной ячейкой.</p></div>
    <div className="onboarding-steps">{steps.map((step, index) => <div className={`onboarding-step ${step.done ? "done" : ""}`} key={step.title}><div className="step-icon">{step.done ? <Check /> : <step.icon />}</div><div><small>Шаг {index + 1}</small><b>{step.title}</b><span>{step.text}</span></div></div>)}</div>
  </section>;
}
