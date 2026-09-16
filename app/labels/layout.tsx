import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Этикетки",
};

export default function LabelsLayout({ children }: { children: ReactNode }) {
  return children;
}
