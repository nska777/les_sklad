"use client";

import { ComponentProps, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { DepartmentRoomThreeView as RoomV2 } from "./department-room-three-view-v2";

type Props = ComponentProps<typeof RoomV2>;

export function DepartmentRoomThreeView(props: Props) {
  const searchParams = useSearchParams();
  const queryCell = searchParams.get("cell");
  const locatedCellId = useMemo(() => {
    if (!queryCell) return null;
    const byId = props.cells.find((cell) => cell.id === queryCell);
    if (byId) return byId.id;
    const byCode = props.cells.find((cell) => cell.code.toLowerCase() === queryCell.toLowerCase());
    return byCode?.id || null;
  }, [props.cells, queryCell]);

  return <RoomV2 {...props} selectedCellId={props.selectedCellId || locatedCellId} />;
}
