"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { ArrowRightLeft, History, PackagePlus, SlidersHorizontal, X } from "lucide-react";
import { toast } from "sonner";
import { ProductBarcode } from "@/components/product-barcode";
import { ZoomableQr } from "@/components/zoomable-qr";

type Rack = { id: string; name: string; code: string; rows: number; columns: number; storageType: string; width: number; depth: number; posX?: number; posZ?: number; rotation?: number };
type Cell = { id: string; rackId: string; code: string; label: string; rowIndex: number; columnIndex: number; blocked: boolean; cellWidth?: number; cellHeight?: number; cellDepth?: number };
type Stock = { productId: string; cellId: string; quantity: number; productName: string; unit: string; color?: string; packType?: string; packSize?: number };
type Product = { id: string; name: string; sku: string; barcode: string; oneCId?: string | null; unit: string; color?: string; packType?: string; packSize?: number; category?: string };
type Movement = { id: string; type: string; productId: string; productName: string; quantity: number; fromCellId?: string | null; toCellId?: string | null; operator?: string; createdAt: string; comment?: string };
type Snapshot = { warehouse?: { code: string; name: string }; cells: Cell[]; products: Product[]; stocks: Array<{ productId: string; cellId: string; quantity: number }>; movements: Movement[] };
type Mode = "contents" | "add" | "move" | "adjust" | "history";

type CameraState = { position: [number, number, number]; target: [number, number, number] };

function autoPosition(rack: Rack, index: number, floor: boolean) {
  if (Math.abs(Number(rack.posX || 0)) > .01 || Math.abs(Number(rack.posZ || 0)) > .01) return { x: Number(rack.posX || 0), z: Number(rack.posZ || 0) };
  if (floor) return { x: -7 + (index % 4) * 4.5, z: 6 + Math.floor(index / 4) * 4 };
  return { x: -7 + (index % 3) * 7, z: -4 + Math.floor(index / 3) * 6 };
}

function packageMesh(stock: Stock, scale = 1) {
  const color = stock.color?.toLowerCase().includes("бел") ? 0xf8fafc : 0xd97706;
  const mat = new THREE.MeshStandardMaterial({ color, roughness: .55 });
  const type = (stock.packType || "ведро").toLowerCase();
  if (type.includes("канистр")) return new THREE.Mesh(new THREE.BoxGeometry(.34 * scale, .42 * scale, .26 * scale), mat);
  if (type.includes("бутыл")) return new THREE.Mesh(new THREE.CylinderGeometry(.11 * scale, .14 * scale, .42 * scale, 16), mat);
  if (type.includes("бан")) return new THREE.Mesh(new THREE.CylinderGeometry(.15 * scale, .16 * scale, .26 * scale, 18), mat);
  if (type.includes("боч")) return new THREE.Mesh(new THREE.CylinderGeometry(.24 * scale, .24 * scale, .5 * scale, 20), mat);
  return new THREE.Mesh(new THREE.CylinderGeometry(.19 * scale, .21 * scale, .34 * scale, 18), mat);
}

export function DepartmentRoomThreeView({ racks, cells, stocks, selectedCellId, selectedRackId, onCellClick, onRackClick, onClearSelection }: {
  racks: Rack[]; cells: Cell[]; stocks: Stock[]; selectedCellId?: string | null; selectedRackId?: string | null;
  onCellClick: (cell: Cell) => void; onRackClick: (rack: Rack) => void; onClearSelection: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const cameraStateRef = useRef<CameraState | null>(null);
  const [activeCell, setActiveCell] = useState<Cell | null>(null);
  const [mode, setMode] = useState<Mode>("contents");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [productId, setProductId] = useState("");
  const [targetCellId, setTargetCellId] = useState("");
  const [qty, setQty] = useState("");

  const loadSnapshot = useCallback(async () => {
    const r = await fetch("/api/department-warehouse", { cache: "no-store" });
    const body = await r.json() as Snapshot & { error?: string };
    if (!r.ok) throw new Error(body.error || "Не удалось загрузить ячейку");
    setSnapshot(body);
    return body;
  }, []);

  const activeStocks = useMemo(() => activeCell ? (snapshot?.stocks || []).filter((s) => s.cellId === activeCell.id && Number(s.quantity) > 0) : [], [snapshot, activeCell]);
  const productMap = useMemo(() => new Map((snapshot?.products || []).map((p) => [p.id, p])), [snapshot]);
  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = snapshot?.products || [];
    return !q ? list : list.filter((p) => `${p.name} ${p.sku} ${p.barcode} ${p.oneCId || ""}`.toLowerCase().includes(q));
  }, [snapshot, search]);
  const history = useMemo(() => activeCell ? (snapshot?.movements || []).filter((m) => m.fromCellId === activeCell.id || m.toCellId === activeCell.id) : [], [snapshot, activeCell]);
  const storedNames = useMemo(() => activeStocks.map((s) => productMap.get(s.productId)?.name || "Материал"), [activeStocks, productMap]);

  const openCell = useCallback((cell: Cell) => {
    onCellClick(cell);
    setActiveCell(cell);
    setMode("contents"); setSearch(""); setProductId(""); setTargetCellId(""); setQty("");
    void loadSnapshot().catch((e) => toast.error(e instanceof Error ? e.message : "Ошибка загрузки"));
  }, [loadSnapshot, onCellClick]);

  const post = async (payload: Record<string, unknown>, message: string) => {
    setBusy(true);
    try {
      const r = await fetch("/api/department-warehouse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await r.json() as { error?: string };
      if (!r.ok) throw new Error(body.error || "Операция не выполнена");
      toast.success(message); await loadSnapshot();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Операция не выполнена"); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.replaceChildren();
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0xf1f5f9);
    const rackOnly = racks.filter((r) => r.storageType !== "floor");
    const floorOnly = racks.filter((r) => r.storageType === "floor");
    const positions = [...rackOnly.map((r, i) => autoPosition(r, i, false)), ...floorOnly.map((r, i) => autoPosition(r, i, true))];
    const cx = positions.length ? positions.reduce((s, p) => s + p.x, 0) / positions.length : 0;
    const cz = positions.length ? positions.reduce((s, p) => s + p.z, 0) / positions.length : 0;
    const center = new THREE.Vector3(cx, 2, cz);
    const camera = new THREE.PerspectiveCamera(45, 1, .1, 120);
    const saved = cameraStateRef.current;
    if (saved) camera.position.set(...saved.position); else camera.position.set(cx + 11, 8, cz + 15);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "low-power" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.width = "100%"; renderer.domElement.style.height = "100%"; host.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = false;
    if (saved) controls.target.set(...saved.target); else controls.target.copy(center);
    controls.maxPolarAngle = Math.PI / 2.02;
    if (!saved) camera.lookAt(center);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x64748b, 2.4));
    const light = new THREE.DirectionalLight(0xffffff, 2.2); light.position.set(cx + 8, 12, cz + 8); scene.add(light);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 30), new THREE.MeshStandardMaterial({ color: 0xe5e7eb, roughness: .95 })); floor.rotation.x = -Math.PI / 2; scene.add(floor);
    const grid = new THREE.GridHelper(40, 40, 0x94a3b8, 0xcbd5e1); grid.position.y = .01; scene.add(grid);

    const cellObjects: THREE.Object3D[] = [], rackObjects: THREE.Object3D[] = [];
    const cellByUuid = new Map<string, Cell>(), rackByUuid = new Map<string, Rack>();
    const steel = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: .5 });
    const shelfMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: .6 });
    const box = (g: THREE.Group, w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => { const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); mesh.position.set(x, y, z); g.add(mesh); return mesh; };

    rackOnly.forEach((rack, ri) => {
      const g = new THREE.Group(); const p = autoPosition(rack, ri, false); g.position.set(p.x, 0, p.z); g.rotation.y = Number(rack.rotation || 0); scene.add(g);
      const rcells = cells.filter((c) => c.rackId === rack.id);
      const byRows = Array.from({ length: rack.rows }, (_, row) => rcells.filter((c) => c.rowIndex === row).sort((a, b) => a.columnIndex - b.columnIndex));
      const rowHeights = byRows.map((row) => Math.max(.55, ...row.map((c) => Number(c.cellHeight || 1.1))));
      const rackWidth = Math.max(1, Number(rack.width || 4)), rackDepth = Math.max(.7, Number(rack.depth || 1.2));
      let y = .16;
      box(g, rackWidth + .3, .16, rackDepth + .2, 0, .08, 0, steel);
      byRows.forEach((row, rowIndex) => {
        const h = rowHeights[rowIndex];
        const widths = row.map((c) => Math.max(.25, Number(c.cellWidth || rackWidth / Math.max(1, row.length))));
        const total = widths.reduce((s, v) => s + v, 0) || rackWidth; let xCursor = -total / 2;
        row.forEach((cell, ci) => {
          const w = widths[ci], x = xCursor + w / 2; xCursor += w;
          const ss = stocks.filter((s) => s.cellId === cell.id && Number(s.quantity) > 0);
          const selected = cell.id === selectedCellId;
          const hit = new THREE.Mesh(new THREE.BoxGeometry(Math.max(.18, w - .06), Math.max(.25, h - .08), .14), new THREE.MeshStandardMaterial({ color: selected ? 0x38bdf8 : ss.length ? 0xbfdbfe : 0xffffff, transparent: true, opacity: selected ? .82 : ss.length ? .35 : .08 }));
          hit.position.set(x, y + h / 2, rackDepth / 2 + .06); g.add(hit); cellObjects.push(hit); cellByUuid.set(hit.uuid, cell);
          box(g, .05, h, rackDepth, x - w / 2, y + h / 2, 0, shelfMat);
          const visible = ss.slice(0, 16), cols = Math.max(1, Math.ceil(Math.sqrt(visible.length || 1)));
          visible.forEach((s, index) => { const mesh = packageMesh(s, Math.min(.9, Math.max(.45, w / Math.max(2, cols)))); const col = index % cols, rr = Math.floor(index / cols); mesh.position.set(x + (col - (cols - 1) / 2) * Math.min(.36, w / Math.max(2, cols)), y + .2, -.08 + rr * .28); g.add(mesh); });
        });
        if (row.length) box(g, .05, h, rackDepth, total / 2, y + h / 2, 0, shelfMat);
        y += h; box(g, rackWidth + .12, .08, rackDepth, 0, y + .04, 0, shelfMat); y += .08;
      });
      for (const x of [-rackWidth / 2, rackWidth / 2]) box(g, .12, y, .12, x, y / 2, -rackDepth / 2, steel);
      const rackHit = new THREE.Mesh(new THREE.BoxGeometry(rackWidth + .5, y + .3, rackDepth + .5), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })); rackHit.position.set(0, y / 2, 0); g.add(rackHit); rackObjects.push(rackHit); rackByUuid.set(rackHit.uuid, rack);
      if (rack.id === selectedRackId && !selectedCellId) scene.add(new THREE.BoxHelper(g, 0x38bdf8));
    });

    floorOnly.forEach((rack, i) => {
      const p = autoPosition(rack, i, true), w = Math.max(1.3, Number(rack.width || 2)), d = Math.max(1.3, Number(rack.depth || 2));
      const cell = cells.find((c) => c.rackId === rack.id); if (!cell) return;
      const selected = cell.id === selectedCellId || (rack.id === selectedRackId && !selectedCellId);
      const pad = new THREE.Mesh(new THREE.BoxGeometry(w, .12, d), new THREE.MeshStandardMaterial({ color: selected ? 0x38bdf8 : 0xfef3c7, transparent: true, opacity: selected ? .85 : .75 })); pad.position.set(p.x, .06, p.z); scene.add(pad); cellObjects.push(pad); cellByUuid.set(pad.uuid, cell); rackObjects.push(pad); rackByUuid.set(pad.uuid, rack);
      const ss = stocks.filter((s) => s.cellId === cell.id && Number(s.quantity) > 0).slice(0, 24), cols = Math.max(1, Math.ceil(Math.sqrt(ss.length || 1)));
      ss.forEach((s, idx) => { const mesh = packageMesh(s, .9); mesh.position.set(p.x + (idx % cols - (cols - 1) / 2) * .5, .25, p.z + (Math.floor(idx / cols) - 1) * .5); scene.add(mesh); });
    });

    const saveCamera = () => { cameraStateRef.current = { position: [camera.position.x, camera.position.y, camera.position.z], target: [controls.target.x, controls.target.y, controls.target.z] }; };
    const render = () => { saveCamera(); renderer.render(scene, camera); };
    controls.addEventListener("change", render);
    const resize = () => { const w = Math.max(320, host.clientWidth), h = Math.max(540, host.clientHeight); camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h, false); renderer.render(scene, camera); };
    const ro = new ResizeObserver(resize); ro.observe(host); resize();
    const ray = new THREE.Raycaster(), pt = new THREE.Vector2(); let downX = 0, downY = 0;
    const down = (e: PointerEvent) => { downX = e.clientX; downY = e.clientY; };
    const up = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return;
      saveCamera();
      const rect = renderer.domElement.getBoundingClientRect(); pt.x = ((e.clientX - rect.left) / rect.width) * 2 - 1; pt.y = -((e.clientY - rect.top) / rect.height) * 2 + 1; ray.setFromCamera(pt, camera);
      const ch = ray.intersectObjects(cellObjects, false)[0]; if (ch) { const c = cellByUuid.get(ch.object.uuid); if (c) { openCell(c); return; } }
      const rh = ray.intersectObjects(rackObjects, false)[0]; if (rh) { const r = rackByUuid.get(rh.object.uuid); if (r) { onRackClick(r); setActiveCell(null); return; } }
      onClearSelection(); setActiveCell(null);
    };
    renderer.domElement.addEventListener("pointerdown", down); renderer.domElement.addEventListener("pointerup", up);
    return () => {
      saveCamera(); ro.disconnect(); controls.removeEventListener("change", render); controls.dispose(); renderer.domElement.removeEventListener("pointerdown", down); renderer.domElement.removeEventListener("pointerup", up);
      scene.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose()); else o.material.dispose(); } });
      renderer.dispose(); renderer.forceContextLoss(); host.replaceChildren();
    };
  }, [racks, cells, stocks, selectedCellId, selectedRackId, onRackClick, onClearSelection, openCell]);

  const modeButton = (m: Mode, label: string, icon: React.ReactNode) => <button type="button" onClick={() => setMode(m)} className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold ${mode === m ? "bg-blue-600 text-white" : "border bg-white"}`}>{icon}{label}</button>;
  const add = async (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); if (!activeCell || !productId) return; const f = new FormData(e.currentTarget); await post({ action: "receive", productId, cellId: activeCell.id, quantity: f.get("quantity"), documentNumber: "3D-РАЗМЕЩЕНИЕ", sourceName: "Размещение", sourceLocation: activeCell.code }, "Материал размещён"); setMode("contents"); };
  const move = async (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); if (!activeCell || !productId || !targetCellId) return; await post({ action: "transfer", productId, fromCellId: activeCell.id, toCellId: targetCellId, quantity: qty, comment: "Перемещение из карточки ячейки" }, "Материал перемещён"); setMode("contents"); };
  const adjust = async (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); if (!activeCell || !productId) return; await post({ action: "adjustStock", productId, cellId: activeCell.id, quantity: qty, comment: "Корректировка из карточки ячейки" }, "Остаток скорректирован"); setMode("contents"); };

  return <>
    <div ref={hostRef} className="min-h-[680px] w-full overflow-hidden rounded-[24px] border bg-slate-100"/>
    {activeCell && <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) setActiveCell(null); }}>
      <div className="max-h-[92vh] w-full max-w-[980px] overflow-auto rounded-[28px] bg-white p-5 shadow-2xl sm:p-6">
        <div className="flex items-start justify-between"><div><div className="text-xs font-black uppercase tracking-[.14em] text-sky-600">Ячейка</div><h2 className="mt-1 text-2xl font-black">{activeCell.code}</h2><p className="mt-1 text-sm text-slate-500">{activeStocks.length} позиций · {activeStocks.length ? "Занята" : "Свободна"}</p></div><button onClick={() => setActiveCell(null)} className="rounded-xl p-2 hover:bg-slate-100"><X/></button></div>
        <div className="mt-5 grid gap-5 md:grid-cols-[190px_1fr]">
          <ZoomableQr value={activeCell.code} label={activeCell.code} size={145} className="h-fit"/>
          <div><div className="flex flex-wrap gap-2">{modeButton("contents", "Содержимое", <PackagePlus size={15}/>)}{modeButton("add", "Добавить", <PackagePlus size={15}/>)}{modeButton("move", "Переместить", <ArrowRightLeft size={15}/>)}{modeButton("adjust", "Корректировать", <SlidersHorizontal size={15}/>)}{modeButton("history", "История", <History size={15}/>)}</div>
            <div className="mt-4 rounded-2xl bg-sky-50 p-4 text-sm text-slate-700">{storedNames.length ? <><b>В этой ячейке хранятся:</b> {storedNames.join(", ")}.</> : <><b>Ячейка свободна.</b> Материалов сейчас нет.</>}</div>
          </div>
        </div>

        {mode === "contents" && <div className="mt-5 space-y-3">{activeStocks.map((s) => { const p = productMap.get(s.productId); return <div key={s.productId} className="grid gap-4 rounded-2xl border bg-slate-50 p-4 md:grid-cols-[1fr_320px_auto] md:items-center"><div><div data-product-name className="font-black">{p?.name || "Материал"}</div><div className="mt-1 text-xs text-slate-500">{p?.sku || ""}{p?.oneCId ? ` · 1С ${p.oneCId}` : ""}</div></div><div>{p?.barcode ? <ProductBarcode value={p.barcode} productName={p.name} compact/> : <div className="rounded-xl border border-dashed bg-white p-3 text-center text-xs text-slate-400">Штрихкод не назначен</div>}</div><div className="whitespace-nowrap text-lg font-black">{Number(s.quantity).toLocaleString("ru-RU", { maximumFractionDigits: 6 })} {p?.unit || ""}</div></div>; })}{!activeStocks.length && <div className="rounded-2xl border border-dashed p-10 text-center text-slate-400">Ячейка свободна</div>}</div>}
        {mode === "add" && <form onSubmit={add} className="mt-5 space-y-3"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск материала..." className="h-11 w-full rounded-xl border px-3"/><select value={productId} onChange={(e) => setProductId(e.target.value)} className="h-11 w-full rounded-xl border bg-white px-3"><option value="">Выберите материал...</option>{filteredProducts.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.unit}</option>)}</select><input name="quantity" inputMode="decimal" required placeholder="Количество" className="h-11 w-full rounded-xl border px-3"/><button disabled={busy} className="h-11 w-full rounded-xl bg-orange-500 font-black text-white">Добавить в {activeCell.code}</button></form>}
        {mode === "move" && <form onSubmit={move} className="mt-5 space-y-3"><select value={productId} onChange={(e) => setProductId(e.target.value)} className="h-11 w-full rounded-xl border bg-white px-3"><option value="">Материал из ячейки...</option>{activeStocks.map((s) => { const p = productMap.get(s.productId); return <option key={s.productId} value={s.productId}>{p?.name} · {s.quantity} {p?.unit}</option>; })}</select><select value={targetCellId} onChange={(e) => setTargetCellId(e.target.value)} className="h-11 w-full rounded-xl border bg-white px-3"><option value="">Куда переместить...</option>{(snapshot?.cells || []).filter((c) => c.id !== activeCell.id && !c.blocked).map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}</select><input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" required placeholder="Количество" className="h-11 w-full rounded-xl border px-3"/><button disabled={busy} className="h-11 w-full rounded-xl bg-blue-600 font-black text-white">Переместить</button></form>}
        {mode === "adjust" && <form onSubmit={adjust} className="mt-5 space-y-3"><select value={productId} onChange={(e) => setProductId(e.target.value)} className="h-11 w-full rounded-xl border bg-white px-3"><option value="">Материал...</option>{activeStocks.map((s) => { const p = productMap.get(s.productId); return <option key={s.productId} value={s.productId}>{p?.name}</option>; })}</select><input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" required placeholder="Новый остаток" className="h-11 w-full rounded-xl border px-3"/><button disabled={busy} className="h-11 w-full rounded-xl bg-slate-900 font-black text-white">Сохранить остаток</button></form>}
        {mode === "history" && <div className="mt-5 space-y-2">{history.map((m) => <div key={m.id} className="rounded-xl border p-3 text-sm"><b>{m.type}</b> · {m.productName} · {m.quantity}<div className="mt-1 text-xs text-slate-400">{new Date(m.createdAt).toLocaleString("ru-RU")} · {m.operator}</div></div>)}{!history.length && <div className="p-8 text-center text-slate-400">Истории пока нет</div>}</div>}
      </div>
    </div>}
  </>;
}
