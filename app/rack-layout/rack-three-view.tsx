"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

type Rack = { id: string; name: string; code: string; rows: number; columns: number };
type Cell = { id: string; rackId: string; code: string; label: string; rowIndex: number; columnIndex: number; blocked: boolean; side: "front" | "back" };
type Stock = { productId: string; cellId: string; quantity: number; productName: string; sku: string; barcode: string; unit: string };

function labelSprite(text: string, accent = false) {
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
  sprite.scale.set(2.3, 0.72, 1);
  return sprite;
}

export function RackThreeView({ rack, cells, stocks, side, onCellClick }: { rack: Rack; cells: Cell[]; stocks: Stock[]; side: "front" | "back"; onCellClick: (cell: Cell) => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<{ camera?: THREE.PerspectiveCamera; controls?: OrbitControls }>({});

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    host.innerHTML = "";
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf8fafc);
    scene.fog = new THREE.Fog(0xf8fafc, 18, 34);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(side === "front" ? 8 : -8, 5.2, side === "front" ? 11 : -11);

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
    controls.minDistance = 7;
    controls.maxDistance = 24;
    controls.maxPolarAngle = Math.PI / 2.02;
    controls.target.set(0, rack.rows * 0.62, 0);

    stateRef.current = { camera, controls };

    scene.add(new THREE.HemisphereLight(0xffffff, 0x64748b, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 3.4);
    key.position.set(7, 12, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xbfd7ff, 1.5);
    rim.position.set(-8, 6, -8);
    scene.add(rim);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(26, 20),
      new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.92, metalness: 0.03 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.12;
    floor.receiveShadow = true;
    scene.add(floor);

    const rackGroup = new THREE.Group();
    scene.add(rackGroup);

    const columnW = 1.55;
    const shelfGap = 1.48;
    const depth = 1.7;
    const width = rack.columns * columnW;
    const height = rack.rows * shelfGap + 0.45;
    const x0 = -width / 2;

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

    addBox(width + 0.6, 0.24, depth + 0.35, 0, 0.05, 0, steel);
    addBox(width + 0.6, 0.22, depth + 0.35, 0, height + 0.1, 0, steel);

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

    for (const cell of cells) {
      const cellStocks = stocks.filter((stock) => stock.cellId === cell.id);
      const occupied = cellStocks.length > 0;
      const cellMaterial = new THREE.MeshStandardMaterial({
        color: occupied ? 0x93c5fd : 0xf8fafc,
        transparent: true,
        opacity: occupied ? 0.72 : 0.28,
        roughness: 0.55,
        metalness: 0.05,
        emissive: occupied ? 0x102a5c : 0x000000,
        emissiveIntensity: occupied ? 0.18 : 0,
      });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(columnW - 0.18, shelfGap - 0.2, 0.16), cellMaterial);
      const x = x0 + cell.columnIndex * columnW + columnW / 2;
      const y = cell.rowIndex * shelfGap + shelfGap / 2 + 0.09;
      const z = cell.side === "front" ? depth / 2 + 0.12 : -depth / 2 - 0.12;
      mesh.position.set(x, y, z);
      mesh.castShadow = false;
      mesh.userData.cellId = cell.id;
      rackGroup.add(mesh);
      interactive.push(mesh);
      cellByObject.set(mesh.uuid, cell);

      const total = cellStocks.reduce((sum, stock) => sum + stock.quantity, 0);
      const first = cellStocks[0];
      const label = labelSprite(
        occupied ? `${cell.code}\n${first?.productName || "Материал"}\n${total.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} ${first?.unit || ""}` : `${cell.code}\nСвободно`,
        occupied,
      );
      label.position.set(x, y, cell.side === "front" ? depth / 2 + 0.25 : -depth / 2 - 0.25);
      if (cell.side === "back") label.material.rotation = Math.PI;
      rackGroup.add(label);
    }

    const title = labelSprite(`${rack.code}\n${rack.name}`, true);
    title.position.set(0, height + 0.8, 0);
    title.scale.set(3.2, 1, 1);
    rackGroup.add(title);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downX = 0;
    let downY = 0;

    const onPointerDown = (event: PointerEvent) => {
      downX = event.clientX;
      downY = event.clientY;
      renderer.domElement.style.cursor = "grabbing";
    };
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
      const heightPx = Math.max(520, host.clientHeight);
      camera.aspect = widthPx / heightPx;
      camera.updateProjectionMatrix();
      renderer.setSize(widthPx, heightPx, false);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    let frame = 0;
    const animate = () => {
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
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          if (Array.isArray(object.material)) object.material.forEach((m) => m.dispose());
          else object.material.dispose();
        }
        if (object instanceof THREE.Sprite) {
          object.material.map?.dispose();
          object.material.dispose();
        }
      });
      renderer.dispose();
      host.innerHTML = "";
    };
  }, [rack, cells, stocks, onCellClick]);

  useEffect(() => {
    const camera = stateRef.current.camera;
    const controls = stateRef.current.controls;
    if (!camera || !controls) return;
    const radius = 13;
    camera.position.set(side === "front" ? 7.5 : -7.5, 5.2, side === "front" ? radius : -radius);
    controls.update();
  }, [side]);

  return <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-slate-50 shadow-inner">
    <div ref={hostRef} className="h-[68vh] min-h-[560px] w-full" />
    <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-black/10 bg-white/90 px-4 py-2 text-xs font-medium text-slate-600 shadow-sm backdrop-blur">ЛКМ + перетаскивание — вращение · колесо — масштаб · клик по ячейке — открыть</div>
  </div>;
}
