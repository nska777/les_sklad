"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useParams } from "next/navigation";
import { FileSpreadsheet, TriangleAlert } from "lucide-react";
import WarehouseFullUiV4 from "./warehouse-full-ui-v4";
import { WarehouseExcelToolsV2 } from "./warehouse-excel-tools-v2";

export default function WarehouseFullUiV5() {
  const params = useParams<{ warehouse: string }>();
  const warehouse = String(params?.warehouse || "paint");
  const [mount, setMount] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let stopped = false;
    let created: HTMLElement | null = null;
    const locate = () => {
      if (stopped || created) return;
      const buttons = Array.from(document.querySelectorAll("button"));
      const old = buttons.find((b) => b.textContent?.includes("Материалы из 1С") && b.offsetParent !== null);
      if (!(old instanceof HTMLElement) || !(old.parentElement instanceof HTMLElement)) return;
      old.style.display = "none";
      created = document.createElement("span");
      old.parentElement.insertBefore(created, old);
      setMount(created);
    };
    locate();
    const timer = window.setInterval(locate, 400);
    return () => { stopped = true; window.clearInterval(timer); created?.remove(); };
  }, []);

  useEffect(() => {
    const handleTransferTab = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest("button");
      if (!(button instanceof HTMLButtonElement)) return;
      if (button.textContent?.trim() !== "Перемещение") return;
      event.preventDefault();
      event.stopPropagation();
      window.location.assign(`/department/${warehouse}/transfer`);
    };
    document.addEventListener("click", handleTransferTab, true);
    return () => document.removeEventListener("click", handleTransferTab, true);
  }, [warehouse]);

  const buttons = <span className="inline-flex items-center gap-2">
    <a href={`/department/${warehouse}/onec-materials`} data-same-tab="true" className="inline-flex h-9 items-center gap-2 rounded-lg border bg-white/80 px-3 text-sm font-semibold text-slate-700 shadow-sm hover:bg-white"><FileSpreadsheet size={15}/> Материалы из 1С</a>
    <a href={`/department/${warehouse}/excess`} data-same-tab="true" className="inline-flex h-9 items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 text-sm font-semibold text-amber-800 shadow-sm hover:bg-amber-100"><TriangleAlert size={15}/> Излишки</a>
  </span>;

  return <>
    <WarehouseFullUiV4 />
    <WarehouseExcelToolsV2 />
    {mount ? createPortal(buttons, mount) : null}
  </>;
}
