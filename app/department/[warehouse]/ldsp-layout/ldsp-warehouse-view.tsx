"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Boxes, ChevronLeft, Layers3, PackageOpen, RotateCcw, Search, Warehouse } from "lucide-react";

type Product = { id: string; name: string; unit: string; category?: string; color?: string; sku?: string };
type Stock = { productId: string; cellId: string; quantity: number };
type Snapshot = { products?: Product[]; stocks?: Stock[] };

type Sector = {
  id: string;
  title: string;
  subtitle: string;
  x: number;
  z: number;
  w: number;
  d: number;
  color: number;
  pallets: number;
  kind: "main" | "chipboard" | "incoming" | "waste" | "vertical" | "reserve";
};

const sectors: Sector[] = [
  { id: "A1", title: "Основной ЛДСП", subtitle: "Полные листы", x: -7.2, z: 4.9, w: 5.4, d: 5.6, color: 0x2563eb, pallets: 6, kind: "main" },
  { id: "A2", title: "Основной ЛДСП", subtitle: "Полные листы", x: -7.2, z: -2.1, w: 5.4, d: 5.6, color: 0x3b82f6, pallets: 6, kind: "main" },
  { id: "B1", title: "ДСП / Черновой", subtitle: "Полные листы", x: -1.1, z: 4.9, w: 4.6, d: 5.6, color: 0x16a34a, pallets: 5, kind: "chipboard" },
  { id: "B2", title: "ДСП / Черновой", subtitle: "Полные листы", x: -1.1, z: -2.1, w: 4.6, d: 5.6, color: 0x22c55e, pallets: 5, kind: "chipboard" },
  { id: "C1", title: "Разные декоры", subtitle: "ЛДСП / ДСП", x: 4.0, z: 4.9, w: 3.8, d: 5.6, color: 0xf97316, pallets: 4, kind: "incoming" },
  { id: "C2", title: "Новые поступления", subtitle: "Приход / ожидание", x: 4.0, z: -2.1, w: 3.8, d: 5.6, color: 0xfb923c, pallets: 4, kind: "incoming" },
  { id: "D", title: "Деловые отходы", subtitle: "Обрезки и полезные остатки", x: 8.7, z: -2.1, w: 4.2, d: 5.6, color: 0xef4444, pallets: 5, kind: "waste" },
  { id: "D1", title: "Деловые отходы", subtitle: "Крупные остатки", x: 8.7, z: 4.1, w: 4.2, d: 2.6, color: 0x8b5cf6, pallets: 3, kind: "waste" },
  { id: "D2", title: "Деловые отходы", subtitle: "Средние / мелкие остатки", x: 8.7, z: 7.3, w: 4.2, d: 2.6, color: 0xa78bfa, pallets: 3, kind: "waste" },
  { id: "E", title: "Вертикальное хранение", subtitle: "Единичные листы", x: 8.7, z: -8.1, w: 4.2, d: 4.3, color: 0x14b8a6, pallets: 4, kind: "vertical" },
  { id: "F", title: "Резерв / Отбор", subtitle: "Под производство", x: 3.2, z: -8.1, w: 6.4, d: 4.3, color: 0x06b6d4, pallets: 5, kind: "reserve" },
];

function makeLabel(text: string, color: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 180;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgba(15,23,42,.92)";
  ctx.roundRect(8, 8, 624, 164, 24);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.font = "800 32px system-ui";
  ctx.fillText(text.split("|")[0] || "", 34, 60);
  ctx.fillStyle = "white";
  ctx.font = "700 25px system-ui";
  ctx.fillText(text.split("|")[1] || "", 34, 104);
  ctx.fillStyle = "#cbd5e1";
  ctx.font = "500 20px system-ui";
  ctx.fillText(text.split("|")[2] || "", 34, 140);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(4.2, 1.18, 1);
  return sprite;
}

function addPallet(group: THREE.Group, x: number, z: number, width: number, depth: number, height: number, tint: number) {
  const wood = new THREE.MeshStandardMaterial({ color: 0x8b6a45, roughness: .88 });
  const sheet = new THREE.MeshStandardMaterial({ color: tint, roughness: .72 });
  const pallet = new THREE.Mesh(new THREE.BoxGeometry(width, .16, depth), wood);
  pallet.position.set(x, .09, z);
  group.add(pallet);
  const count = Math.max(4, Math.min(10, Math.round(height / .08)));
  for (let i = 0; i < count; i += 1) {
    const layer = new THREE.Mesh(new THREE.BoxGeometry(width * .96, .055, depth * .94), sheet);
    layer.position.set(x, .2 + i * .06, z);
    group.add(layer);
  }
}

export default function LdspWarehouseView() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [activeSector, setActiveSector] = useState<Sector>(sectors[0]);
  const [snapshot, setSnapshot] = useState<Snapshot>({});
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"3d" | "plan">("3d");

  useEffect(() => {
    void fetch("/api/department-warehouse", { cache: "no-store" })
      .then((r) => r.json())
      .then((body) => setSnapshot(body))
      .catch(() => setSnapshot({}));
  }, []);

  const totalQty = useMemo(() => (snapshot.stocks || []).reduce((sum, s) => sum + Number(s.quantity || 0), 0), [snapshot]);
  const materialsCount = snapshot.products?.length || 0;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return snapshot.products || [];
    return (snapshot.products || []).filter((p) => `${p.name} ${p.sku || ""} ${p.category || ""}`.toLowerCase().includes(q));
  }, [snapshot.products, query]);

  useEffect(() => {
    if (view !== "3d") return;
    const host = hostRef.current;
    if (!host) return;
    host.replaceChildren();

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111827);
    scene.fog = new THREE.Fog(0x111827, 28, 58);

    const camera = new THREE.PerspectiveCamera(48, 1, .1, 120);
    camera.position.set(18, 17, 24);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 1.2, 0);
    controls.maxPolarAngle = Math.PI / 2.03;
    controls.minDistance = 11;
    controls.maxDistance = 46;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x475569, 2.1));
    const key = new THREE.DirectionalLight(0xffffff, 3.4);
    key.position.set(8, 18, 10);
    key.castShadow = true;
    scene.add(key);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(31, 26), new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: .9 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const wallMat = new THREE.MeshStandardMaterial({ color: 0xe5e7eb, roughness: .8 });
    const back = new THREE.Mesh(new THREE.BoxGeometry(31, 9, .28), wallMat);
    back.position.set(0, 4.5, -12.9);
    scene.add(back);
    const left = new THREE.Mesh(new THREE.BoxGeometry(.28, 9, 26), wallMat);
    left.position.set(-15.4, 4.5, 0);
    scene.add(left);
    const right = left.clone();
    right.position.x = 15.4;
    scene.add(right);

    const beamMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: .55, metalness: .6 });
    for (let z = -11; z <= 11; z += 4) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(30.5, .13, .13), beamMat);
      beam.position.set(0, 8.4, z);
      scene.add(beam);
    }

    const sectorMeshes: THREE.Object3D[] = [];
    const byUuid = new Map<string, Sector>();
    const palletGroup = new THREE.Group();
    scene.add(palletGroup);

    sectors.forEach((sector) => {
      const selected = sector.id === activeSector.id;
      const zone = new THREE.Mesh(
        new THREE.BoxGeometry(sector.w, .06, sector.d),
        new THREE.MeshStandardMaterial({ color: sector.color, transparent: true, opacity: selected ? .45 : .16, emissive: selected ? sector.color : 0x000000, emissiveIntensity: selected ? .22 : 0 })
      );
      zone.position.set(sector.x, .04, sector.z);
      scene.add(zone);
      sectorMeshes.push(zone);
      byUuid.set(zone.uuid, sector);

      const cols = Math.max(1, Math.ceil(Math.sqrt(sector.pallets)));
      const rows = Math.max(1, Math.ceil(sector.pallets / cols));
      const stepX = sector.w / (cols + .35);
      const stepZ = sector.d / (rows + .35);
      for (let i = 0; i < sector.pallets; i += 1) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const px = sector.x + (col - (cols - 1) / 2) * stepX;
        const pz = sector.z + (row - (rows - 1) / 2) * stepZ;
        const waste = sector.kind === "waste";
        addPallet(palletGroup, px, pz, Math.min(1.8, stepX * .72), Math.min(1.22, stepZ * .66), waste ? .36 : .72, waste ? 0xcaa47b : 0xd6c2a2);
      }

      if (sector.kind === "vertical") {
        const mat = new THREE.MeshStandardMaterial({ color: 0xd8c29e, roughness: .75 });
        for (let i = 0; i < 7; i += 1) {
          const panel = new THREE.Mesh(new THREE.BoxGeometry(.06, 2.8, 1.35), mat);
          panel.position.set(sector.x - 1.5 + i * .45, 1.42, sector.z + .8);
          panel.rotation.z = -0.08;
          scene.add(panel);
        }
      }

      const color = `#${sector.color.toString(16).padStart(6, "0")}`;
      const label = makeLabel(`${sector.id}|${sector.title}|${sector.subtitle}`, color);
      label.position.set(sector.x, 2.6, sector.z);
      scene.add(label);
    });

    const aisleMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: .75 });
    for (let z = -10; z <= 9; z += 3.4) {
      const arrow = new THREE.Mesh(new THREE.BoxGeometry(.18, .025, 1.45), aisleMat);
      arrow.position.set(1.25, .075, z);
      scene.add(arrow);
    }

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const onClick = (event: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(sectorMeshes, false)[0];
      const sector = hit ? byUuid.get(hit.object.uuid) : undefined;
      if (sector) setActiveSector(sector);
    };
    renderer.domElement.addEventListener("click", onClick);

    const resize = () => {
      const width = Math.max(360, host.clientWidth);
      const height = Math.max(560, host.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
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
      renderer.domElement.removeEventListener("click", onClick);
      controls.dispose();
      renderer.dispose();
      host.replaceChildren();
    };
  }, [activeSector.id, view]);

  return <main className="min-h-screen bg-[#0b111b] text-white">
    <div className="border-b border-white/10 bg-[#101722]/95 px-5 py-4 backdrop-blur">
      <div className="mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link href="/department/ldsp" className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-slate-300 hover:bg-white/10"><ChevronLeft size={16}/> Назад</Link>
          <div><div className="text-xs font-bold uppercase tracking-[.18em] text-emerald-400">Русский Лес · WMS</div><h1 className="text-2xl font-black">Склад ЛДСП</h1></div>
        </div>
        <div className="flex items-center gap-2 rounded-xl bg-white/5 p-1">
          <button onClick={() => setView("3d")} className={`rounded-lg px-4 py-2 text-sm font-bold ${view === "3d" ? "bg-white text-slate-950" : "text-slate-300"}`}>3D вид</button>
          <button onClick={() => setView("plan")} className={`rounded-lg px-4 py-2 text-sm font-bold ${view === "plan" ? "bg-white text-slate-950" : "text-slate-300"}`}>Карта</button>
        </div>
        <div className="relative w-full max-w-md"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={17}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск материала, декора, артикула..." className="h-11 w-full rounded-xl border border-white/10 bg-white/5 pl-10 pr-3 text-sm outline-none placeholder:text-slate-500 focus:border-emerald-400"/></div>
      </div>
    </div>

    <div className="mx-auto grid max-w-[1800px] gap-4 p-4 xl:grid-cols-[1fr_360px]">
      <section className="overflow-hidden rounded-[28px] border border-white/10 bg-[#111827] shadow-2xl">
        {view === "3d" ? <div ref={hostRef} className="h-[76vh] min-h-[650px] w-full"/> : <div className="grid min-h-[650px] place-items-center p-8"><WarehousePlan active={activeSector.id} onPick={setActiveSector}/></div>}
      </section>

      <aside className="space-y-4">
        <div className="rounded-[24px] border border-white/10 bg-[#111827] p-5">
          <div className="mb-4 flex items-center gap-2 text-sm font-bold text-slate-300"><Layers3 size={17}/> План склада</div>
          <WarehousePlan compact active={activeSector.id} onPick={setActiveSector}/>
        </div>

        <div className="rounded-[24px] border border-white/10 bg-[#111827] p-5">
          <div className="flex items-start justify-between gap-3"><div><div className="text-xs font-black uppercase tracking-[.14em] text-slate-500">Выбранный сектор</div><h2 className="mt-1 text-2xl font-black">{activeSector.id} · {activeSector.title}</h2><p className="mt-1 text-sm text-slate-400">{activeSector.subtitle}</p></div><span className="h-4 w-4 rounded-full" style={{ backgroundColor: `#${activeSector.color.toString(16).padStart(6, "0")}` }}/></div>
          <div className="mt-5 grid grid-cols-2 gap-3"><Stat icon={<Boxes size={17}/>} label="Паллет" value={String(activeSector.pallets)}/><Stat icon={<PackageOpen size={17}/>} label="Тип" value={activeSector.kind === "waste" ? "Отходы" : "Листы"}/></div>
          {activeSector.kind === "waste" && <div className="mt-4 rounded-2xl border border-red-400/20 bg-red-500/10 p-4 text-sm text-red-100"><b>Деловые отходы</b><div className="mt-1 text-red-200/70">Полезные остатки ЛДСП/ДСП. В общем учёте материал остаётся обычной номенклатурой, но получает отдельную пометку «деловой отход».</div></div>}
        </div>

        <div className="rounded-[24px] border border-white/10 bg-[#111827] p-5">
          <div className="mb-3 text-xs font-black uppercase tracking-[.14em] text-slate-500">Данные склада</div>
          <div className="grid grid-cols-2 gap-3"><Stat icon={<Warehouse size={17}/>} label="Материалов" value={String(materialsCount)}/><Stat icon={<RotateCcw size={17}/>} label="Общий остаток" value={totalQty.toLocaleString("ru-RU")}/></div>
          {query && <div className="mt-4 rounded-xl bg-white/5 p-3 text-sm text-slate-300">Найдено: <b>{filtered.length}</b></div>}
        </div>
      </aside>
    </div>
  </main>;
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="rounded-2xl border border-white/10 bg-white/[.035] p-3"><div className="flex items-center gap-2 text-slate-400">{icon}<span className="text-xs">{label}</span></div><div className="mt-2 text-xl font-black">{value}</div></div>;
}

function WarehousePlan({ active, onPick, compact = false }: { active: string; onPick: (s: Sector) => void; compact?: boolean }) {
  return <div className={`relative mx-auto aspect-[4/5] w-full overflow-hidden rounded-2xl border border-white/10 bg-[#0b111b] ${compact ? "max-w-[300px]" : "max-w-[760px]"}`}>
    <div className="absolute inset-x-[46%] bottom-0 top-0 border-x border-dashed border-yellow-300/30"/>
    {sectors.map((s) => {
      const left = ((s.x + 15.5 - s.w / 2) / 31) * 100;
      const top = ((s.z + 13 - s.d / 2) / 26) * 100;
      const width = (s.w / 31) * 100;
      const height = (s.d / 26) * 100;
      const selected = s.id === active;
      return <button key={s.id} onClick={() => onPick(s)} className={`absolute grid place-items-center rounded-md border text-[10px] font-black transition sm:text-xs ${selected ? "scale-[1.03] border-white shadow-lg" : "border-white/20 opacity-80 hover:opacity-100"}`} style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%`, backgroundColor: `#${s.color.toString(16).padStart(6, "0")}88` }} title={`${s.id} ${s.title}`}>{s.id}</button>;
    })}
    <div className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full border border-white/10 bg-black/50 px-3 py-1 text-[10px] font-bold text-slate-300">ВХОД ↑</div>
  </div>;
}
