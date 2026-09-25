"use client";

import { useCallback, useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

type Rack = { id: string; name: string; code: string; rows: number; columns: number; storageType: string; width: number; depth: number; posX?: number; posZ?: number; rotation?: number };
type Cell = { id: string; rackId: string; code: string; label: string; rowIndex: number; columnIndex: number; blocked: boolean };
type Stock = { productId: string; cellId: string; quantity: number; productName: string; unit: string; color?: string; packType?: string; packSize?: number };
type CameraPreset = "overview" | "front" | "left" | "right" | "top" | "zoomIn" | "zoomOut" | "rotateLeft" | "rotateRight";

function labelSprite(text: string, accent = false, scale = 1) {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 180;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = accent ? "rgba(255,247,237,.97)" : "rgba(255,255,255,.96)";
  ctx.strokeStyle = accent ? "#f97316" : "#cbd5e1";
  ctx.lineWidth = 4;
  ctx.roundRect(8, 8, 624, 164, 26);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#0f172a";
  ctx.font = "700 28px system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  text.split("\n").slice(0, 3).forEach((line, i) => ctx.fillText(line, 320, 48 + i * 46, 580));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(3.4 * scale, 0.96 * scale, 1);
  return sprite;
}

function colorFromText(value?: string) {
  const v = (value || "").trim().toLowerCase();
  const map: Record<string, number> = {
    белый: 0xf8fafc, черный: 0x111827, чёрный: 0x111827, красный: 0xdc2626,
    синий: 0x2563eb, зеленый: 0x16a34a, зелёный: 0x16a34a, желтый: 0xeab308,
    жёлтый: 0xeab308, серый: 0x64748b, коричневый: 0x92400e, оранжевый: 0xf97316,
  };
  return map[v] || 0xd97706;
}

function packageObject(stock: Stock, scale = 1) {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: colorFromText(stock.color), roughness: 0.5, metalness: 0.06 });
  const type = (stock.packType || "ведро").toLowerCase();
  if (type.includes("бутыл")) {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * scale, 0.14 * scale, 0.42 * scale, 20), material);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.055 * scale, 0.07 * scale, 0.13 * scale, 16), material);
    body.position.y = 0.21 * scale; neck.position.y = 0.485 * scale; group.add(body, neck);
  } else if (type.includes("канистр")) {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.35 * scale, 0.46 * scale, 0.25 * scale), material);
    body.position.y = 0.23 * scale;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.055 * scale, 0.055 * scale, 0.09 * scale, 16), material);
    neck.position.set(0.1 * scale, 0.505 * scale, 0); group.add(body, neck);
  } else if (type.includes("бан")) {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * scale, 0.17 * scale, 0.28 * scale, 24), material);
    body.position.y = 0.14 * scale; group.add(body);
  } else if (type.includes("боч")) {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.25 * scale, 0.25 * scale, 0.55 * scale, 28), material);
    body.position.y = 0.275 * scale; group.add(body);
  } else {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2 * scale, 0.22 * scale, 0.38 * scale, 24), material);
    body.position.y = 0.19 * scale; group.add(body);
  }
  group.traverse((obj) => { if (obj instanceof THREE.Mesh) { obj.castShadow = true; obj.receiveShadow = true; } });
  return group;
}

function autoRackPosition(rack: Rack, index: number, floor: boolean) {
  const explicit = Math.abs(Number(rack.posX || 0)) > 0.01 || Math.abs(Number(rack.posZ || 0)) > 0.01;
  if (explicit) return { x: Number(rack.posX || 0), z: Number(rack.posZ || 0) };
  if (floor) { const col = index % 4; const row = Math.floor(index / 4); return { x: -8 + col * 5.2, z: 7 + row * 4.5 }; }
  const col = index % 3; const row = Math.floor(index / 3); return { x: -8 + col * 8, z: -5 + row * 6.5 };
}

export function DepartmentRoomThreeView({ racks, cells, stocks, selectedCellId, selectedRackId, onCellClick }: {
  racks: Rack[];
  cells: Cell[];
  stocks: Stock[];
  selectedCellId?: string | null;
  selectedRackId?: string | null;
  onCellClick: (cell: Cell) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const centerRef = useRef(new THREE.Vector3(0, 2, 0));

  const cameraAction = useCallback((preset: CameraPreset) => {
    const camera = cameraRef.current; const controls = controlsRef.current;
    if (!camera || !controls) return;
    const center = centerRef.current; const offset = camera.position.clone().sub(center); const distance = Math.max(7, offset.length());
    if (preset === "overview") camera.position.set(center.x + 13, center.y + 10, center.z + 17);
    if (preset === "front") camera.position.set(center.x, center.y + 4.5, center.z + Math.max(15, distance));
    if (preset === "left") camera.position.set(center.x - Math.max(15, distance), center.y + 4.5, center.z);
    if (preset === "right") camera.position.set(center.x + Math.max(15, distance), center.y + 4.5, center.z);
    if (preset === "top") camera.position.set(center.x, center.y + Math.max(18, distance), center.z + 0.01);
    if (preset === "zoomIn") camera.position.lerp(center, 0.18);
    if (preset === "zoomOut") camera.position.add(camera.position.clone().sub(center).normalize().multiplyScalar(2.8));
    if (preset === "rotateLeft" || preset === "rotateRight") {
      const angle = preset === "rotateLeft" ? Math.PI / 8 : -Math.PI / 8;
      const horizontal = new THREE.Vector3(camera.position.x - center.x, 0, camera.position.z - center.z);
      horizontal.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
      camera.position.x = center.x + horizontal.x; camera.position.z = center.z + horizontal.z;
    }
    controls.target.copy(center); camera.lookAt(center); controls.update();
  }, []);

  useEffect(() => {
    const host = hostRef.current; if (!host) return; host.innerHTML = "";
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0xf1f5f9); scene.fog = new THREE.Fog(0xf1f5f9, 30, 70);
    const rackOnly = racks.filter((r) => r.storageType !== "floor");
    const floorsOnly = racks.filter((r) => r.storageType === "floor");
    const placements = [...rackOnly.map((r, i) => autoRackPosition(r, i, false)), ...floorsOnly.map((r, i) => autoRackPosition(r, i, true))];
    const centerX = placements.length ? placements.reduce((s, p) => s + p.x, 0) / placements.length : 0;
    const centerZ = placements.length ? placements.reduce((s, p) => s + p.z, 0) / placements.length : 0;
    const center = new THREE.Vector3(centerX, 2.2, centerZ); centerRef.current.copy(center);

    const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 140); camera.position.set(center.x + 13, center.y + 10, center.z + 17); camera.lookAt(center); cameraRef.current = camera;
    const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.shadowMap.enabled = true; renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.domElement.style.width = "100%"; renderer.domElement.style.height = "100%"; renderer.domElement.style.cursor = "pointer"; host.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.target.copy(center); controls.maxPolarAngle = Math.PI / 2.02; controls.enablePan = true; controlsRef.current = controls;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x64748b, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 3.2); key.position.set(center.x + 10, 16, center.z + 10); key.castShadow = true; scene.add(key);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(42, 32), new THREE.MeshStandardMaterial({ color: 0xe5e7eb, roughness: 0.94 })); floor.rotation.x = -Math.PI / 2; floor.position.set(center.x, 0, center.z); floor.receiveShadow = true; scene.add(floor);
    const grid = new THREE.GridHelper(42, 42, 0x94a3b8, 0xcbd5e1); grid.position.set(center.x, 0.01, center.z); scene.add(grid);

    const interactive: THREE.Object3D[] = []; const cellByObject = new Map<string, Cell>();
    const steel = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.42, metalness: 0.65 });
    const shelf = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.55, metalness: 0.45 });
    const addBox = (group: THREE.Group, w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material) => { const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh); return mesh; };

    rackOnly.forEach((rack, rackIndex) => {
      const group = new THREE.Group(); const pos = autoRackPosition(rack, rackIndex, false); group.position.set(pos.x, 0, pos.z); group.rotation.y = Number(rack.rotation || 0); scene.add(group);
      const width = Math.max(3.4, Number(rack.width || 4)); const depth = Math.max(1, Number(rack.depth || 1.2)); const rowH = 1.25; const height = Math.max(2, rack.rows * rowH + 0.3);
      addBox(group, width + 0.4, 0.18, depth + 0.25, 0, 0.08, 0, steel); addBox(group, width + 0.4, 0.18, depth + 0.25, 0, height, 0, steel);
      for (const x of [-width / 2, width / 2]) { addBox(group, 0.14, height, 0.14, x, height / 2, -depth / 2, steel); addBox(group, 0.14, height, 0.14, x, height / 2, depth / 2, steel); }
      for (let rr = 0; rr < rack.rows; rr += 1) addBox(group, width + 0.15, 0.09, depth, 0, (rr + 1) * rowH, 0, shelf);
      if (rack.id === selectedRackId) { const helper = new THREE.BoxHelper(group, 0xf97316); helper.material.depthTest = false; helper.renderOrder = 30; scene.add(helper); }
      const rackCells = cells.filter((c) => c.rackId === rack.id);
      for (let rr = 0; rr < rack.rows; rr += 1) {
        const rowCells = rackCells.filter((c) => c.rowIndex === rr).sort((a, b) => a.columnIndex - b.columnIndex); const cw = width / Math.max(1, rowCells.length);
        rowCells.forEach((cell, i) => {
          const x = -width / 2 + cw * i + cw / 2; const y = rr * rowH + rowH / 2 + 0.04; const z = depth / 2 + 0.08;
          const ss = stocks.filter((s) => s.cellId === cell.id && Number(s.quantity) > 0); const occupied = ss.length > 0; const selected = cell.id === selectedCellId;
          const mat = new THREE.MeshStandardMaterial({ color: selected ? 0xf59e0b : occupied ? 0xbfdbfe : 0xffffff, transparent: true, opacity: selected ? 0.92 : occupied ? 0.6 : 0.18, emissive: selected ? 0xf59e0b : 0x000000, emissiveIntensity: selected ? 0.45 : 0 });
          const hit = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.25, cw - 0.12), rowH - 0.15, 0.18), mat); hit.position.set(x, y, z); group.add(hit); interactive.push(hit); cellByObject.set(hit.uuid, cell);
          ss.slice(0, 3).forEach((stock, productIndex) => { const visual = packageObject(stock, 0.72); visual.position.set(x + (productIndex - (Math.min(ss.length, 3) - 1) / 2) * 0.34, y - 0.42, z + 0.18); group.add(visual); });
          const total = ss.reduce((sum, s) => sum + Number(s.quantity), 0); const first = ss[0];
          const label = labelSprite(occupied ? `${cell.code}\n${first.productName}${ss.length > 1 ? ` +${ss.length - 1}` : ""}\n${total.toLocaleString("ru-RU")} ${first.unit}` : `${cell.code}\nСвободно`, selected || occupied, 0.78);
          label.position.set(x, y + 0.28, z + 0.34); label.scale.x = Math.min(2.6, Math.max(1.25, cw * 0.75)); group.add(label);
        });
      }
      const title = labelSprite(`${rack.code} · ${rack.name}`, true, 0.82); title.position.set(0, height + 0.65, 0); group.add(title);
    });

    floorsOnly.forEach((zone, i) => {
      const pos = autoRackPosition(zone, i, true); const group = new THREE.Group(); group.position.set(pos.x, 0, pos.z); group.rotation.y = Number(zone.rotation || 0); scene.add(group);
      const w = Math.max(1.4, Number(zone.width || 2)); const d = Math.max(1.4, Number(zone.depth || 2)); const cell = cells.find((c) => c.rackId === zone.id); if (!cell) return;
      const ss = stocks.filter((s) => s.cellId === cell.id && Number(s.quantity) > 0); const selected = cell.id === selectedCellId || zone.id === selectedRackId;
      const pad = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, d), new THREE.MeshStandardMaterial({ color: selected ? 0xf59e0b : 0xfef3c7, transparent: true, opacity: 0.78, roughness: 0.8 }));
      pad.position.set(0, 0.07, 0); pad.receiveShadow = true; group.add(pad); interactive.push(pad); cellByObject.set(pad.uuid, cell);
      const productCount = Math.max(1, ss.length); const columns = Math.max(1, Math.ceil(Math.sqrt(productCount))); const spacingX = Math.min(1.15, Math.max(0.65, w / Math.max(columns, 1))); const spacingZ = Math.min(1.15, Math.max(0.7, d / Math.max(Math.ceil(productCount / columns), 1)));
      ss.forEach((stock, productIndex) => {
        const row = Math.floor(productIndex / columns); const col = productIndex % columns; const x = (col - (columns - 1) / 2) * spacingX; const rows = Math.ceil(productCount / columns); const z = (row - (rows - 1) / 2) * spacingZ;
        const packages = Math.min(4, Math.max(1, Math.ceil(Number(stock.quantity) / (Number(stock.packSize) || Number(stock.quantity) || 1))));
        for (let p = 0; p < packages; p += 1) { const visual = packageObject(stock, 0.9); const localCols = Math.min(2, packages); const lx = x + ((p % localCols) - (localCols - 1) / 2) * 0.42; const lz = z + (Math.floor(p / localCols) - (Math.ceil(packages / localCols) - 1) / 2) * 0.42; visual.position.set(lx, 0.12, lz); group.add(visual); }
        const productLabel = labelSprite(`${stock.productName}\n${Number(stock.quantity).toLocaleString("ru-RU")} ${stock.unit}`, false, 0.48); productLabel.position.set(x, 1.05 + productIndex * 0.02, z); productLabel.scale.set(1.9, 0.55, 1); group.add(productLabel);
      });
      const label = labelSprite(`${zone.code} · ${zone.name}\n${ss.length ? `${ss.length} наимен.` : "Напольная зона"}\n${ss.length ? "Занято" : "Свободно"}`, true, 0.68); label.position.set(0, 1.8, -d / 2 - 0.25); group.add(label);
    });

    const raycaster = new THREE.Raycaster(); const pointer = new THREE.Vector2(); let downX = 0; let downY = 0;
    const onDown = (e: PointerEvent) => { downX = e.clientX; downY = e.clientY; };
    const onUp = (e: PointerEvent) => { if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return; const r = renderer.domElement.getBoundingClientRect(); pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1; pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1; raycaster.setFromCamera(pointer, camera); const hit = raycaster.intersectObjects(interactive, false)[0]; if (!hit) return; const cell = cellByObject.get(hit.object.uuid); if (cell) onCellClick(cell); };
    renderer.domElement.addEventListener("pointerdown", onDown); renderer.domElement.addEventListener("pointerup", onUp);
    const resize = () => { const w = Math.max(320, host.clientWidth); const h = Math.max(620, host.clientHeight); camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h, false); };
    const observer = new ResizeObserver(resize); observer.observe(host); resize();
    let frame = 0; const animate = () => { controls.update(); renderer.render(scene, camera); frame = requestAnimationFrame(animate); }; animate();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); renderer.domElement.removeEventListener("pointerdown", onDown); renderer.domElement.removeEventListener("pointerup", onUp); controls.dispose(); cameraRef.current = null; controlsRef.current = null; scene.traverse((o) => { if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) { o.geometry.dispose(); if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose()); else o.material.dispose(); } if (o instanceof THREE.Sprite) { o.material.map?.dispose(); o.material.dispose(); } }); renderer.dispose(); host.innerHTML = ""; };
  }, [racks, cells, stocks, selectedCellId, selectedRackId, onCellClick]);

  const btn = "rounded-xl border border-slate-200 bg-white/95 px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:border-orange-300 hover:bg-orange-50";
  return <div className="relative overflow-hidden rounded-3xl border bg-slate-100 shadow-inner">
    <div className="absolute left-4 top-4 z-20 flex max-w-[calc(100%-2rem)] flex-wrap gap-2 rounded-2xl border bg-white/90 p-2 shadow-lg backdrop-blur">
      <button type="button" className={btn} onClick={() => cameraAction("overview")}>Обзор</button><button type="button" className={btn} onClick={() => cameraAction("front")}>Спереди</button><button type="button" className={btn} onClick={() => cameraAction("left")}>Слева</button><button type="button" className={btn} onClick={() => cameraAction("right")}>Справа</button><button type="button" className={btn} onClick={() => cameraAction("top")}>Сверху</button><button type="button" className={btn} onClick={() => cameraAction("rotateLeft")}>↶ Повернуть</button><button type="button" className={btn} onClick={() => cameraAction("rotateRight")}>Повернуть ↷</button><button type="button" className={btn} onClick={() => cameraAction("zoomIn")}>＋</button><button type="button" className={btn} onClick={() => cameraAction("zoomOut")}>−</button>
    </div>
    <div ref={hostRef} className="h-[76vh] min-h-[680px] w-full" />
    <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border bg-white/90 px-4 py-2 text-xs font-medium text-slate-600 shadow">Выберите ячейку или напольную зону · обзором управляйте кнопками сверху</div>
  </div>;
}
