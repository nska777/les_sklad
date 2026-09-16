import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ExcessStockPanel } from "@/app/excess-stock-panel";
import { RackOrderFix } from "./rack-order-fix";

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

        /* Реальный контейнер карточек стеллажей. Убираем горизонтальный скролл и переносим карточки вниз. */
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
      <ExcessStockPanel context="rack" />
      {children}
    </>
  );
}
