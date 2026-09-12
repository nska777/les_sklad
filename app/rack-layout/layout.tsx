import type { ReactNode } from "react";

export default function RackLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <style>{`
        #rack-3d-scene {
          margin-top: 6rem !important;
        }

        @media (max-width: 639px) {
          #rack-3d-scene {
            margin-top: 4rem !important;
          }
        }
      `}</style>
      {children}
    </>
  );
}
