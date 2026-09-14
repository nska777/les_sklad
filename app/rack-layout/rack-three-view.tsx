"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Check, Pencil, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";

type Side = "front" | "back";
type Rack = { id: string; name: string; code: string; rows: number; columns: number };
type Cell = { id: string; rackId: string; code: string; label: string; rowIndex: number; columnIndex: number; blocked: boolean; side: Side };
type Stock = { productId: string; cellId: string; quantity: number; productName: string; sku: string; barcode: string; unit: string };
type LayoutCell = {
  id: string;
  rackId: string;
  code: string;
  rowIndex: number;
  columnIndex: number;
  side: Side;
  blocked: boolean;
  widthRatio: number;
  heightRatio: number;
  archived: boolean;
  hasStock: boolean;
};
type VisualCell = Cell & { widthRatio: number; heightRatio: number; archived: boolean; hasStock: boolean };
type EditorCell = {
  id: string;
  code: string;
  rowIndex: number;
  columnIndex: number;
  widthRatio: number;
  heightRatio: number;
  hasStock: boolean;
};

type Props = {
  rack: Rack;
  cells: Cell[];
  stocks: Stock[];
  side: Side;
  onCellClick: (cell: Cell) => void;
  highlightCellId?: string | null;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const sideLabel = (side: Side) => side === "front" ? "Лицевая" : "Задняя";

function labelSprite(text: string, accent = false, widthScale = 1, heightScale = 1) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 160;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = accent ? "rgba(219,234,254,.96)" : "rgba(255,255,255,.94)";
  ctx.strokeStyle = accent ? "#2563eb" : "#cbd5e1";
  ctx.lineWidth = 4;
  ctx.roundRect(8, 8, 496, 144, 26);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#0f172a";
  ctx.font = "700 32px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  text.split("\n").slice(0, 3).forEach((line, index) => ctx.fillText(line, 256, 48 + index * 38, 460));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(2.3 * widthScale, 0.86 * heightScale, 1);
  return sprite;
}

export function RackThreeView({ rack, cells, stocks, side, onCellClick, highlightCellId }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<{ camera?: THREE.PerspectiveCamera; controls?: OrbitControls; cameraDistance?: number; targetY?: number }>({});
  const cameraSideRef = useRef<Side>(side);
  const [cameraSide, setCameraSide] = useState<Side>(side);
  const [layoutCells, setLayoutCells] = useState<LayoutCell[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorSide, setEditorSide] = useState<Side>(side);
  const [draft, setDraft] = useState<EditorCell[]>([]);
  const [editorSaving, setEditorSaving] = useState(false);
  const [editorDirty, setEditorDirty] = useState(false);

  const loadVisualLayout = useCallback(async () => {
    try {
      const response = await fetch(`/api/rack-layout/visual?rackId=${encodeURIComponent(rack.id)}`, { cache: "no-store" });
      const body = await response.json() as { cells?: LayoutCell[]; error?: string };
      if (!response.ok) throw new Error(body.error || "Не удалось загрузить геометрию стеллажа");
      setLayoutCells(body.cells || []);
    } catch (error) {
      console.error(error);
    }
  }, [rack.id]);

  useEffect(() => { void loadVisualLayout(); }, [loadVisualLayout]);

  const layoutById = useMemo(() => new Map(layoutCells.map((item) => [item.id, item])), [layoutCells]);
  const visualCells = useMemo<VisualCell[]>(() => cells
    .map((cell) => {
      const layout = layoutById.get(cell.id);
      return {
        ...cell,
        widthRatio: Math.max(0.12, Number(layout?.widthRatio || 1)),
        heightRatio: Math.max(0.25, Number(layout?.heightRatio || 1)),
        archived: Boolean(layout?.archived),
        hasStock: Boolean(layout?.hasStock),
      };
    })
    .filter((cell) => !cell.archived), [cells, layoutById]);

  const makeDraft = useCallback((targetSide: Side) => visualCells
    .filter((cell) => cell.side === targetSide)
    .map((cell) => ({
      id: cell.id,
      code: cell.code,
      rowIndex: cell.rowIndex,
      columnIndex: cell.columnIndex,
      widthRatio: cell.widthRatio,
      heightRatio: cell.heightRatio,
      hasStock: cell.hasStock || stocks.some((stock) => stock.cellId === cell.id && stock.quantity > 0),
    })), [stocks, visualCells]);

  const openEditor = () => {
    const camera = stateRef.current.camera;
    const targetSide: Side = camera ? (camera.position.z >= 0 ? "front" : "back") : side;
    setEditorSide(targetSide);
    setDraft(makeDraft(targetSide));
    setEditorDirty(false);
    setEditorOpen(true);
  };

  const changeEditorSide = (targetSide: Side) => {
    if (targetSide === editorSide) return;
    if (editorDirty && !window.confirm("Есть несохранённые изменения. Переключить сторону без сохранения?")) return;
    setEditorSide(targetSide);
    setDraft(makeDraft(targetSide));
    setEditorDirty(false);
  };

  const editorRows = useMemo(() => {
    const grouped = new Map<number, EditorCell[]>();
    for (const cell of draft) {
      const row = grouped.get(cell.rowIndex) || [];
      row.push(cell);
      grouped.set(cell.rowIndex, row);
    }
    return Array.from(grouped.entries())
      .map(([rowIndex, rowCells]) => ({ rowIndex, cells: rowCells.sort((a, b) => a.columnIndex - b.columnIndex) }))
      .sort((a, b) => b.rowIndex - a.rowIndex);
  }, [draft]);

  const beginWidthDrag = (event: ReactPointerEvent<HTMLButtonElement>, rowIndex: number, leftId: string, rightId: string) => {
    event.preventDefault();
    event.stopPropagation();
    const rowElement = document.querySelector<HTMLElement>(`[data-rack-editor-row="${rowIndex}"]`);
    const left = draft.find((cell) => cell.id === leftId);
    const right = draft.find((cell) => cell.id === rightId);
    if (!rowElement || !left || !right) return;
    const rect = rowElement.getBoundingClientRect();
    const startX = event.clientX;
    const leftStart = left.widthRatio;
    const rightStart = right.widthRatio;
    const rowTotal = draft.filter((cell) => cell.rowIndex === rowIndex).reduce((sum, cell) => sum + cell.widthRatio, 0) || 1;
    const minRatio = Math.max(0.12, rowTotal * 0.07);

    const move = (pointer: PointerEvent) => {
      const delta = ((pointer.clientX - startX) / Math.max(1, rect.width)) * rowTotal;
      const nextLeft = clamp(leftStart + delta, minRatio, leftStart + rightStart - minRatio);
      const nextRight = leftStart + rightStart - nextLeft;
      setDraft((current) => current.map((cell) => cell.id === leftId ? { ...cell, widthRatio: nextLeft } : cell.id === rightId ? { ...cell, widthRatio: nextRight } : cell));
      setEditorDirty(true);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  };

  const beginHeightDrag = (event: ReactPointerEvent<HTMLButtonElement>, upperRow: number, lowerRow: number) => {
    event.preventDefault();
    event.stopPropagation();
    const editor = document.querySelector<HTMLElement>("[data-rack-editor-grid]");
    if (!editor) return;
    const upper = draft.find((cell) => cell.rowIndex === upperRow);
    const lower = draft.find((cell) => cell.rowIndex === lowerRow);
    if (!upper || !lower) return;
    const rect = editor.getBoundingClientRect();
    const startY = event.clientY;
    const upperStart = upper.heightRatio;
    const lowerStart = lower.heightRatio;
    const rows = Array.from(new Set(draft.map((cell) => cell.rowIndex)));
    const totalHeight = rows.reduce((sum, row) => sum + (draft.find((cell) => cell.rowIndex === row)?.heightRatio || 1), 0) || 1;
    const minRatio = Math.max(0.25, totalHeight * 0.08);

    const move = (pointer: PointerEvent) => {
      const delta = ((pointer.clientY - startY) / Math.max(1, rect.height)) * totalHeight;
      const nextUpper = clamp(upperStart + delta, minRatio, upperStart + lowerStart - minRatio);
      const nextLower = upperStart + lowerStart - nextUpper;
      setDraft((current) => current.map((cell) => cell.rowIndex === upperRow ? { ...cell, heightRatio: nextUpper } : cell.rowIndex === lowerRow ? { ...cell, heightRatio: nextLower } : cell));
      setEditorDirty(true);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  };

  const archiveCell = async (cell: EditorCell) => {
    if (cell.hasStock) return toast.error("В ячейке есть материал", { description: "Сначала переместите остаток в другую ячейку." });
    const rowCells = draft.filter((item) => item.rowIndex === cell.rowIndex);
    if (rowCells.length <= 1) return toast.error("На полке должна остаться хотя бы одна ячейка");
    if (!window.confirm(`Удалить ячейку ${cell.code} из ${sideLabel(editorSide).toLowerCase()} стороны?`)) return;
    try {
      const response = await fetch("/api/rack-layout/visual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "archiveCell", cellId: cell.id, operator: "Визуальный редактор" }),
      });
      const body = await response.json() as { cells?: LayoutCell[]; error?: string };
      if (!response.ok) throw new Error(body.error || "Не удалось удалить ячейку");
      setLayoutCells(body.cells || []);
      setDraft((current) => current.filter((item) => item.id !== cell.id));
      toast.success(`Ячейка ${cell.code} удалена из схемы`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось удалить ячейку");
    }
  };

  const saveEditor = async () => {
    if (!draft.length) return;
    setEditorSaving(true);
    try {
      const response = await fetch("/api/rack-layout/visual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "saveLayout",
          rackId: rack.id,
          side: editorSide,
          operator: "Визуальный редактор",
          cells: draft.map((cell) => ({ id: cell.id, rowIndex: cell.rowIndex, widthRatio: cell.widthRatio, heightRatio: cell.heightRatio })),
        }),
      });
      const body = await response.json() as { cells?: LayoutCell[]; error?: string };
      if (!response.ok) throw new Error(body.error || "Не удалось сохранить схему");
      setLayoutCells(body.cells || []);
      setEditorDirty(false);
      setEditorOpen(false);
      window.dispatchEvent(new CustomEvent("warehouse-data-refresh"));
      toast.success(`${sideLabel(editorSide)} сторона сохранена`, { description: "Размеры сразу применены к 3D-модели." });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить схему");
    } finally {
      setEditorSaving(false);
    }
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    host.innerHTML = "";
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf8fafc);
    scene.fog = new THREE.Fog(0xf8fafc, 24, 46);

    const width = Math.min(18, Math.max(14.5, rack.columns * 2.9));
    const depth = 1.95;
    const x0 = -width / 2;
    const preferredHeightSide = cameraSideRef.current;
    const rowHeightWeights = Array.from({ length: rack.rows }, (_, rowIndex) => {
      const rowCell = visualCells.find((cell) => cell.side === preferredHeightSide && cell.rowIndex === rowIndex)
        || visualCells.find((cell) => cell.rowIndex === rowIndex);
      return Math.max(0.25, Number(rowCell?.heightRatio || 1));
    });
    const rowWeightTotal = rowHeightWeights.reduce((sum, value) => sum + value, 0) || rack.rows || 1;
    const contentHeight = Math.max(2.4, rack.rows * 1.62);
    const rowHeights = rowHeightWeights.map((value) => contentHeight * value / rowWeightTotal);
    const rowBottoms: number[] = [];
    let cursorY = 0;
    for (const rowHeight of rowHeights) {
      rowBottoms.push(cursorY);
      cursorY += rowHeight;
    }
    const height = contentHeight + 0.58;

    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 120);
    const cameraDistance = Math.max(16.2, height * 1.9, width * 0.98);
    const targetY = height * 0.46;
    camera.position.set(0, Math.max(4.8, height * 0.63), side === "front" ? cameraDistance : -cameraDistance);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    renderer.domElement.style.cursor = "grab";
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.minDistance = 8;
    controls.maxDistance = 38;
    controls.maxPolarAngle = Math.PI / 2.02;
    controls.target.set(0, targetY, 0);
    stateRef.current = { camera, controls, cameraDistance, targetY };

    scene.add(new THREE.HemisphereLight(0xffffff, 0x64748b, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 3.4);
    key.position.set(8, 14, 9);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xbfd7ff, 1.5);
    rim.position.set(-9, 8, -9);
    scene.add(rim);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(30, width + 10), 22), new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.92, metalness: 0.03 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.12;
    floor.receiveShadow = true;
    scene.add(floor);

    const rackGroup = new THREE.Group();
    scene.add(rackGroup);
    const steel = new THREE.MeshStandardMaterial({ color: 0x273449, roughness: 0.42, metalness: 0.74 });
    const shelfMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.52, metalness: 0.55 });
    const addBox = (w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material, cast = true) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      mesh.position.set(x, y, z);
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      rackGroup.add(mesh);
      return mesh;
    };

    addBox(width + 0.7, 0.24, depth + 0.35, 0, 0.05, 0, steel);
    addBox(width + 0.7, 0.22, depth + 0.35, 0, height + 0.1, 0, steel);
    for (const x of [x0, x0 + width]) {
      addBox(0.18, height, 0.18, x, height / 2, -depth / 2, steel);
      addBox(0.18, height, 0.18, x, height / 2, depth / 2, steel);
    }
    for (let row = 0; row < rack.rows; row += 1) {
      addBox(width + 0.22, 0.12, depth, 0, rowBottoms[row] + rowHeights[row], 0, shelfMat);
    }

    const interactive: THREE.Object3D[] = [];
    const cellByObject = new Map<string, Cell>();
    let highlightedMaterial: THREE.MeshStandardMaterial | null = null;

    for (const cellSide of ["front", "back"] as const) {
      for (let rowIndex = 0; rowIndex < rack.rows; rowIndex += 1) {
        const rowCells = visualCells.filter((cell) => cell.side === cellSide && cell.rowIndex === rowIndex).sort((a, b) => a.columnIndex - b.columnIndex);
        if (!rowCells.length) continue;
        const totalRatio = rowCells.reduce((sum, cell) => sum + Math.max(0.12, cell.widthRatio), 0) || rowCells.length;
        let xCursor = x0;

        rowCells.forEach((cell, index) => {
          const cellWidth = width * Math.max(0.12, cell.widthRatio) / totalRatio;
          const cellHeight = rowHeights[rowIndex];
          const x = xCursor + cellWidth / 2;
          const y = rowBottoms[rowIndex] + cellHeight / 2 + 0.07;
          const z = cell.side === "front" ? depth / 2 + 0.12 : -depth / 2 - 0.12;
          const cellStocks = stocks.filter((stock) => stock.cellId === cell.id);
          const occupied = cellStocks.length > 0;
          const highlighted = cell.id === highlightCellId;
          const cellMaterial = new THREE.MeshStandardMaterial({
            color: highlighted ? 0xfbbf24 : occupied ? 0x93c5fd : 0xf8fafc,
            transparent: true,
            opacity: highlighted ? 0.9 : occupied ? 0.72 : 0.28,
            roughness: 0.55,
            metalness: 0.05,
            emissive: highlighted ? 0xf59e0b : occupied ? 0x102a5c : 0x000000,
            emissiveIntensity: highlighted ? 0.75 : occupied ? 0.18 : 0,
          });
          if (highlighted) highlightedMaterial = cellMaterial;
          const mesh = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.34, cellWidth - 0.18), Math.max(0.34, cellHeight - 0.20), highlighted ? 0.24 : 0.16), cellMaterial);
          mesh.position.set(x, y, z);
          mesh.castShadow = false;
          mesh.userData.cellId = cell.id;
          rackGroup.add(mesh);
          interactive.push(mesh);
          cellByObject.set(mesh.uuid, cell);

          if (highlighted) {
            const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color: 0xf97316 }));
            edges.position.copy(mesh.position);
            rackGroup.add(edges);
          }

          const total = cellStocks.reduce((sum, stock) => sum + stock.quantity, 0);
          const first = cellStocks[0];
          const label = labelSprite(
            occupied ? `${cell.code}\n${first?.productName || "Материал"}\n${total.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} ${first?.unit || ""}` : `${cell.code}\nСвободно`,
            highlighted || occupied,
            clamp(cellWidth / 2.4, 0.58, 2.15),
            clamp(cellHeight / 1.55, 0.72, 1.35),
          );
          label.position.set(x, y, cell.side === "front" ? depth / 2 + 0.25 : -depth / 2 - 0.25);
          rackGroup.add(label);

          xCursor += cellWidth;
          if (index < rowCells.length - 1) {
            addBox(0.11, Math.max(0.34, cellHeight - 0.06), 0.11, xCursor, rowBottoms[rowIndex] + cellHeight / 2, cell.side === "front" ? depth / 2 : -depth / 2, steel, false);
          }
        });
      }
    }

    const title = labelSprite(`${rack.code}\n${rack.name}`, true, 1.35);
    title.position.set(0, height + 0.92, 0);
    title.scale.set(4.6, 1.12, 1);
    rackGroup.add(title);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downX = 0;
    let downY = 0;
    const onPointerDown = (event: PointerEvent) => { downX = event.clientX; downY = event.clientY; renderer.domElement.style.cursor = "grabbing"; };
    const onPointerUp = (event: PointerEvent) => {
      renderer.domElement.style.cursor = "grab";
      if (Math.hypot(event.clientX - downX, event.clientY - downY) > 7) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(interactive, false)[0];
      if (!hit) return;
      const cell = cellByObject.get(hit.object.uuid);
      if (cell) onCellClick(cell);
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);

    const resize = () => {
      const widthPx = Math.max(320, host.clientWidth);
      const heightPx = Math.max(620, host.clientHeight);
      camera.aspect = widthPx / heightPx;
      camera.updateProjectionMatrix();
      renderer.setSize(widthPx, heightPx, false);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    let frame = 0;
    const startedAt = performance.now();
    const animate = () => {
      if (highlightedMaterial) {
        const pulse = (Math.sin((performance.now() - startedAt) / 260) + 1) / 2;
        highlightedMaterial.emissiveIntensity = 0.45 + pulse * 0.75;
      }
      controls.update();
      const detectedSide: Side = camera.position.z >= 0 ? "front" : "back";
      if (detectedSide !== cameraSideRef.current) {
        cameraSideRef.current = detectedSide;
        setCameraSide(detectedSide);
      }
      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      controls.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
          object.geometry.dispose();
          if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
          else object.material.dispose();
        }
        if (object instanceof THREE.Sprite) { object.material.map?.dispose(); object.material.dispose(); }
      });
      renderer.dispose();
      host.innerHTML = "";
    };
  }, [highlightCellId, onCellClick, rack, side, stocks, visualCells]);

  useEffect(() => {
    const camera = stateRef.current.camera;
    const controls = stateRef.current.controls;
    const cameraDistance = stateRef.current.cameraDistance || 16.2;
    const targetY = stateRef.current.targetY || rack.rows * 0.75;
    cameraSideRef.current = side;
    setCameraSide(side);
    if (!camera || !controls) return;
    camera.position.set(0, Math.max(4.8, rack.rows * 1.03), side === "front" ? cameraDistance : -cameraDistance);
    controls.target.set(0, targetY, 0);
    controls.update();
  }, [side, rack.rows]);

  const editorHeightTotal = editorRows.reduce((sum, row) => sum + (row.cells[0]?.heightRatio || 1), 0) || 1;
  const hasBackCells = visualCells.some((cell) => cell.side === "back");

  return <>
    <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-slate-50 shadow-inner">
      <div ref={hostRef} className="h-[74vh] min-h-[640px] w-full" />
      <div className="absolute right-4 top-4 z-20 flex flex-col items-end gap-2">
        <div className="rounded-full border border-black/10 bg-white/90 px-3 py-1.5 text-xs font-bold text-slate-600 shadow-sm backdrop-blur">Сейчас видна: {sideLabel(cameraSide)}</div>
        <button type="button" onClick={openEditor} className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-white/95 px-4 py-2.5 text-sm font-bold text-blue-700 shadow-lg backdrop-blur transition hover:bg-blue-50">
          <Pencil size={16} /> Редактировать {cameraSide === "front" ? "лицевую" : "заднюю"} сторону
        </button>
      </div>
      {highlightCellId && <div className="pointer-events-none absolute left-4 top-4 rounded-full border border-amber-300 bg-amber-50/95 px-4 py-2 text-xs font-bold text-amber-900 shadow-sm backdrop-blur">Найденная ячейка подсвечена</div>}
      <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-black/10 bg-white/90 px-4 py-2 text-xs font-medium text-slate-600 shadow-sm backdrop-blur">ЛКМ + перетаскивание — вращение · колесо — масштаб · редактор определяет видимую сторону автоматически</div>
    </div>

    {editorOpen && <div className="fixed inset-0 z-[12000] flex items-center justify-center bg-slate-950/65 p-3 backdrop-blur-sm" onPointerDown={(event) => { if (event.target === event.currentTarget && !editorSaving) setEditorOpen(false); }}>
      <div className="flex max-h-[96vh] w-full max-w-6xl flex-col overflow-hidden rounded-[28px] border border-white/30 bg-white shadow-2xl">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b p-4 sm:p-6">
          <div>
            <div className="text-xs font-bold uppercase tracking-[.16em] text-blue-600">Визуальный конструктор</div>
            <h3 className="mt-1 text-2xl font-black text-slate-950">{rack.code} · {rack.name}</h3>
            <p className="mt-1 text-sm text-slate-500">Редактируется: <b>{sideLabel(editorSide)} сторона</b>. Лицевая и задняя схемы независимы по ширине ячеек.</p>
            <div className="mt-3 inline-flex rounded-xl border border-slate-200 bg-slate-100 p-1">
              <button type="button" disabled={editorSaving} onClick={() => changeEditorSide("front")} className={`rounded-lg px-4 py-2 text-sm font-bold transition ${editorSide === "front" ? "bg-white text-blue-700 shadow" : "text-slate-500 hover:text-slate-800"}`}>Лицевая</button>
              <button type="button" disabled={editorSaving || !hasBackCells} onClick={() => changeEditorSide("back")} className={`rounded-lg px-4 py-2 text-sm font-bold transition ${editorSide === "back" ? "bg-white text-blue-700 shadow" : "text-slate-500 hover:text-slate-800"} disabled:opacity-35`}>Задняя</button>
            </div>
          </div>
          <button type="button" disabled={editorSaving} onClick={() => setEditorOpen(false)} className="rounded-full bg-slate-100 p-3 text-slate-600 hover:bg-slate-200 disabled:opacity-40"><X size={20} /></button>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 overflow-auto p-4 sm:p-6 lg:grid-cols-[1fr_280px]">
          <div className="min-h-[520px] rounded-2xl border-4 border-slate-800 bg-slate-100 p-2 shadow-inner">
            <div data-rack-editor-grid className="flex h-[68vh] min-h-[500px] max-h-[720px] flex-col-reverse gap-0">
              {editorRows.slice().reverse().map((row, rowDisplayIndex, bottomUpRows) => {
                const rowHeight = row.cells[0]?.heightRatio || 1;
                const totalWidth = row.cells.reduce((sum, cell) => sum + cell.widthRatio, 0) || 1;
                const upperRow = bottomUpRows[rowDisplayIndex + 1];
                return <div key={row.rowIndex} className="relative flex min-h-[58px] border-t-4 border-slate-700 bg-white" style={{ flexGrow: rowHeight, flexBasis: 0 }}>
                  <div data-rack-editor-row={row.rowIndex} className="flex h-full w-full">
                    {row.cells.map((cell, index) => {
                      const next = row.cells[index + 1];
                      return <div key={cell.id} className="relative flex min-w-[52px] items-center justify-center border-r border-slate-300 bg-gradient-to-br from-white to-slate-50 p-2 text-center" style={{ flexGrow: cell.widthRatio, flexBasis: 0 }}>
                        <div className="pointer-events-none max-w-full">
                          <div className="truncate font-mono text-sm font-black text-slate-900 sm:text-base">{cell.code}</div>
                          <div className="mt-1 text-[10px] font-semibold text-slate-400">{Math.round(cell.widthRatio / totalWidth * 100)}% ширины</div>
                          {cell.hasStock && <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700"><Check size={10} /> Есть товар</div>}
                        </div>
                        <button type="button" disabled={cell.hasStock || row.cells.length <= 1} onClick={() => void archiveCell(cell)} className="absolute right-1 top-1 rounded-md bg-white/90 p-1.5 text-red-500 shadow disabled:cursor-not-allowed disabled:opacity-25" title={cell.hasStock ? "Сначала переместите товар" : row.cells.length <= 1 ? "Последнюю ячейку на полке удалить нельзя" : "Удалить ячейку"}><Trash2 size={13} /></button>
                        {next && <button type="button" aria-label="Изменить ширину" onPointerDown={(event) => beginWidthDrag(event, row.rowIndex, cell.id, next.id)} className="absolute -right-[7px] top-0 z-30 h-full w-[14px] cursor-col-resize touch-none bg-transparent hover:bg-blue-500/30"><span className="absolute left-1/2 top-1/2 h-12 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500 shadow" /></button>}
                      </div>;
                    })}
                  </div>
                  {upperRow && <button type="button" aria-label="Изменить высоту" onPointerDown={(event) => beginHeightDrag(event, upperRow.rowIndex, row.rowIndex)} className="absolute -top-[9px] left-0 z-40 h-[18px] w-full cursor-row-resize touch-none bg-transparent hover:bg-orange-500/20"><span className="absolute left-1/2 top-1/2 h-1 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full bg-orange-500 shadow" /></button>}
                </div>;
              })}
            </div>
          </div>

          <aside className="space-y-4">
            <div className="rounded-2xl bg-blue-50 p-4 text-sm leading-6 text-blue-950">
              <b>{sideLabel(editorSide)} сторона</b><br />
              Синяя вертикальная грань — ширина соседних ячеек.<br />
              Оранжевая горизонтальная грань — высота уровня.<br />
              Корзина удаляет только пустую ячейку.
            </div>
            <div className="rounded-2xl border p-4 text-sm text-slate-600">
              <div className="font-bold text-slate-900">Редактируется</div>
              <div className="mt-1">{sideLabel(editorSide)}</div>
              <div className="mt-3 font-bold text-slate-900">Полок</div>
              <div>{editorRows.length}</div>
              <div className="mt-3 font-bold text-slate-900">Активных ячеек</div>
              <div>{draft.length}</div>
              <div className="mt-3 font-bold text-slate-900">Сумма высот</div>
              <div>{editorHeightTotal.toFixed(2)}</div>
            </div>
            <button type="button" disabled={editorSaving} onClick={() => void saveEditor()} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3.5 font-bold text-white shadow-lg transition hover:bg-blue-700 disabled:opacity-50"><Save size={18} /> {editorSaving ? "Сохраняю…" : `Сохранить · ${sideLabel(editorSide)}`}</button>
            <button type="button" disabled={editorSaving} onClick={() => setEditorOpen(false)} className="w-full rounded-xl border px-5 py-3 font-semibold text-slate-700 hover:bg-slate-50">Отмена</button>
          </aside>
        </div>
      </div>
    </div>}
  </>;
}
