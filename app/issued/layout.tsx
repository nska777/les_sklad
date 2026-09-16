import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Выданные товары",
};

export default function IssuedLayout({ children }: { children: ReactNode }) {
  return children;
}
