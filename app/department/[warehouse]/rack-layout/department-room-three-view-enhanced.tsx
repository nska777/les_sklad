"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { QRCodeSVG } from "qrcode.react";
import { ArrowRightLeft, History, PackagePlus, SlidersHorizontal, X } from "lucide-react";
import { toast } from "sonner";

type Rack = {
  id: string; name: string; code: string; rows: number; columns: number;
  storageType: string; width: number; depth: number;
  posX?: number; posZ?: number; rotation?: number;
};
type Cell = {
  id: string; rackId: string; code: string; label: string;
  rowIndex: number; columnIndex: number; blocked: boolean;
  cellWidth?: number; cellHeight?: number; cellDepth?: number;
};
type Stock = {
  productId: string; cellId: string; quantity: number;
  productName: string; unit: string; color?: string; packType?: string; packSize?: number;
};
type Product = {
  id: string; name: string; sku: string; barcode: string; oneCId?: string | null;
  unit: string; color?: string; packType?: string; packSize?: number; category?: string;
};
type Movement = {
  id: string; type: string; productId: string; productName: string; quantity: number;
  fromCellId?: string | null; toCellId?: string | null; fromCellCode?: string; toCellCode?: string;
  operator?: string; createdAt: string; comment?: string;
};
type Snapshot = {
  warehouse?: { code: string; name: string };
  cells: Cell[]; products: Product[];
  stocks: Array<{ productId: string; cellId: string; quantity: number }>;
  movements: Movement[];
};

type ModalMode = "contents" | "add" | "move" | "adjust" | "history";

function labelSprite(text: string, accent = false, scale = 1) {
  const canvas = document.createElement("canvas");
  canvas.width = 640; canvas.height = 180;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = accent ? "rgba(255,247,237,.97)" : "rgba(255,255,255,.96)";
  ctx.strokeStyle = accent ? "#f97316" : "#cbd5e1";
  ctx.lineWidth = 4; ctx.roundRect(8, 8, 624, 164, 26); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#0f172a"; ctx.font = "700 28px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  text.split("\n").slice(0, 3).forEach((line, i) => ctx.fillText(line, 320, 48 + i * 46, 580));
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(3.4 * scale, .96 * scale, 1);
  return sprite;
}

function colorFromText(value?: string) {
  const map: Record<string, number> = {
    белый: 0xf8fafc, черный: 0x111827, чёрный: 0x111827, красный: 0xdc2626,
    синий: 0x2563eb, зеленый: 0x16a34a, зелёный: 0x16a34a, желтый: 0xeab308,
    жёлтый: 0xeab308, серый: 0x64748b, коричневый: 0x92400e, оранжевый: 0xf97316,
  };
  return map[(value || "").trim().toLowerCase()] || 0xd97706;
}

function packageObject(stock: Stock, scale = 1) {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: colorFromText(stock.color), roughness: .5, metalness: .06 });
  const type = (stock.packType || "ведро").toLowerCase();
  if (type.includes("бутыл")) {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(.12 * scale, .14 * scale, .42 * scale, 20), material);
    body.position.y = .21 * scale;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(.055 * scale, .07 * scale, .13 * scale, 16), material);
    neck.position.y = .485 * scale; group.add(body, neck);
  } else if (type.includes("канистр")) {
    const body = new THREE.Mesh(new THREE.BoxGeometry(.35 * scale, .46 * scale, .25 * scale), material);
    body.position.y = .23 * scale;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(.055 * scale, .055 * scale, .09 * scale, 16), material);
    neck.position.set(.1 * scale, .505 * scale, 0); group.add(body, neck);
  } else if (type.includes("бан")) {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(.16 * scale, .17 * scale, .28 * scale, 24), material);
    body.position.y = .14 * scale; group.add(body);
  } else if (type.includes("боч")) {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(.25 * scale, .25 * scale, .55 * scale, 28), material);
    body.position.y = .275 * scale; group.add(body);
  } else {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(.2 * scale, .22 * scale, .38 * scale, 24), material);
    body.position.y = .19 * scale; group.add(body);
  }
  group.traverse((obj) => { if (obj instanceof THREE.Mesh) { obj.castShadow = true; obj.receiveShadow = true; } });
  return group;
}

function autoRackPosition(rack: Rack, index: number, floor: boolean) {
  const explicit = Math.abs(Number(rack.posX || 0)) > .01 || Math.abs(Number(rack.posZ || 0)) > .01;
  if (explicit) return { x: Number(rack.posX || 0), z: Number(rack.posZ || 0) };
  if (floor) { const col = index % 4, row = Math.floor(index / 4); return { x: -8 + col * 5.2, z: 7 + row * 4.5 }; }
  const col = index % 3, row = Math.floor(index / 3); return { x: -8 + col * 8, z: -5 + row * 6.5 };
}

export function DepartmentRoomThreeView({
  racks, cells, stocks, selectedCellId, selectedRackId, onCellClick, onRackClick, onClearSelection,
}: {
  racks: Rack[]; cells: Cell[]; stocks: Stock[];
  selectedCellId?: string | null; selectedRackId?: string | null;
  onCellClick: (cell: Cell) => void; onRackClick: (rack: Rack) => void; onClearSelection: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [activeCell, setActiveCell] = useState<Cell | null>(null);
  const [mode, setMode] = useState<ModalMode>("contents");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [viewStocks, setViewStocks] = useState<Stock[]>(stocks);
  const [busy, setBusy] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [addProductId, setAddProductId] = useState("");
  const [moveProductId, setMoveProductId] = useState("");
  const [targetCellId, setTargetCellId] = useState("");
  const [moveQty, setMoveQty] = useState("");
  const [adjustProductId, setAdjustProductId] = useState("");
  const [adjustQty, setAdjustQty] = useState("");

  useEffect(() => setViewStocks(stocks), [stocks]);

  const loadSnapshot = useCallback(async () => {
    const response = await fetch("/api/department-warehouse", { cache: "no-store" });
    const body = await response.json() as Snapshot & { error?: string };
    if (!response.ok) throw new Error(body.error || "Не удалось загрузить ячейку");
    setSnapshot(body);
    const productMap = new Map(body.products.map((p) => [p.id, p]));
    setViewStocks(body.stocks.map((s) => {
      const p = productMap.get(s.productId);
      return { ...s, productName: p?.name || "Материал", unit: p?.unit || "", color: p?.color || "", packType: p?.packType || "", packSize: Number(p?.packSize || 0) };
    }));
    return body;
  }, []);

  const post = async (payload: Record<string, unknown>, success: string) => {
    setBusy(true);
    try {
      const response = await fetch("/api/department-warehouse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "Операция не выполнена");
      toast.success(success);
      await loadSnapshot();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Операция не выполнена"); }
    finally { setBusy(false); }
  };

  const openCell = useCallback((cell: Cell) => {
    onCellClick(cell); setActiveCell(cell); setMode("contents");
    setProductSearch(""); setAddProductId(""); setMoveProductId(""); setTargetCellId(""); setMoveQty("");
    void loadSnapshot().catch((error) => toast.error(error instanceof Error ? error.message : "Не удалось загрузить данные"));
  }, [loadSnapshot, onCellClick]);

  const activeStocks = useMemo(() => {
    if (!activeCell) return [];
    const source = snapshot?.stocks || [];
    return source.filter((s) => s.cellId === activeCell.id && Number(s.quantity) > 0);
  }, [activeCell, snapshot]);
  const productById = useMemo(() => new Map((snapshot?.products || []).map((p) => [p.id, p])), [snapshot]);
  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    const list = snapshot?.products || [];
    if (!q) return list;
    return list.filter((p) => `${p.name} ${p.sku} ${p.barcode} ${p.oneCId || ""} ${p.category || ""}`.toLowerCase().includes(q));
  }, [snapshot, productSearch]);
  const cellHistory = useMemo(() => activeCell ? (snapshot?.movements || []).filter((m) => m.fromCellId === activeCell.id || m.toCellId === activeCell.id) : [], [snapshot, activeCell]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.innerHTML = "";
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0xf1f5f9); scene.fog = new THREE.Fog(0xf1f5f9, 30, 70);
    const rackOnly = racks.filter((r) => r.storageType !== "floor");
    const floorsOnly = racks.filter((r) => r.storageType === "floor");
    const placements = [...rackOnly.map((r, i) => autoRackPosition(r, i, false)), ...floorsOnly.map((r, i) => autoRackPosition(r, i, true))];
    const centerX = placements.length ? placements.reduce((s, p) => s + p.x, 0) / placements.length : 0;
    const centerZ = placements.length ? placements.reduce((s, p) => s + p.z, 0) / placements.length : 0;
    const center = new THREE.Vector3(centerX, 2.2, centerZ);
    const camera = new THREE.PerspectiveCamera(46, 1, .1, 140); camera.position.set(center.x + 13, center.y + 10, center.z + 17); camera.lookAt(center);
    const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.shadowMap.enabled = true; renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.width = "100%"; renderer.domElement.style.height = "100%"; renderer.domElement.style.cursor = "pointer"; host.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.target.copy(center); controls.maxPolarAngle = Math.PI / 2.02; controls.enablePan = true;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x64748b, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 3.2); key.position.set(center.x + 10, 16, center.z + 10); key.castShadow = true; scene.add(key);
    const roomFloor = new THREE.Mesh(new THREE.PlaneGeometry(42, 32), new THREE.MeshStandardMaterial({ color: 0xe5e7eb, roughness: .94 })); roomFloor.rotation.x = -Math.PI / 2; roomFloor.position.set(center.x, 0, center.z); roomFloor.receiveShadow = true; scene.add(roomFloor);
    const grid = new THREE.GridHelper(42, 42, 0x94a3b8, 0xcbd5e1); grid.position.set(center.x, .01, center.z); scene.add(grid);

    const cellInteractive: THREE.Object3D[] = [], rackInteractive: THREE.Object3D[] = [];
    const cellByObject = new Map<string, Cell>(), rackByObject = new Map<string, Rack>();
    const steel = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: .42, metalness: .65 });
    const shelf = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: .55, metalness: .45 });
    const addBox = (group: THREE.Group, w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh); return mesh;
    };

    rackOnly.forEach((rack, rackIndex) => {
      const group = new THREE.Group(); const pos = autoRackPosition(rack, rackIndex, false); group.position.set(pos.x, 0, pos.z); group.rotation.y = Number(rack.rotation || 0); scene.add(group);
      const rackCells = cells.filter((c) => c.rackId === rack.id);
      const rows = Array.from({ length: rack.rows }, (_, rr) => rackCells.filter((c) => c.rowIndex === rr).sort((a, b) => a.columnIndex - b.columnIndex));
      const rowHeights = rows.map((row) => Math.max(.35, ...row.map((c) => Number(c.cellHeight || 1.1))));
      const rowWidths = rows.map((row) => row.reduce((sum, c) => sum + Math.max(.25, Number(c.cellWidth || Number(rack.width || 4) / Math.max(1, row.length))), 0));
      const rackWidth = Math.max(Number(rack.width || 4), ...rowWidths, 1);
      const rackDepth = Math.max(Number(rack.depth || 1.2), ...rackCells.map((c) => Number(c.cellDepth || rack.depth || 1.2)), .8);
      const shelfT = .09, baseT = .18; const height = rowHeights.reduce((sum, h) => sum + h + shelfT, 0) + baseT;
      addBox(group, rackWidth + .4, baseT, rackDepth + .25, 0, baseT / 2, 0, steel);
      let yCursor = baseT;
      rows.forEach((row, rr) => {
        const rowH = rowHeights[rr], totalW = rowWidths[rr] || rackWidth; let xCursor = -totalW / 2;
        row.forEach((cell) => {
          const cw = Math.max(.25, Number(cell.cellWidth || rackWidth / Math.max(1, row.length)));
          const ch = Math.max(.25, Number(cell.cellHeight || rowH)); const cd = Math.max(.25, Number(cell.cellDepth || rackDepth));
          const x = xCursor + cw / 2, y = yCursor + ch / 2, z = cd / 2 + .04; xCursor += cw;
          const ss = viewStocks.filter((s) => s.cellId === cell.id && Number(s.quantity) > 0); const occupied = ss.length > 0; const selected = cell.id === selectedCellId;
          const mat = new THREE.MeshStandardMaterial({ color: selected ? 0xf59e0b : occupied ? 0xbfdbfe : 0xffffff, transparent: true, opacity: selected ? .92 : occupied ? .46 : .12, emissive: selected ? 0xf59e0b : 0x000000, emissiveIntensity: selected ? .45 : 0 });
          const hit = new THREE.Mesh(new THREE.BoxGeometry(Math.max(.18, cw - .05), Math.max(.18, ch - .06), .12), mat); hit.position.set(x, y, z); group.add(hit); cellInteractive.push(hit); cellByObject.set(hit.uuid, cell);
          addBox(group, .05, ch, Math.max(.2, cd), x - cw / 2, y, 0, shelf);

          const visualItems: Stock[] = [];
          ss.forEach((stock) => {
            const packages = Number(stock.packSize) > 0 ? Math.max(1, Math.min(8, Math.ceil(Number(stock.quantity) / Number(stock.packSize)))) : 1;
            for (let i = 0; i < packages; i += 1) visualItems.push(stock);
          });
          const cols = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, visualItems.length))));
          const rowsCount = Math.max(1, Math.ceil(visualItems.length / cols));
          const stepX = Math.min(.42, Math.max(.16, cw * .72 / Math.max(1, cols)));
          const stepZ = Math.min(.36, Math.max(.14, cd * .55 / Math.max(1, rowsCount)));
          visualItems.forEach((stock, idx) => {
            const col = idx % cols, rowIdx = Math.floor(idx / cols);
            const visual = packageObject(stock, Math.min(.68, Math.max(.3, Math.min(cw / Math.max(2, cols), ch) * .65)));
            visual.position.set(x + (col - (cols - 1) / 2) * stepX, yCursor + .08, .08 + (rowIdx - (rowsCount - 1) / 2) * stepZ);
            group.add(visual);
          });
          const total = ss.reduce((sum, s) => sum + Number(s.quantity), 0), first = ss[0];
          const label = labelSprite(occupied ? `${cell.code}\n${first.productName}${ss.length > 1 ? ` +${ss.length - 1}` : ""}\n${total.toLocaleString("ru-RU")} ${first.unit}` : `${cell.code}\n${cw.toFixed(2)}×${ch.toFixed(2)}×${cd.toFixed(2)} м`, selected || occupied, .72);
          label.position.set(x, y + .15, z + .34); label.scale.x = Math.min(2.7, Math.max(1.05, cw * .85)); group.add(label);
        });
        if (row.length) addBox(group, .05, rowH, rackDepth, totalW / 2, yCursor + rowH / 2, 0, shelf);
        yCursor += rowH; addBox(group, rackWidth + .15, shelfT, rackDepth, 0, yCursor + shelfT / 2, 0, shelf); yCursor += shelfT;
      });
      addBox(group, rackWidth + .4, baseT, rackDepth + .25, 0, height, 0, steel);
      for (const x of [-rackWidth / 2, rackWidth / 2]) { addBox(group, .14, height, .14, x, height / 2, -rackDepth / 2, steel); addBox(group, .14, height, .14, x, height / 2, rackDepth / 2, steel); }
      const title = labelSprite(`${rack.code} · ${rack.name}`, true, .82); title.position.set(0, height + .65, 0); group.add(title);
      const rackHit = new THREE.Mesh(new THREE.BoxGeometry(rackWidth + .7, height + .4, rackDepth + .7), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })); rackHit.position.set(0, height / 2, 0); group.add(rackHit); rackInteractive.push(rackHit); rackByObject.set(rackHit.uuid, rack);
      if (rack.id === selectedRackId) { const helper = new THREE.BoxHelper(group, 0xf97316); helper.material.depthTest = false; helper.renderOrder = 30; scene.add(helper); }
    });

    floorsOnly.forEach((zone, i) => {
      const pos = autoRackPosition(zone, i, true), x = pos.x, z = pos.z; const w = Math.max(1.4, Number(zone.width || 2)), d = Math.max(1.4, Number(zone.depth || 2));
      const cell = cells.find((c) => c.rackId === zone.id); if (!cell) return;
      const ss = viewStocks.filter((s) => s.cellId === cell.id && Number(s.quantity) > 0), selected = zone.id === selectedRackId;
      const pad = new THREE.Mesh(new THREE.BoxGeometry(w, .12, d), new THREE.MeshStandardMaterial({ color: selected ? 0xf59e0b : 0xfef3c7, transparent: true, opacity: .72, roughness: .8 })); pad.position.set(x, .07, z); pad.receiveShadow = true; scene.add(pad); rackInteractive.push(pad); rackByObject.set(pad.uuid, zone); cellInteractive.push(pad); cellByObject.set(pad.uuid, cell);
      const visualItems: Stock[] = [];
      ss.forEach((stock) => { const count = Number(stock.packSize) > 0 ? Math.max(1, Math.min(12, Math.ceil(Number(stock.quantity) / Number(stock.packSize)))) : 1; for (let n = 0; n < count; n += 1) visualItems.push(stock); });
      const cols = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, visualItems.length))));
      visualItems.forEach((stock, idx) => { const col = idx % cols, row = Math.floor(idx / cols); const visual = packageObject(stock, .9); visual.position.set(x + (col - (cols - 1) / 2) * .48, .12, z + (row - Math.floor((visualItems.length - 1) / cols) / 2) * .48); scene.add(visual); });
      if (ss.length) { const label = labelSprite(`${zone.code}\n${ss.length} наимен.\n${ss.reduce((sum, s) => sum + Number(s.quantity), 0).toLocaleString("ru-RU")}`, true, .62); label.position.set(x, 1.45, z); scene.add(label); }
      else { const label = labelSprite(`${zone.code} · ${zone.name}\nНапольная зона\nСвободно`, true, .72); label.position.set(x, 1.3, z); scene.add(label); }
      if (selected) { const helper = new THREE.BoxHelper(pad, 0xf97316); helper.material.depthTest = false; helper.renderOrder = 30; scene.add(helper); }
    });

    const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2(); let downX = 0, downY = 0;
    const onDown = (e: PointerEvent) => { downX = e.clientX; downY = e.clientY; };
    const onUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return;
      const rect = renderer.domElement.getBoundingClientRect(); pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1; pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1; raycaster.setFromCamera(pointer, camera);
      const cellHit = raycaster.intersectObjects(cellInteractive, false)[0]; if (cellHit) { const cell = cellByObject.get(cellHit.object.uuid); if (cell) { openCell(cell); return; } }
      const rackHit = raycaster.intersectObjects(rackInteractive, false)[0]; if (rackHit) { const rack = rackByObject.get(rackHit.object.uuid); if (rack) { onRackClick(rack); return; } }
      onClearSelection(); setActiveCell(null);
    };
    renderer.domElement.addEventListener("pointerdown", onDown); renderer.domElement.addEventListener("pointerup", onUp);
    const resize = () => { const w = Math.max(320, host.clientWidth), h = Math.max(640, host.clientHeight); camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h, false); };
    const observer = new ResizeObserver(resize); observer.observe(host); resize(); let frame = 0;
    const animate = () => { controls.update(); renderer.render(scene, camera); frame = requestAnimationFrame(animate); }; animate();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); renderer.domElement.removeEventListener("pointerdown", onDown); renderer.domElement.removeEventListener("pointerup", onUp); controls.dispose(); scene.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose()); else o.material.dispose(); } if (o instanceof THREE.Sprite) { o.material.map?.dispose(); o.material.dispose(); } }); renderer.dispose(); host.innerHTML = ""; };
  }, [racks, cells, viewStocks, selectedCellId, selectedRackId, onRackClick, onClearSelection, openCell]);

  const submitAdd = async (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); if (!activeCell || !addProductId) return; const form = new FormData(e.currentTarget); await post({ action: "receive", productId: addProductId, cellId: activeCell.id, quantity: form.get("quantity"), documentNumber: "3D-РАЗМЕЩЕНИЕ", sourceName: "Размещение", sourceLocation: activeCell.code, comment: "Добавлено из карточки ячейки" }, "Материал размещён"); setMode("contents"); };
  const submitMove = async (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); if (!activeCell || !moveProductId || !targetCellId) return; await post({ action: "transfer", productId: moveProductId, fromCellId: activeCell.id, toCellId: targetCellId, quantity: moveQty, comment: "Перемещение из карточки ячейки" }, "Материал перемещён"); setMode("contents"); };
  const submitAdjust = async (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); if (!activeCell || !adjustProductId) return; const current = Number(activeStocks.find((s) => s.productId === adjustProductId)?.quantity || 0), target = Number(adjustQty); if (!Number.isFinite(target) || target < 0) return toast.error("Укажите корректный фактический остаток"); const delta = target - current; if (delta === 0) return toast.message("Остаток не изменился"); if (delta > 0) await post({ action: "receive", productId: adjustProductId, cellId: activeCell.id, quantity: delta, documentNumber: "КОРРЕКТИРОВКА", sourceName: "Инвентаризация", sourceLocation: activeCell.code, comment: `Корректировка до ${target}` }, "Остаток скорректирован"); else await post({ action: "issue", productId: adjustProductId, cellId: activeCell.id, quantity: Math.abs(delta), recipient: "Корректировка", documentNumber: "КОРРЕКТИРОВКА", comment: `Корректировка до ${target}` }, "Остаток скорректирован"); setMode("contents"); };

  const modeButton = (id: ModalMode, label: string, icon: React.ReactNode) => <button type="button" onClick={() => setMode(id)} className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold ${mode === id ? "bg-blue-600 text-white" : "border bg-white text-slate-700 hover:bg-slate-50"}`}>{icon}{label}</button>;

  return <>
    <div className="relative overflow-hidden rounded-3xl border bg-slate-100 shadow-inner"><div ref={hostRef} className="h-[76vh] min-h-[680px] w-full"/><div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border bg-white/90 px-4 py-2 text-xs font-medium text-slate-600 shadow">Стеллаж — выбрать · ячейка — открыть карточку · пустое место — снять выделение</div></div>

    {activeCell && <div className="fixed inset-0 z-[30000] flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) setActiveCell(null); }}>
      <div className="max-h-[92vh] w-full max-w-[980px] overflow-auto rounded-[28px] border bg-white p-5 shadow-2xl sm:p-6">
        <div className="flex items-start justify-between gap-4"><div><div className="text-xs font-black uppercase tracking-[.14em] text-blue-600">Ячейка / место хранения</div><h2 className="mt-1 text-2xl font-black">{activeCell.code}</h2><p className="mt-1 text-sm text-slate-500">{activeStocks.length} позиций · {activeStocks.length ? "Занята" : "Свободна"}</p></div><button type="button" onClick={() => setActiveCell(null)} className="rounded-xl p-2 hover:bg-slate-100"><X/></button></div>
        <div className="mt-5 grid gap-4 md:grid-cols-[170px_1fr]">
          <div className="flex h-[170px] items-center justify-center rounded-2xl border bg-white"><QRCodeSVG value={`RL-CELL:${snapshot?.warehouse?.code || "paint"}:${activeCell.code}`} size={140}/></div>
          <div className="flex flex-wrap content-start gap-2">{modeButton("contents", "Содержимое", <PackagePlus size={15}/>)}{modeButton("add", "Добавить", <PackagePlus size={15}/>)}{modeButton("move", "Переместить", <ArrowRightLeft size={15}/>)}{modeButton("adjust", "Корректировать", <SlidersHorizontal size={15}/>)}{modeButton("history", "История", <History size={15}/>)}</div>
        </div>

        {mode === "contents" && <div className="mt-5 space-y-3">{activeStocks.map((s) => { const p = productById.get(s.productId); return <div key={s.productId} className="grid gap-3 rounded-2xl border bg-slate-50 p-4 sm:grid-cols-[1fr_auto] sm:items-center"><div><div className="font-black">{p?.name || "Материал"}</div><div className="mt-1 text-xs text-slate-500">{p?.sku || ""}{p?.oneCId ? ` · 1С ${p.oneCId}` : ""}</div><div className="mt-1 font-mono text-xs text-slate-400">Штрихкод: {p?.barcode || "—"}</div></div><div className="text-lg font-black">{Number(s.quantity).toLocaleString("ru-RU")} {p?.unit || ""}</div></div>; })}{!activeStocks.length && <div className="rounded-2xl border border-dashed p-10 text-center text-slate-400">Ячейка свободна</div>}</div>}

        {mode === "add" && <form className="mt-5 space-y-4" onSubmit={submitAdd}><div><label className="mb-1.5 block text-sm font-bold">Поиск материала</label><input value={productSearch} onChange={(e) => setProductSearch(e.target.value)} placeholder="Название, артикул, штрихкод, ID 1С" className="h-11 w-full rounded-xl border px-3 outline-none focus:border-blue-500"/></div><div><label className="mb-1.5 block text-sm font-bold">Материал</label><select value={addProductId} onChange={(e) => setAddProductId(e.target.value)} className="h-11 w-full rounded-xl border bg-white px-3"><option value="">Выберите...</option>{filteredProducts.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.sku} · {p.unit}</option>)}</select></div><div><label className="mb-1.5 block text-sm font-bold">Количество</label><input name="quantity" type="number" step="0.001" min="0.001" required className="h-11 w-full rounded-xl border px-3"/></div><button disabled={busy || !addProductId} className="h-11 w-full rounded-xl bg-orange-500 font-bold text-white disabled:opacity-50">Разместить в {activeCell.code}</button></form>}

        {mode === "move" && <form className="mt-5 space-y-4" onSubmit={submitMove}><div><label className="mb-1.5 block text-sm font-bold">Что перемещаем</label><select value={moveProductId} onChange={(e) => setMoveProductId(e.target.value)} className="h-11 w-full rounded-xl border bg-white px-3"><option value="">Выберите...</option>{activeStocks.map((s) => { const p = productById.get(s.productId); return <option key={s.productId} value={s.productId}>{p?.name} · {s.quantity} {p?.unit}</option>; })}</select></div><div><label className="mb-1.5 block text-sm font-bold">Куда</label><select value={targetCellId} onChange={(e) => setTargetCellId(e.target.value)} className="h-11 w-full rounded-xl border bg-white px-3"><option value="">Выберите ячейку / напольную зону...</option>{(snapshot?.cells || []).filter((c) => c.id !== activeCell.id).map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}</select></div><div><label className="mb-1.5 block text-sm font-bold">Количество</label><input value={moveQty} onChange={(e) => setMoveQty(e.target.value)} type="number" step="0.001" min="0.001" required className="h-11 w-full rounded-xl border px-3"/></div><button disabled={busy || !moveProductId || !targetCellId} className="h-11 w-full rounded-xl bg-blue-600 font-bold text-white disabled:opacity-50">Переместить</button></form>}

        {mode === "adjust" && <form className="mt-5 space-y-4" onSubmit={submitAdjust}><div><label className="mb-1.5 block text-sm font-bold">Материал</label><select value={adjustProductId} onChange={(e) => { setAdjustProductId(e.target.value); const s = activeStocks.find((x) => x.productId === e.target.value); setAdjustQty(s ? String(s.quantity) : ""); }} className="h-11 w-full rounded-xl border bg-white px-3"><option value="">Выберите...</option>{activeStocks.map((s) => <option key={s.productId} value={s.productId}>{productById.get(s.productId)?.name}</option>)}</select></div><div><label className="mb-1.5 block text-sm font-bold">Фактический остаток</label><input value={adjustQty} onChange={(e) => setAdjustQty(e.target.value)} type="number" step="0.001" min="0" className="h-11 w-full rounded-xl border px-3"/></div><button disabled={busy || !adjustProductId} className="h-11 w-full rounded-xl bg-slate-900 font-bold text-white disabled:opacity-50">Сохранить корректировку</button></form>}

        {mode === "history" && <div className="mt-5 space-y-2">{cellHistory.map((m) => <div key={m.id} className="rounded-xl border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><b>{m.type} · {m.productName}</b><span className="text-xs text-slate-400">{new Date(m.createdAt).toLocaleString("ru-RU")}</span></div><div className="mt-1 text-sm text-slate-600">{Number(m.quantity).toLocaleString("ru-RU")} · {m.fromCellCode || "—"} → {m.toCellCode || "—"}</div>{m.comment && <div className="mt-1 text-xs text-slate-400">{m.comment}</div>}</div>)}{!cellHistory.length && <div className="rounded-2xl border border-dashed p-8 text-center text-slate-400">Движений по ячейке пока нет</div>}</div>}
      </div>
    </div>}
  </>;
}
