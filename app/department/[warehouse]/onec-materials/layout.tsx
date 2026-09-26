import type { ReactNode } from "react";
import { PlacementWarningClient } from "./placement-warning-client";

export default function OneCMaterialsLayout({ children }: { children: ReactNode }) {
  return <><PlacementWarningClient />{children}</>;
}
