import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Излишки",
};

export default function ExcessLayout({ children }: { children: ReactNode }) {
  return children;
}
