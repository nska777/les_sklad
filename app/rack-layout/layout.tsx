import type { Metadata } from "next";
import type { ReactNode } from "react";
import { RackOrderFix } from "./rack-order-fix";
import { RackProductSearchEnhancer } from "./product-search-enhancer";
import { RackMoveDestinationEnhancer } from "./move-destination-enhancer";
import { RackStockExportActions } from "@/app/rack-stock-export-actions";

export const metadata: Metadata = {
  title: "Стеллажи",
};

export default function RackLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <style>{`
        #rack-3d-scene {
          margin-top: 6rem !important;
        }

        main section.panel div.overflow-x-auto.pb-1 {
          display: grid !important;
          grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)) !important;
          gap: 0.5rem !important;
          width: 100% !important;
          min-width: 0 !important;
          max-width: 100% !important;
          overflow-x: visible !important;
          align-items: stretch !important;
        }

        main section.panel div.overflow-x-auto.pb-1 > button {
          width: 100% !important;
          min-width: 0 !important;
          max-width: none !important;
        }

        @media (max-width: 900px) {
          main section.panel div.overflow-x-auto.pb-1 {
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          }
        }

        @media (max-width: 639px) {
          #rack-3d-scene {
            margin-top: 4rem !important;
          }

          main section.panel div.overflow-x-auto.pb-1 {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
      <RackOrderFix />
      <RackProductSearchEnhancer />
      <RackMoveDestinationEnhancer />
      <RackStockExportActions />
      {children}
    </>
  );
}
