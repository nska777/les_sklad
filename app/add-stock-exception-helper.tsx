"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type PendingAdd = {
  body: Record<string, unknown>;
  originalResponse: Response;
  details: {
    error?: string;
    available1c?: number;
    currentTotal?: number;
    remaining?: number;
  };
  resolve: (response: Response) => void;
};

function isRackAddStock(input: RequestInfo | URL, init?: RequestInit) {
  if ((init?.method || "GET").toUpperCase() !== "POST") return false;
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  return url === "/api/rack-layout" || url.endsWith("/api/rack-layout");
}

export function AddStockExceptionHelper() {
  const [pending, setPending] = useState<PendingAdd | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const originalFetchRef = useRef<typeof window.fetch | null>(null);

  useEffect(() => {
    if (originalFetchRef.current) return;
    const originalFetch = window.fetch.bind(window);
    originalFetchRef.current = originalFetch;

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!isRackAddStock(input, init) || typeof init?.body !== "string") {
        return originalFetch(input, init);
      }

      let body: Record<string, unknown> | null = null;
      try {
        body = JSON.parse(init.body) as Record<string, unknown>;
      } catch {
        return originalFetch(input, init);
      }

      if (body.action !== "addStock") return originalFetch(input, init);

      const response = await originalFetch(input, init);
      if (response.status !== 409) return response;

      let details: PendingAdd["details"] = {};
      try {
        details = await response.clone().json() as PendingAdd["details"];
      } catch {
        return response;
      }

      const isLimitError = typeof details.available1c === "number" && typeof details.currentTotal === "number";
      if (!isLimitError) return response;

      return new Promise<Response>((resolve) => {
        setReason("");
        setPending({ body: body!, originalResponse: response, details, resolve });
      });
    };

    return () => {
      if (originalFetchRef.current) window.fetch = originalFetchRef.current;
      originalFetchRef.current = null;
    };
  }, []);

  const cancel = () => {
    if (!pending) return;
    pending.resolve(pending.originalResponse);
    setPending(null);
    setReason("");
  };

  const confirm = async () => {
    if (!pending || !reason.trim() || !originalFetchRef.current) return;
    setSaving(true);
    try {
      const response = await originalFetchRef.current("/api/rack-layout/add-stock-exception", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cellId: pending.body.cellId,
          productId: pending.body.productId,
          quantity: pending.body.quantity,
          operator: pending.body.operator,
          reason: reason.trim(),
        }),
      });
      pending.resolve(response);
      setPending(null);
      setReason("");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!pending} onOpenChange={(open) => { if (!open && !saving) cancel(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><AlertTriangle className="text-orange-500" /> Дополнительное оприходование</DialogTitle>
          <DialogDescription>
            По данным 1С доступное количество уже размещено или вводимое количество превышает остаток. Если товар действительно нашли на складе или его вернули, добавление разрешено только с обязательным комментарием.
          </DialogDescription>
        </DialogHeader>

        {pending && <div className="mt-2 rounded-2xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-900">
          <div>По 1С доступно: <b>{pending.details.available1c ?? 0}</b></div>
          <div className="mt-1">Сейчас фактически на складе: <b>{pending.details.currentTotal ?? 0}</b></div>
          <div className="mt-1">Остаток по 1С: <b>{pending.details.remaining ?? 0}</b></div>
        </div>}

        <div className="mt-4">
          <Label>Почему добавляем сверх остатка 1С *</Label>
          <Input
            autoFocus
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && reason.trim() && !saving) void confirm(); }}
            placeholder="Например: возврат со сборки, нашли коробку при переезде, возврат клиента"
            className="mt-2"
          />
          <p className="mt-2 text-xs text-slate-500">Комментарий сохранится в истории ячейки и журнале операций.</p>
        </div>

        <DialogFooter className="mt-5">
          <Button variant="outline" disabled={saving} onClick={cancel}>Отмена</Button>
          <Button className="accent-button" disabled={saving || !reason.trim()} onClick={() => void confirm()}>
            {saving ? <Loader2 className="animate-spin" /> : <Plus />} Добавить с комментарием
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
