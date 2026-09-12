"use client";

import Barcode from "react-barcode";

type ProductBarcodeProps = {
  value: string;
  compact?: boolean;
  className?: string;
};

export function ProductBarcode({ value, compact = false, className = "" }: ProductBarcodeProps) {
  const safeValue = value.trim();
  if (!safeValue) return null;

  return (
    <div className={`overflow-hidden rounded-xl border border-black/10 bg-white px-3 py-2 ${className}`}>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[.14em] text-slate-400">Штрихкод</div>
      <div className="flex max-w-full justify-center overflow-hidden">
        <Barcode
          value={safeValue}
          format="CODE128"
          width={compact ? 1.25 : 1.55}
          height={compact ? 38 : 52}
          margin={0}
          fontSize={compact ? 11 : 12}
          displayValue
          background="transparent"
        />
      </div>
    </div>
  );
}
