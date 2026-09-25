"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

type Rack = { id: string; name: string; code: string; rows: number; columns: number };
type Cell = { id: string; warehouseCode: string; rackId: string; code: string; label: string; rowIndex: number; columnIndex: number; blocked: boolean };
type Stock = { productId: string; cellId: string; quantity: number; productName: string; unit: string };

type Props = {
  rack: Rack;
  cells: Cell[];
  stocks: Stock[];
  highlightCellId?: string | null;
  onCellClick: (cell: Cell) => void;
};

function labelSprite(text: string, accent = false, widthScale = 1) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 160;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = accent ? "rgba(255,247,237,.97)" : "rgba(255,255,255,.95)";
  ctx.strokeStyle = accent ? "#f97316" : "#cbd5e1";
  ctx.lineWidth = 4;
  ctx.roundRect(8, 8, 496, 144, 24);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#0f172a";
  ctx.font = "700 30px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  text.split("\n").slice(0, 3).forEach((line, index) => ctx.fillText(line, 256, 47 + index * 38, 462));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(2.4 * widthScale, 0.88, 1);
  return sprite;
}

export function DepartmentRackThreeView({ rack, cells, stocks, highlightCellId, onCellClick }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.innerHTML = "";

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf8fafc);
    scene.fog = new THREE.Fog(0xf8fafc, 24, 50);

    const width = Math.min(19, Math.max(14.5, rack.columns * 2.7));
    const depth = 2.15;
    const rowHeight = 1.7;
    const contentHeight = Math.max(2.5, rack.rows * rowHeight);
    const height = contentHeight + 0.58;
    const x0 = -width / 2;

    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 120);
    const distance = Math.max(16.5, width * 0.98, height * 1.85);
    camera.position.set(0, Math.max(5, height * 0.66), distance);

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
    controls.maxDistance = 40;
    controls.maxPolarAngle = Math.PI / 2.02;
    controls.target.set(0, height * 0.46, 0);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x64748b, 2.15));
    const key = new THREE.DirectionalLight(0xffffff, 3.3);
    key.position.set(8, 14, 9);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xffedd5, 1.35);
    rim.position.set(-9, 7, -8);
    scene.add(rim);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.max(30, width + 10), 22),
      new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.94, metalness: 0.02 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.12;
    floor.receiveShadow = true;
    scene.add(floor);

    const rackGroup = new THREE.Group();
    scene.add(rackGroup);
    const steel = new THREE.MeshStandardMaterial({ color: 0x273449, roughness: 0.42, metalness: 0.75 });
    const shelfMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.54, metalness: 0.52 });

    const addBox = (w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material, cast = true) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      mesh.position.set(x, y, z);
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      rackGroup.add(mesh);
      return mesh;
    };

    addBox(width + 0.7, 0.24, depth + 0.34, 0, 0.05, 0, steel);
    addBox(width + 0.7, 0.22, depth + 0.34, 0, height + 0.1, 0, steel);
    for (const x of [x0, x0 + width]) {
      addBox(0.18, height, 0.18, x, height / 2, -depth / 2, steel);
      addBox(0.18, height, 0.18, x, height / 2, depth / 2, steel);
    }
    for (let row = 0; row < rack.rows; row += 1) addBox(width + 0.22, 0.12, depth, 0, (row + 1) * rowHeight, 0, shelfMat);

    const interactive: THREE.Object3D[] = [];
    const cellByObject = new Map<string, Cell>();
    let highlightedMaterial: THREE.MeshStandardMaterial | null = null;

    for (let rowIndex = 0; rowIndex < rack.rows; rowIndex += 1) {
      const rowCells = cells.filter((cell) => cell.rowIndex === rowIndex).sort((a, b) => a.columnIndex - b.columnIndex);
      if (!rowCells.length) continue;
      const cellWidth = width / rowCells.length;

      rowCells.forEach((cell, index) => {
        const x = x0 + cellWidth * index + cellWidth / 2;
        const y = rowIndex * rowHeight + rowHeight / 2 + 0.07;
        const z = depth / 2 + 0.12;
        const cellStocks = stocks.filter((stock) => stock.cellId === cell.id && stock.quantity > 0);
        const occupied = cellStocks.length > 0;
        const highlighted = cell.id === highlightCellId;
        const blocked = Boolean(cell.blocked);
        const material = new THREE.MeshStandardMaterial({
          color: highlighted ? 0xfbbf24 : blocked ? 0xfca5a5 : occupied ? 0x93c5fd : 0xf8fafc,
          transparent: true,
          opacity: highlighted ? 0.92 : occupied || blocked ? 0.74 : 0.28,
          roughness: 0.55,
          metalness: 0.04,
          emissive: highlighted ? 0xf59e0b : occupied ? 0x102a5c : blocked ? 0x7f1d1d : 0x000000,
          emissiveIntensity: highlighted ? 0.72 : occupied || blocked ? 0.16 : 0,
        });
        if (highlighted) highlightedMaterial = material;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.34, cellWidth - 0.18), rowHeight - 0.2, highlighted ? 0.25 : 0.16), material);
        mesh.position.set(x, y, z);
        rackGroup.add(mesh);
        interactive.push(mesh);
        cellByObject.set(mesh.uuid, cell);

        if (highlighted) {
          const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color: 0xf97316 }));
          edges.position.copy(mesh.position);
          rackGroup.add(edges);
        }

        const total = cellStocks.reduce((sum, stock) => sum + Number(stock.quantity), 0);
        const first = cellStocks[0];
        const labelText = blocked ? `${cell.code}\nЗАБЛОКИРОВАНА` : occupied ? `${cell.code}\n${first?.productName || "Материал"}\n${total.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} ${first?.unit || ""}` : `${cell.code}\nСвободно`;
        const label = labelSprite(labelText, highlighted || occupied, Math.max(0.62, Math.min(1.8, cellWidth / 2.35)));
        label.position.set(x, y, depth / 2 + 0.27);
        rackGroup.add(label);

        if (index < rowCells.length - 1) {
          const separatorX = x0 + cellWidth * (index + 1);
          addBox(0.1, rowHeight - 0.08, 0.1, separatorX, rowIndex * rowHeight + rowHeight / 2, depth / 2, steel, false);
        }
      });
    }

    const title = labelSprite(`${rack.code}\n${rack.name}`, true, 1.38);
    title.position.set(0, height + 0.92, 0);
    title.scale.set(4.7, 1.13, 1);
    rackGroup.add(title);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downX = 0;
    let downY = 0;
    const onDown = (event: PointerEvent) => { downX = event.clientX; downY = event.clientY; renderer.domElement.style.cursor = "grabbing"; };
    const onUp = (event: PointerEvent) => {
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
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);

    const resize = () => {
      const widthPx = Math.max(320, host.clientWidth);
      const heightPx = Math.max(610, host.clientHeight);
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
        const pulse = (Math.sin((performance.now() - startedAt) / 270) + 1) / 2;
        highlightedMaterial.emissiveIntensity = 0.42 + pulse * 0.74;
      }
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      controls.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
          object.geometry.dispose();
          if (Array.isArray(object.material)) object.material.forEach((item) => item.dispose());
          else object.material.dispose();
        }
        if (object instanceof THREE.Sprite) { object.material.map?.dispose(); object.material.dispose(); }
      });
      renderer.dispose();
      host.innerHTML = "";
    };
  }, [cells, highlightCellId, onCellClick, rack, stocks]);

  return <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-slate-50 shadow-inner">
    <div ref={hostRef} className="h-[74vh] min-h-[640px] w-full" />
    {highlightCellId && <div className="pointer-events-none absolute left-4 top-4 rounded-full border border-amber-300 bg-amber-50/95 px-4 py-2 text-xs font-bold text-amber-900 shadow-sm backdrop-blur">Найденная ячейка подсвечена</div>}
    <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-black/10 bg-white/90 px-4 py-2 text-xs font-medium text-slate-600 shadow-sm backdrop-blur">ЛКМ + перетаскивание — вращение · колесо — масштаб · клик по ячейке — информация и QR</div>
  </div>;
}
