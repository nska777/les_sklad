"use client";

import { ComponentProps, useCallback, useRef } from "react";
import { DepartmentRoomThreeView as StableRoom } from "./department-room-three-view-stable";

type Props = ComponentProps<typeof StableRoom>;

export function DepartmentRoomThreeView(props: Props) {
  const cellRef = useRef(props.onCellClick);
  const rackRef = useRef(props.onRackClick);
  const clearRef = useRef(props.onClearSelection);
  cellRef.current = props.onCellClick;
  rackRef.current = props.onRackClick;
  clearRef.current = props.onClearSelection;

  const onCellClick = useCallback<Props["onCellClick"]>((cell) => cellRef.current(cell), []);
  const onRackClick = useCallback<Props["onRackClick"]>((rack) => rackRef.current(rack), []);
  const onClearSelection = useCallback<Props["onClearSelection"]>(() => clearRef.current(), []);

  return <StableRoom
    {...props}
    selectedCellId={null}
    selectedRackId={null}
    onCellClick={onCellClick}
    onRackClick={onRackClick}
    onClearSelection={onClearSelection}
  />;
}
