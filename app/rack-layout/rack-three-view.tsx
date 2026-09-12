"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

type Rack = { id: string; name: string; code: string; rows: number; columns: number };
type Cell = { id: string; rackId: string; code: string; label: string; rowIndex: number; columnIndex: number; blocked: boolean; side: "front" | "back" };
type Stock = { productId: string; cellId: string; quantity: number; productName: string; sku: string; barcode: string; unit: string };

function labelSprite(text: string, accent = false, widthScale = 1) {
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
  const parts = text.split("\n");
  parts.slice(0, 3).forEach((line, index) => ctx.fillText(line, 256, 48 + index * 38, 460));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(2.3 * widthScale, 0.86, 1);
  return sprite;
}

export function RackThreeView({ rack, cells, stocks, side, onCellClick, highlightCellId }: { rack: Rack; cells: Cell[]; stocks: Stock[]; side: "front" | "back"; onCellClick: (cell: Cell) => void; highlightCellId?: string | null }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<{ camera?: THREE.PerspectiveCamera; controls?: OrbitControls; cameraDistance?: number; targetY?: number }>({});

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    host.innerHTML = "";
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf8fafc);
    scene.fog = new THREE.Fog(0xf8fafc, 24, 46);

    const targetWidth = Math.min(18, Math.max(14.5, rack.columns * 2.9));
    const columnW = targetWidth / rack.columns;
    const shelfGap = 1.62;
    const depth = 1.95;
    const width = rack.columns * columnW;
    const height = rack.rows * shelfGap + 0.58;
    const x0 = -width / 2;

    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 120);
    const cameraDistance = Math.max(11.2, height * 1.48);
    const targetY = height * 0.46;
    camera.position.set(0, Math.max(4.6, height * 0.61), side === "front" ? cameraDistance : -cameraDistance);

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
    controls.maxDistance = 34;
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
    for (let c = 0; c <= rack.columns; c += 1) {
      const x = x0 + c * columnW;
      addBox(0.16, height, 0.16, x, height / 2, -depth / 2, steel);
      addBox(0.16, height, 0.16, x, height / 2, depth / 2, steel);
    }
    for (let row = 0; row < rack.rows; row += 1) {
      const y = (row + 1) * shelfGap;
      addBox(width + 0.22, 0.12, depth, 0, y, 0, shelfMat);
    }

    const interactive: THREE.Object3D[] = [];
    const cellByObject = new Map<string, Cell>();
    const labelWidthScale = Math.min(1.65, Math.max(1, columnW / 1.9));
    let highlightedMaterial: THREE.MeshStandardMaterial | null = null;

    for (const cell of cells) {
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
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(columnW - 0.22, shelfGap - 0.24, highlighted ? 0.24 : 0.16), cellMaterial);
      const x = x0 + cell.columnIndex * columnW + columnW / 2;
      const y = cell.rowIndex * shelfGap + shelfGap / 2 + 0.09;
      const z = cell.side === "front" ? depth / 2 + 0.12 : -depth / 2 - 0.12;
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
      const label = labelSprite(occupied ? `${cell.code}\n${first?.productName || "Материал"}\n${total.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} ${first?.unit || ""}` : `${cell.code}\nСвободно`, highlighted || occupied, labelWidthScale);
      label.position.set(x, y, cell.side === "front" ? depth / 2 + 0.25 : -depth / 2 - 0.25);
      if (cell.side === "back") label.material.rotation = Math.PI;
      rackGroup.add(label);
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
          if (Array.isArray(object.material)) object.material.forEach((m) => m.dispose());
          else object.material.dispose();
        }
        if (object instanceof THREE.Sprite) { object.material.map?.dispose(); object.material.dispose(); }
      });
      renderer.dispose();
      host.innerHTML = "";
    };
  }, [rack, cells, stocks, onCellClick, highlightCellId]);

  useEffect(() => {
    const camera = stateRef.current.camera;
    const controls = stateRef.current.controls;
    const cameraDistance = stateRef.current.cameraDistance || 12;
    const targetY = stateRef.current.targetY || rack.rows * 0.75;
    if (!camera || !controls) return;
    camera.position.set(0, Math.max(4.6, rack.rows * 1.03), side === "front" ? cameraDistance : -cameraDistance);
    controls.target.set(0, targetY, 0);
    controls.update();
  }, [side, rack.rows]);

  return <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-slate-50 shadow-inner">
    <div ref={hostRef} className="h-[74vh] min-h-[640px] w-full" />
    {highlightCellId && <div className="pointer-events-none absolute left-4 top-4 rounded-full border border-amber-300 bg-amber-50/95 px-4 py-2 text-xs font-bold text-amber-900 shadow-sm backdrop-blur">Найденная ячейка подсвечена</div>}
    <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-black/10 bg-white/90 px-4 py-2 text-xs font-medium text-slate-600 shadow-sm backdrop-blur">ЛКМ + перетаскивание — вращение · колесо — масштаб · клик по ячейке — открыть</div>
  </div>;
}
