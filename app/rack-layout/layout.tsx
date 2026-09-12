import type { ReactNode } from "react";
import { RackOrderFix } from "./rack-order-fix";

export default function RackLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <style>{`
        #rack-3d-scene {
          margin-top: 6rem !important;
        }

        /* Список стеллажей: переносим карточки на новые строки вместо горизонтального выезда. */
        main > div > section.panel > div.grid > div:nth-child(2) > div.flex {
          display: grid !important;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)) !important;
          width: 100% !important;
          overflow-x: visible !important;
          align-items: stretch;
        }

        main > div > section.panel > div.grid > div:nth-child(2) > div.flex > button {
          min-width: 0 !important;
          width: 100% !important;
        }

        @media (max-width: 1279px) {
          main > div > section.panel > div.grid > div:nth-child(2) > div.flex {
            grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)) !important;
          }
        }

        @media (max-width: 639px) {
          #rack-3d-scene {
            margin-top: 4rem !important;
          }

          main > div > section.panel > div.grid > div:nth-child(2) > div.flex {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
      <RackOrderFix />
      {children}
    </>
  );
}
