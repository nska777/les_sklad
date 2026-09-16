import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Материалы из 1С",
};

export default function OneCMaterialsLayout({ children }: { children: ReactNode }) {
  return children;
}
