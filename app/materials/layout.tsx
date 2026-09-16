import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ExcessStockPanel } from "@/app/excess-stock-panel";

export const metadata: Metadata = {
  title: "Материалы",
};

export default function MaterialsLayout({ children }: { children: ReactNode }) {
  return <><ExcessStockPanel context="materials" />{children}</>;
}
