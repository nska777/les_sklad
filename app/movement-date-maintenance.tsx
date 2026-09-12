"use client";

import { useEffect } from "react";

export function MovementDateMaintenance() {
  useEffect(() => {
    void fetch("/api/maintenance/movement-dates", { method: "POST" }).catch(() => undefined);
  }, []);

  return null;
}
