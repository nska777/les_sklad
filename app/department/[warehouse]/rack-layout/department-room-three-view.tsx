"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

type Rack = { id: string; name: string; code: string; rows: number; columns: number; storageType: string; width: number; depth: number; posX?: number; posZ?: number; rotation?: number };
type Cell = { id: string; rackId: string; code: string; label: string; rowIndex: number; columnIndex: number; blocked: boolean };
type Stock = { productId: string; cellId: string; quantity: number; productName: string; unit: string; color?: string; packType?: string; packSize?: number };

function labelSprite(text: string, accent = false) {
  const canvas = document.createElement("canvas");
  canvas.width = 640; canvas.height = 180;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = accent ? "rgba(255,247,237,.97)" : "rgba(255,255,255,.95)";
  ctx.strokeStyle = accent ? "#f97316" : "#cbd5e1"; ctx.lineWidth = 4;
  ctx.roundRect(8, 8, 624, 164, 26); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#0f172a"; ctx.font = "700 28px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  text.split("\n").slice(0, 3).forEach((line, i) => ctx.fillText(line, 320, 48 + i * 46, 580));
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(3.4, 0.96, 1); return sprite;
}

function colorFromText(value?: string) {
  if (!value) return 0xd97706;
  const v = value.trim().toLowerCase();
  const map: Record<string, number> = { белый: 0xf8fafc, черный: 0x111827, чёрный: 0x111827, красный: 0xdc2626, синий: 0x2563eb, зеленый: 0x16a34a, зелёный: 0x16a34a, желтый: 0xeab308, жёлтый: 0xeab308, серый: 0x64748b, коричневый: 0x92400e };
  return map[v] || 0xd97706;
}

export function DepartmentRoomThreeView({ racks, cells, stocks, selectedCellId, onCellClick }: { racks: Rack[]; cells: Cell[]; stocks: Stock[]; selectedCellId?: string | null; onCellClick: (cell: Cell) => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = hostRef.current; if (!host) return; host.innerHTML = "";
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0xf1f5f9); scene.fog = new THREE.Fog(0xf1f5f9, 24, 58);
    const camera = new THREE.PerspectiveCamera(46, 1, .1, 120); camera.position.set(13, 12, 18);
    const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true; renderer.outputColorSpace = THREE.SRGBColorSpace; host.appendChild(renderer.domElement);
    renderer.domElement.style.width = "100%"; renderer.domElement.style.height = "100%";
    const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.target.set(0, 2, 0); controls.maxPolarAngle = Math.PI / 2.03;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x64748b, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 3.2); key.position.set(8, 16, 10); key.castShadow = true; scene.add(key);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(34, 25), new THREE.MeshStandardMaterial({ color: 0xe5e7eb, roughness: .94 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
    const grid = new THREE.GridHelper(34, 34, 0x94a3b8, 0xcbd5e1); grid.position.y = .01; scene.add(grid);
    const interactive: THREE.Object3D[] = []; const cellByObject = new Map<string, Cell>();
    const steel = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: .42, metalness: .65 });
    const shelf = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: .55, metalness: .45 });

    const addBox = (group: THREE.Group, w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat); m.position.set(x,y,z); m.castShadow=true; m.receiveShadow=true; group.add(m); return m; };
    const racksOnly = racks.filter((r) => r.storageType !== "floor");
    const floorsOnly = racks.filter((r) => r.storageType === "floor");

    racksOnly.forEach((rack, rackIndex) => {
      const group = new THREE.Group(); const col = rackIndex % 3, row = Math.floor(rackIndex / 3); group.position.set(-9 + col * 8.5, 0, -5 + row * 6.5); group.rotation.y = Number(rack.rotation || 0); scene.add(group);
      const width = Math.max(3.4, Number(rack.width || 4)), depth = Math.max(1, Number(rack.depth || 1.2)), rowH = 1.25, height = Math.max(2, rack.rows * rowH + .3);
      addBox(group,width+.4,.18,depth+.25,0,.08,0,steel); addBox(group,width+.4,.18,depth+.25,0,height,0,steel);
      for (const x of [-width/2,width/2]) { addBox(group,.14,height,.14,x,height/2,-depth/2,steel); addBox(group,.14,height,.14,x,height/2,depth/2,steel); }
      for (let rr=0; rr<rack.rows; rr++) addBox(group,width+.15,.09,depth,0,(rr+1)*rowH,0,shelf);
      const rc = cells.filter((c) => c.rackId === rack.id);
      for (let rr=0; rr<rack.rows; rr++) {
        const rowCells = rc.filter((c) => c.rowIndex===rr).sort((a,b)=>a.columnIndex-b.columnIndex); const cw = width / Math.max(1,rowCells.length);
        rowCells.forEach((cell, i) => {
          const x=-width/2 + cw*i + cw/2, y=rr*rowH+rowH/2+.04, z=depth/2+.08; const ss=stocks.filter((s)=>s.cellId===cell.id); const occupied=ss.length>0, selected=cell.id===selectedCellId;
          const mat=new THREE.MeshStandardMaterial({ color:selected?0xf59e0b:occupied?0xbfdbfe:0xffffff, transparent:true, opacity:selected?.92:occupied?.6:.18, emissive:selected?0xf59e0b:0x000000, emissiveIntensity:selected?.45:0 });
          const hit=new THREE.Mesh(new THREE.BoxGeometry(Math.max(.25,cw-.12),rowH-.15,.18),mat); hit.position.set(x,y,z); group.add(hit); interactive.push(hit); cellByObject.set(hit.uuid,cell);
          if (occupied) {
            const first=ss[0], bucketCount=Math.min(4, Math.max(1, Math.ceil(Number(first.quantity)/(Number(first.packSize)||Number(first.quantity)||1))));
            for(let b=0;b<bucketCount;b++){ const bucket=new THREE.Mesh(new THREE.CylinderGeometry(.18,.2,.34,20),new THREE.MeshStandardMaterial({color:colorFromText(first.color),roughness:.55,metalness:.08})); bucket.position.set(x+(b-(bucketCount-1)/2)*.42,y-.26,z+.18); bucket.castShadow=true; group.add(bucket); }
          }
          const total=ss.reduce((sum,s)=>sum+Number(s.quantity),0); const first=ss[0]; const label=labelSprite(occupied?`${cell.code}\n${first.productName}\n${total.toLocaleString("ru-RU")} ${first.unit}`:`${cell.code}\nСвободно`,selected||occupied); label.position.set(x,y+.28,z+.34); label.scale.set(Math.min(2.6,Math.max(1.3,cw*.8)),.72,1); group.add(label);
        });
      }
      const title=labelSprite(`${rack.code} · ${rack.name}`,true); title.position.set(0,height+.65,0); group.add(title);
    });

    floorsOnly.forEach((zone, i) => {
      const col=i%4,row=Math.floor(i/4); const x=-9+col*5.5,z=7+row*4.3; const w=Math.max(1.4,Number(zone.width||2)),d=Math.max(1.4,Number(zone.depth||2));
      const cell=cells.find((c)=>c.rackId===zone.id); if(!cell)return; const ss=stocks.filter((s)=>s.cellId===cell.id), selected=cell.id===selectedCellId;
      const mat=new THREE.MeshStandardMaterial({color:selected?0xf59e0b:0xfef3c7,transparent:true,opacity:.7,roughness:.8}); const pad=new THREE.Mesh(new THREE.BoxGeometry(w,.12,d),mat); pad.position.set(x,.07,z); pad.receiveShadow=true; scene.add(pad); interactive.push(pad); cellByObject.set(pad.uuid,cell);
      const first=ss[0]; if(first){ const count=Math.min(9,Math.max(1,Math.ceil(Number(first.quantity)/(Number(first.packSize)||Number(first.quantity)||1)))); for(let b=0;b<count;b++){ const bx=x+((b%3)-1)*.52,bz=z+(Math.floor(b/3)-1)*.52; const bucket=new THREE.Mesh(new THREE.CylinderGeometry(.28,.31,.48,24),new THREE.MeshStandardMaterial({color:colorFromText(first.color),roughness:.55})); bucket.position.set(bx,.31,bz); bucket.castShadow=true; scene.add(bucket);} }
      const total=ss.reduce((sum,s)=>sum+Number(s.quantity),0); const label=labelSprite(first?`${zone.code} · ${zone.name}\n${first.productName}\n${total.toLocaleString("ru-RU")} ${first.unit}`:`${zone.code} · ${zone.name}\nНапольная зона\nСвободно`,true); label.position.set(x,1.45,z); scene.add(label);
    });

    const raycaster=new THREE.Raycaster(), pointer=new THREE.Vector2(); let dx=0,dy=0;
    const down=(e:PointerEvent)=>{dx=e.clientX;dy=e.clientY;};
    const up=(e:PointerEvent)=>{ if(Math.hypot(e.clientX-dx,e.clientY-dy)>6)return; const r=renderer.domElement.getBoundingClientRect(); pointer.x=((e.clientX-r.left)/r.width)*2-1; pointer.y=-((e.clientY-r.top)/r.height)*2+1; raycaster.setFromCamera(pointer,camera); const hit=raycaster.intersectObjects(interactive,false)[0]; if(hit){ const c=cellByObject.get(hit.object.uuid); if(c)onCellClick(c);} };
    renderer.domElement.addEventListener("pointerdown",down); renderer.domElement.addEventListener("pointerup",up);
    const resize=()=>{ const w=Math.max(320,host.clientWidth),h=Math.max(640,host.clientHeight); camera.aspect=w/h; camera.updateProjectionMatrix(); renderer.setSize(w,h,false);}; const obs=new ResizeObserver(resize); obs.observe(host); resize();
    let frame=0; const animate=()=>{controls.update();renderer.render(scene,camera);frame=requestAnimationFrame(animate);}; animate();
    return()=>{cancelAnimationFrame(frame);obs.disconnect();renderer.domElement.removeEventListener("pointerdown",down);renderer.domElement.removeEventListener("pointerup",up);controls.dispose();scene.traverse((o)=>{if(o instanceof THREE.Mesh){o.geometry.dispose();if(Array.isArray(o.material))o.material.forEach((m)=>m.dispose());else o.material.dispose();} if(o instanceof THREE.Sprite){o.material.map?.dispose();o.material.dispose();}});renderer.dispose();host.innerHTML="";};
  },[racks,cells,stocks,selectedCellId,onCellClick]);
  return <div className="relative overflow-hidden rounded-3xl border bg-slate-100 shadow-inner"><div ref={hostRef} className="h-[76vh] min-h-[680px] w-full"/><div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border bg-white/90 px-4 py-2 text-xs font-medium text-slate-600 shadow">Перетаскивание — вращение · колесо — масштаб · клик — место хранения</div></div>;
}
