import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Перемещение",
};

export default function TransferLayout({ children }: { children: ReactNode }) {
  return children;
}
