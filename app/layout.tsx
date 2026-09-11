import type { Metadata } from "next";
import { Toaster } from "@/components/ui/sonner";
import { PwaRegister } from "@/app/pwa-tools";
import "./globals.css";

export const metadata: Metadata = {
  title: "Русский Лес — Склад",
  description: "Приёмка, адресное хранение и выдача материалов",
  applicationName: "Русский Лес — Склад",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "РЛ Склад" },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/app-icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className="antialiased"><PwaRegister />{children}<Toaster richColors position="top-right" /></body>
    </html>
  );
}
