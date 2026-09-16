import type { ReactNode } from "react";
import { ExcessStockPanel } from "@/app/excess-stock-panel";

export default function MaterialsLayout({ children }: { children: ReactNode }) {
  return <><ExcessStockPanel context="materials" />{children}</>;
}
