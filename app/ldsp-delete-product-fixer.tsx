"use client";

import { useEffect } from "react";
import { toast } from "sonner";

type Product = { id: string; name: string; sku: string };
type WarehouseSnapshot = { products?: Product[]; error?: string };

function isLdspPage() {
  return window.location.pathname.startsWith("/department/ldsp");
}

function deleteButtonFromEvent(event: MouseEvent) {
  const target = event.target;
  if (!(target instanceof Element)) return null;
  const button = target.closest("button");
  if (!(button instanceof HTMLButtonElement)) return null;
  if (button.textContent?.trim() !== "Удалить материал") return null;
  return button;
}

export function LdspDeleteProductFixer() {
  useEffect(() => {
    if (!isLdspPage()) return;

    const onClick = async (event: MouseEvent) => {
      const button = deleteButtonFromEvent(event);
      if (!button) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const article = button.closest("article");
      if (!(article instanceof HTMLElement)) {
        toast.error("Не удалось определить материал");
        return;
      }

      button.disabled = true;
      try {
        const response = await fetch("/api/department-warehouse", {
          cache: "no-store",
          headers: { "x-warehouse-code": "ldsp" },
        });
        const snapshot = await response.json() as WarehouseSnapshot;
        if (!response.ok) throw new Error(snapshot.error || "Не удалось загрузить склад ЛДСП");

        const articleText = article.textContent || "";
        const candidates = (snapshot.products || []).filter((product) =>
          articleText.includes(product.sku) && articleText.includes(product.name),
        );
        const product = candidates[0];
        if (!product) throw new Error("Материал не найден в складе ЛДСП");

        if (!window.confirm(`Удалить материал «${product.name}» полностью вместе с остатками и историей движений?`)) {
          return;
        }

        const remove = await fetch("/api/department-warehouse-controls", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-warehouse-code": "ldsp",
          },
          body: JSON.stringify({ action: "deleteProductAdmin", productId: product.id }),
        });
        const result = await remove.json() as { error?: string };
        if (!remove.ok) throw new Error(result.error || "Не удалось удалить материал");

        toast.success("Материал удалён");
        window.setTimeout(() => window.location.reload(), 150);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Не удалось удалить материал");
      } finally {
        button.disabled = false;
      }
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return null;
}
