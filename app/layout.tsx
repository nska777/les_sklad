import type { Metadata } from "next";
import { Toaster } from "@/components/ui/sonner";
import { PwaRegister } from "@/app/pwa-tools";
import { RackTabRouter } from "@/app/rack-tab-router";
import { LdspTabRouter } from "@/app/ldsp-tab-router";
import { NewTabPageLinks } from "@/app/new-tab-page-links";
import { SessionMenu } from "@/app/session-menu";
import { CodeZoom } from "@/app/code-zoom";
import { MovementDateMaintenance } from "@/app/movement-date-maintenance";
import { OnecCellOccupancyGuard } from "@/app/onec-cell-occupancy-guard";
import { AddStockExceptionHelper } from "@/app/add-stock-exception-helper";
import { MaterialsAddAction } from "@/app/materials-add-action";
import { IssueMobileScanTools } from "@/app/issue-mobile-scan-tools";
import { RackVisualAddCellHelper } from "@/app/rack-visual-add-cell-helper";
import { PageTitleController } from "@/app/page-title-controller";
import { HidePrimaryInventory } from "@/app/hide-primary-inventory";
import { ResilienceIndicator } from "@/app/resilience-indicator";
import { DepartmentManualProductEnhancer } from "@/app/department-manual-product-enhancer";
import { DepartmentLdspMaterialsEnhancer } from "@/app/department-ldsp-materials-enhancer";
import { DepartmentPaintUiEnhancer } from "@/app/department-paint-ui-enhancer";
import { DepartmentPaintIssueEnhancer } from "@/app/department-paint-issue-enhancer";
import { DepartmentAuditRecorder } from "@/app/department-audit-recorder";
import { HardwareLiveSync } from "@/app/hardware-live-sync";
import "./globals.css";
import "./select-arrows.css";
import "./brand-logo.css";

export const metadata: Metadata = {
  title: "Склад",
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
      <body className="antialiased">
        <PwaRegister />
        <PageTitleController />
        <HidePrimaryInventory />
        <MovementDateMaintenance />
        <OnecCellOccupancyGuard />
        <AddStockExceptionHelper />
        <NewTabPageLinks />
        <RackTabRouter />
        <LdspTabRouter />
        <ResilienceIndicator />
        <HardwareLiveSync />
        <DepartmentAuditRecorder />
        <DepartmentManualProductEnhancer />
        <DepartmentLdspMaterialsEnhancer />
        <DepartmentPaintUiEnhancer />
        <DepartmentPaintIssueEnhancer />
        {children}
        <MaterialsAddAction />
        <IssueMobileScanTools />
        <RackVisualAddCellHelper />
        <SessionMenu />
        <CodeZoom />
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
