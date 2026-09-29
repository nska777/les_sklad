"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Boxes, ChevronLeft, Layers3, Map, PackagePlus, Plus, Search, Trash2, Warehouse, X } from "lucide-react";
import { toast } from "sonner";

type Rack = { id: string; name: string; code: string; storageType: string; width: number; depth: number; posX: number; posZ: number; columns: number };
type Cell = { id: string; rackId: string; code: string; label: string; columnIndex: number };
type Product = { id: string; name: string; unit: string; category?: string; color?: string; sku?: string };
type Stock = { productId: string; cellId: string; quantity: number };
type Snapshot = { racks?: Rack[]; cells?: Cell[]; products?: Product[]; stocks?: Stock[] };
type SectorDraft = { code: string; name: string; pallets: string; width: string; depth: string };

type PalletInfo = Cell & { stocks: Array<Stock & { product?: Product }> };

type Palette = { floor: number; glow: number };
const palettes: Palette[] = [
  { floor: 0x2563eb, glow: 0x60a5fa },
  { floor: 0x16a34a, glow: 0x4ade80 },
  { floor: 0xf97316, glow: 0xfb923c },
  { floor: 0xef4444, glow: 0xf87171 },
  { floor: 0x8b5cf6, glow: 0xa78bfa },
  { floor: 0x0891b2, glow: 0x22d3ee },
];

function autoPos(index: number) {
  const col = index % 3;
  const row = Math.floor(index / 3);
  return { x: -8 + col * 8, z: -5 + row * 7 };
}

function palletMaterialName(pallet: PalletInfo) {
  if (!pallet.stocks.length) return "Свободно";
  const names = pallet.stocks.map((s) => s.product?.name || "Материал");
  return names.length > 1 ? `${names[0]} +${names.length - 1}` : names[0];
}

function makeSprite(title: string, subtitle: string, accent: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 660;
  canvas.height = 170;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgba(8,15,28,.94)";
  ctx.roundRect(6, 6, 648, 158, 22);
  ctx.fill();
  ctx.fillStyle = accent;
  ctx.font = "800 28px system-ui";
  ctx.fillText(title, 28, 58, 600);
  ctx.fillStyle = "white";
  ctx.font = "700 23px system-ui";
  ctx.fillText(subtitle, 28, 108, 600);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(4.3, 1.1, 1);
  return sprite;
}

export default function LdspWarehouseViewV2() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [snapshot, setSnapshot] = useState<Snapshot>({});
  const [activeSectorId, setActiveSectorId] = useState<string | null>(null);
  const [activePalletId, setActivePalletId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"3d" | "plan">("3d");
  const [sectorModal, setSectorModal] = useState(false);
  const [placeModal, setPlaceModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<SectorDraft>({ code: "", name: "", pallets: "4", width: "5.4", depth: "5.2" });
  const [placeProductId, setPlaceProductId] = useState("");
  const [placeQty, setPlaceQty] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/department-warehouse", { cache: "no-store", headers: { "x-warehouse-code": "ldsp" } });
    const body = await response.json() as Snapshot & { error?: string };
    if (!response.ok) throw new Error(body.error || "Не удалось загрузить склад ЛДСП");
    setSnapshot(body);
  }, []);

  useEffect(() => { void load().catch((e) => toast.error(e instanceof Error ? e.message : "Ошибка загрузки")); }, [load]);

  const sectors = useMemo(() => (snapshot.racks || []).filter((rack) => rack.storageType === "ldsp-sector"), [snapshot.racks]);
  const products = snapshot.products || [];
  const stocks = snapshot.stocks || [];
  const cells = snapshot.cells || [];
  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const activeSector = sectors.find((s) => s.id === activeSectorId) || sectors[0] || null;
  const pallets = useMemo<PalletInfo[]>(() => {
    if (!activeSector) return [];
    return cells.filter((c) => c.rackId === activeSector.id).sort((a, b) => a.columnIndex - b.columnIndex).map((cell) => ({
      ...cell,
      stocks: stocks.filter((s) => s.cellId === cell.id && Number(s.quantity) > 0).map((s) => ({ ...s, product: productMap.get(s.productId) })),
    }));
  }, [activeSector, cells, stocks, productMap]);
  const activePallet = pallets.find((p) => p.id === activePalletId) || null;

  useEffect(() => {
    if (!activeSectorId && sectors[0]) setActiveSectorId(sectors[0].id);
  }, [activeSectorId, sectors]);

  const postLayout = async (payload: Record<string, unknown>) => {
    setBusy(true);
    try {
      const response = await fetch("/api/department-ldsp-layout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "Операция не выполнена");
      await load();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Операция не выполнена");
      return false;
    } finally { setBusy(false); }
  };

  const createSector = async (event: FormEvent) => {
    event.preventDefault();
    const pos = autoPos(sectors.length);
    const ok = await postLayout({ action: "createSector", code: draft.code, name: draft.name, pallets: Number(draft.pallets), width: Number(draft.width), depth: Number(draft.depth), posX: pos.x, posZ: pos.z });
    if (ok) {
      toast.success("Сектор создан");
      setDraft({ code: "", name: "", pallets: "4", width: "5.4", depth: "5.2" });
      setSectorModal(false);
    }
  };

  const addPallet = async () => {
    if (!activeSector) return;
    const ok = await postLayout({ action: "addPallet", sectorId: activeSector.id });
    if (ok) toast.success("Паллета добавлена");
  };

  const placeMaterial = async (event: FormEvent) => {
    event.preventDefault();
    if (!activePallet) return;
    setBusy(true);
    try {
      const response = await fetch("/api/department-warehouse-controls", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-warehouse-code": "ldsp" },
        body: JSON.stringify({ action: "placeProduct", productId: placeProductId, cellId: activePallet.id, quantity: Number(placeQty), documentNumber: "РАЗМЕЩЕНИЕ ЛДСП", comment: `Размещено на ${activePallet.code}` }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "Не удалось разместить материал");
      toast.success("Материал размещён на паллете");
      setPlaceModal(false);
      setPlaceProductId("");
      setPlaceQty("");
      await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Не удалось разместить материал"); }
    finally { setBusy(false); }
  };

  const filteredProducts = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => `${p.name} ${p.sku || ""} ${p.category || ""}`.toLowerCase().includes(q));
  }, [products, query]);

  useEffect(() => {
    if (view !== "3d") return;
    const host = hostRef.current;
    if (!host) return;
    host.replaceChildren();

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b111b);
    scene.fog = new THREE.Fog(0x0b111b, 34, 70);
    const camera = new THREE.PerspectiveCamera(44, 1, .1, 140);
    camera.position.set(0, 25, 21);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 0.8, 0);
    controls.minDistance = 10;
    controls.maxDistance = 55;
    controls.maxPolarAngle = Math.PI / 2.06;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 2.4));
    const light = new THREE.DirectionalLight(0xffffff, 3.2);
    light.position.set(10, 20, 8);
    light.castShadow = true;
    scene.add(light);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(34, 28), new THREE.MeshStandardMaterial({ color: 0x69717c, roughness: .92 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const wallMat = new THREE.MeshStandardMaterial({ color: 0xcfd4dc, roughness: .82 });
    const back = new THREE.Mesh(new THREE.BoxGeometry(34, 8, .22), wallMat); back.position.set(0, 4, -14); scene.add(back);
    const left = new THREE.Mesh(new THREE.BoxGeometry(.22, 8, 28), wallMat); left.position.set(-17, 4, 0); scene.add(left);
    const right = left.clone(); right.position.x = 17; scene.add(right);

    const clickables: THREE.Object3D[] = [];
    const clickMap = new Map<string, { sectorId: string; palletId?: string }>();

    sectors.forEach((sector, index) => {
      const palette = palettes[index % palettes.length];
      const pos = Math.abs(Number(sector.posX || 0)) > .01 || Math.abs(Number(sector.posZ || 0)) > .01 ? { x: Number(sector.posX), z: Number(sector.posZ) } : autoPos(index);
      const sectorCells = cells.filter((c) => c.rackId === sector.id).sort((a, b) => a.columnIndex - b.columnIndex);
      const cols = Math.max(1, Math.ceil(Math.sqrt(sectorCells.length || 1)));
      const rows = Math.max(1, Math.ceil(sectorCells.length / cols));
      const zone = new THREE.Mesh(new THREE.BoxGeometry(sector.width, .05, sector.depth), new THREE.MeshStandardMaterial({ color: palette.floor, transparent: true, opacity: sector.id === activeSector?.id ? .42 : .18, emissive: sector.id === activeSector?.id ? palette.glow : 0x000000, emissiveIntensity: .16 }));
      zone.position.set(pos.x, .035, pos.z);
      scene.add(zone);
      clickables.push(zone); clickMap.set(zone.uuid, { sectorId: sector.id });

      const stepX = sector.width / (cols + .25);
      const stepZ = sector.depth / (rows + .25);
      sectorCells.forEach((cell, cellIndex) => {
        const col = cellIndex % cols, row = Math.floor(cellIndex / cols);
        const x = pos.x + (col - (cols - 1) / 2) * stepX;
        const z = pos.z + (row - (rows - 1) / 2) * stepZ;
        const cellStocks = stocks.filter((s) => s.cellId === cell.id && Number(s.quantity) > 0);
        const pallet = new THREE.Mesh(new THREE.BoxGeometry(Math.min(2.2, stepX * .72), .15, Math.min(1.55, stepZ * .66)), new THREE.MeshStandardMaterial({ color: 0x8b6a45, roughness: .9 }));
        pallet.position.set(x, .1, z); scene.add(pallet);
        clickables.push(pallet); clickMap.set(pallet.uuid, { sectorId: sector.id, palletId: cell.id });
        const layers = Math.min(11, Math.max(2, Math.round(cellStocks.reduce((sum, s) => sum + Number(s.quantity || 0), 0) / 5)));
        for (let layerIndex = 0; layerIndex < layers; layerIndex += 1) {
          const sheet = new THREE.Mesh(new THREE.BoxGeometry(Math.min(2.05, stepX * .68), .055, Math.min(1.42, stepZ * .61)), new THREE.MeshStandardMaterial({ color: cellStocks.length ? 0xd8c3a4 : 0x9ca3af, roughness: .76 }));
          sheet.position.set(x, .21 + layerIndex * .058, z); scene.add(sheet);
        }
        const label = makeSprite(cell.code, cellStocks.length ? (cellStocks.map((s) => productMap.get(s.productId)?.name || "Материал").slice(0, 2).join(" / ")) : "Свободная паллета", `#${palette.floor.toString(16).padStart(6, "0")}`);
        label.position.set(x, 1.45, z); scene.add(label);
      });

      const sectorLabel = makeSprite(`${sector.code} · ${sector.name}`, `${sectorCells.length} паллет`, `#${palette.glow.toString(16).padStart(6, "0")}`);
      sectorLabel.position.set(pos.x, 3.1, pos.z - sector.depth / 2 + .15); scene.add(sectorLabel);
    });

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const onClick = (event: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(clickables, false)[0];
      const data = hit ? clickMap.get(hit.object.uuid) : undefined;
      if (!data) return;
      setActiveSectorId(data.sectorId);
      if (data.palletId) setActivePalletId(data.palletId);
    };
    renderer.domElement.addEventListener("click", onClick);

    const resize = () => {
      const width = Math.max(360, host.clientWidth), height = Math.max(600, host.clientHeight);
      camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height, false);
    };
    const observer = new ResizeObserver(resize); observer.observe(host); resize();
    let frame = 0;
    const animate = () => { controls.update(); renderer.render(scene, camera); frame = requestAnimationFrame(animate); };
    animate();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); renderer.domElement.removeEventListener("click", onClick); controls.dispose(); renderer.dispose(); host.replaceChildren(); };
  }, [view, sectors, cells, stocks, productMap, activeSector?.id]);

  return <main className="min-h-screen bg-[#08111d] text-white">
    <header className="border-b border-white/10 bg-[#0c1624]/95 px-5 py-4">
      <div className="mx-auto flex max-w-[1900px] flex-wrap items-center gap-3">
        <Link href="/department/ldsp" className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 px-3 text-sm text-slate-300 hover:bg-white/5"><ChevronLeft size={16}/> Назад</Link>
        <div className="mr-auto"><div className="text-xs font-black uppercase tracking-[.16em] text-emerald-400">Русский Лес · WMS</div><h1 className="text-2xl font-black">Склад ЛДСП</h1></div>
        <div className="flex rounded-xl bg-white/5 p-1"><button onClick={() => setView("3d")} className={`rounded-lg px-4 py-2 text-sm font-bold ${view === "3d" ? "bg-white text-slate-950" : "text-slate-300"}`}>3D вид</button><button onClick={() => setView("plan")} className={`rounded-lg px-4 py-2 text-sm font-bold ${view === "plan" ? "bg-white text-slate-950" : "text-slate-300"}`}>Вид сверху</button></div>
        <div className="relative w-full max-w-sm"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Материал, декор, артикул..." className="h-10 w-full rounded-xl border border-white/10 bg-white/5 pl-9 pr-3 text-sm outline-none"/></div>
        <button onClick={() => setSectorModal(true)} className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-500 px-4 text-sm font-black text-slate-950 hover:bg-emerald-400"><Plus size={17}/> Сектор</button>
      </div>
    </header>

    <div className="mx-auto grid max-w-[1900px] gap-4 p-4 xl:grid-cols-[1fr_380px]">
      <section className="overflow-hidden rounded-[26px] border border-white/10 bg-[#0d1726] shadow-2xl">
        {!sectors.length ? <div className="grid min-h-[720px] place-items-center p-8 text-center"><div><Warehouse className="mx-auto mb-4 text-emerald-400" size={52}/><h2 className="text-2xl font-black">Склад пока пуст</h2><p className="mt-2 max-w-lg text-slate-400">Создай первый сектор и укажи количество паллет. После этого материалы можно будет размещать прямо на паллеты.</p><button onClick={() => setSectorModal(true)} className="mt-6 rounded-xl bg-emerald-500 px-5 py-3 font-black text-slate-950">Создать первый сектор</button></div></div> : view === "3d" ? <div ref={hostRef} className="h-[78vh] min-h-[720px] w-full"/> : <PlanView sectors={sectors} cells={cells} stocks={stocks} products={products} activeSectorId={activeSector?.id || null} onSector={setActiveSectorId} onPallet={(id) => { setActivePalletId(id); const cell = cells.find((c) => c.id === id); if (cell) setActiveSectorId(cell.rackId); }}/>} 
      </section>

      <aside className="space-y-4">
        <div className="rounded-[24px] border border-white/10 bg-[#0d1726] p-5"><div className="mb-3 flex items-center gap-2 text-sm font-black"><Map size={17}/> Карта склада</div><MiniPlan sectors={sectors} activeSectorId={activeSector?.id || null} onPick={setActiveSectorId}/></div>
        <div className="rounded-[24px] border border-white/10 bg-[#0d1726] p-5">
          <div className="flex items-start justify-between gap-3"><div><div className="text-xs font-bold uppercase tracking-[.15em] text-slate-500">Сектор</div><h2 className="mt-1 text-xl font-black">{activeSector ? `${activeSector.code} · ${activeSector.name}` : "Не выбран"}</h2></div>{activeSector && <button disabled={busy} onClick={addPallet} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-3 py-2 text-xs font-bold hover:bg-white/5"><Plus size={14}/> Паллета</button>}</div>
          <div className="mt-4 grid grid-cols-2 gap-3"><Stat label="Паллет" value={String(pallets.length)} icon={<Boxes size={16}/>}/><Stat label="Материалов" value={String(new Set(pallets.flatMap((p) => p.stocks.map((s) => s.productId))).size)} icon={<Layers3 size={16}/>}/></div>
          {activeSector && <div className="mt-4 max-h-[340px] space-y-2 overflow-auto pr-1">{pallets.map((p) => <button key={p.id} onClick={() => setActivePalletId(p.id)} className={`w-full rounded-xl border p-3 text-left transition ${activePalletId === p.id ? "border-emerald-400 bg-emerald-400/10" : "border-white/10 bg-white/[.03] hover:bg-white/[.06]"}`}><div className="flex items-center justify-between gap-2"><b>{p.code}</b><span className="text-xs text-slate-500">{p.stocks.length ? `${p.stocks.reduce((sum, s) => sum + Number(s.quantity || 0), 0).toLocaleString("ru-RU")}` : "пусто"}</span></div><div className="mt-1 truncate text-sm text-slate-400">{palletMaterialName(p)}</div></button>)}</div>}
        </div>
        <div className="rounded-[24px] border border-white/10 bg-[#0d1726] p-5">
          <div className="text-xs font-bold uppercase tracking-[.15em] text-slate-500">Выбранная паллета</div>
          {activePallet ? <><h3 className="mt-1 text-xl font-black">{activePallet.code}</h3><div className="mt-3 space-y-2">{activePallet.stocks.length ? activePallet.stocks.map((s) => <div key={`${s.productId}-${s.cellId}`} className="rounded-xl bg-white/[.04] p-3"><div className="font-bold">{s.product?.name || "Материал"}</div><div className="mt-1 text-sm text-slate-400">{Number(s.quantity).toLocaleString("ru-RU")} {s.product?.unit || ""}</div></div>) : <div className="rounded-xl border border-dashed border-white/10 p-4 text-sm text-slate-500">Паллета свободна</div>}</div><button onClick={() => setPlaceModal(true)} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-500 px-4 py-3 font-black hover:bg-blue-400"><PackagePlus size={17}/> Разместить материал</button></> : <div className="mt-3 text-sm text-slate-500">Нажми на паллету в 3D или на карте.</div>}
        </div>
        {query && <div className="rounded-[24px] border border-white/10 bg-[#0d1726] p-5"><div className="text-sm font-black">Поиск · {filteredProducts.length}</div><div className="mt-3 max-h-52 space-y-2 overflow-auto">{filteredProducts.slice(0, 20).map((p) => <div key={p.id} className="rounded-lg bg-white/[.04] px-3 py-2 text-sm"><b>{p.name}</b><div className="text-xs text-slate-500">{p.sku} · {p.unit}</div></div>)}</div></div>}
      </aside>
    </div>

    {sectorModal && <Modal onClose={() => setSectorModal(false)} title="Новый сектор"><form onSubmit={createSector} className="space-y-4"><Field label="Код сектора"><input required value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} placeholder="Например A1" className="input"/></Field><Field label="Название"><input required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Основной ЛДСП" className="input"/></Field><div className="grid grid-cols-3 gap-3"><Field label="Паллет"><input type="number" min="1" max="50" value={draft.pallets} onChange={(e) => setDraft({ ...draft, pallets: e.target.value })} className="input"/></Field><Field label="Ширина"><input type="number" step="0.1" value={draft.width} onChange={(e) => setDraft({ ...draft, width: e.target.value })} className="input"/></Field><Field label="Глубина"><input type="number" step="0.1" value={draft.depth} onChange={(e) => setDraft({ ...draft, depth: e.target.value })} className="input"/></Field></div><button disabled={busy} className="w-full rounded-xl bg-emerald-500 py-3 font-black text-slate-950">Создать сектор</button></form></Modal>}

    {placeModal && activePallet && <Modal onClose={() => setPlaceModal(false)} title={`Разместить на ${activePallet.code}`}><form onSubmit={placeMaterial} className="space-y-4"><Field label="Материал"><select required value={placeProductId} onChange={(e) => setPlaceProductId(e.target.value)} className="input"><option value="">Выберите материал</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.sku}</option>)}</select></Field><Field label="Количество"><input required type="number" min="0.000001" step="any" value={placeQty} onChange={(e) => setPlaceQty(e.target.value)} className="input"/></Field><button disabled={busy} className="w-full rounded-xl bg-blue-500 py-3 font-black">Разместить</button></form></Modal>}

    <style jsx global>{`.input{height:44px;width:100%;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:#111c2b;padding:0 12px;color:white;outline:none}.input:focus{border-color:#34d399}`}</style>
  </main>;
}

function Stat({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) { return <div className="rounded-xl border border-white/10 bg-white/[.03] p-3"><div className="flex items-center gap-2 text-xs text-slate-500">{icon}{label}</div><div className="mt-1 text-xl font-black">{value}</div></div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">{label}</div>{children}</label>; }
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) { return <div className="fixed inset-0 z-[100] grid place-items-center bg-black/70 p-4 backdrop-blur-sm"><div className="w-full max-w-lg rounded-[24px] border border-white/10 bg-[#0d1726] p-5 shadow-2xl"><div className="mb-5 flex items-center justify-between"><h3 className="text-xl font-black">{title}</h3><button onClick={onClose} className="rounded-lg p-2 hover:bg-white/5"><X size={18}/></button></div>{children}</div></div>; }

function MiniPlan({ sectors, activeSectorId, onPick }: { sectors: Rack[]; activeSectorId: string | null; onPick: (id: string) => void }) {
  return <div className="grid grid-cols-3 gap-2">{sectors.map((s, i) => <button key={s.id} onClick={() => onPick(s.id)} className={`aspect-[1.2] rounded-xl border p-2 text-left transition ${activeSectorId === s.id ? "border-white bg-white/15" : "border-white/10 bg-white/[.04] hover:bg-white/[.08]"}`}><div className="text-lg font-black" style={{ color: `#${palettes[i % palettes.length].glow.toString(16).padStart(6, "0")}` }}>{s.code}</div><div className="mt-1 truncate text-[11px] text-slate-400">{s.name}</div></button>)}</div>;
}

function PlanView({ sectors, cells, stocks, products, activeSectorId, onSector, onPallet }: { sectors: Rack[]; cells: Cell[]; stocks: Stock[]; products: Product[]; activeSectorId: string | null; onSector: (id: string) => void; onPallet: (id: string) => void }) {
  const map = new Map(products.map((p) => [p.id, p]));
  return <div className="min-h-[720px] p-5"><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{sectors.map((sector, index) => { const sectorCells = cells.filter((c) => c.rackId === sector.id).sort((a,b) => a.columnIndex-b.columnIndex); return <div key={sector.id} onClick={() => onSector(sector.id)} className={`rounded-[22px] border p-4 ${activeSectorId === sector.id ? "border-white/50 bg-white/[.08]" : "border-white/10 bg-white/[.03]"}`}><div className="mb-3 flex items-center justify-between"><div><div className="text-xl font-black" style={{ color: `#${palettes[index % palettes.length].glow.toString(16).padStart(6, "0")}` }}>{sector.code}</div><div className="text-sm font-bold">{sector.name}</div></div><div className="text-xs text-slate-500">{sectorCells.length} паллет</div></div><div className="grid grid-cols-2 gap-2">{sectorCells.map((cell) => { const ss = stocks.filter((s) => s.cellId === cell.id && Number(s.quantity)>0); const names = ss.map((s) => map.get(s.productId)?.name || "Материал"); return <button key={cell.id} onClick={(e) => { e.stopPropagation(); onPallet(cell.id); }} className="min-h-24 rounded-xl border border-white/10 bg-[#111c2b] p-2 text-left hover:border-emerald-400/60"><b className="text-xs">{cell.code}</b><div className="mt-2 text-xs text-slate-400">{names.length ? names.slice(0,2).join(" / ") : "Свободно"}</div>{ss.length > 0 && <div className="mt-1 text-[11px] text-emerald-400">{ss.reduce((sum,s) => sum+Number(s.quantity||0),0).toLocaleString("ru-RU")} ед.</div>}</button>; })}</div></div>; })}</div></div>;
}
