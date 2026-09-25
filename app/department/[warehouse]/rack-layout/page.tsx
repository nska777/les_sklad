"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { ArrowLeft, Box, Layers3, Loader2, MapPin, PackagePlus, Plus, QrCode, Trash2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DepartmentRoomThreeView } from "./department-room-three-view";

type Rack = { id: string; name: string; code: string; rows: number; columns: number; storageType: string; width: number; depth: number; posX?: number; posZ?: number; rotation?: number };
type Cell = { id: string; rackId: string; code: string; label: string; rowIndex: number; columnIndex: number; blocked: boolean };
type Product = { id: string; name: string; sku: string; barcode: string; unit: string; color: string; packType: string; packSize: number };
type Stock = { productId: string; cellId: string; quantity: number };
type Snapshot = { warehouse: { code: string; name: string }; racks: Rack[]; cells: Cell[]; products: Product[]; stocks: Stock[]; error?: string };
const fmt=(v:number)=>new Intl.NumberFormat("ru-RU",{maximumFractionDigits:3}).format(v);

export default function PaintStorageRoomPage(){
  const params=useParams<{warehouse:string}>(); const warehouse=String(params?.warehouse||"paint"); const base=`/department/${warehouse}`;
  const [data,setData]=useState<Snapshot>({warehouse:{code:warehouse,name:"Склад краски"},racks:[],cells:[],products:[],stocks:[]});
  const [loading,setLoading]=useState(true); const [saving,setSaving]=useState(false); const [selected,setSelected]=useState<Cell|null>(null); const [mode,setMode]=useState<"rack"|"floor"|null>(null);
  const load=useCallback(async()=>{try{const r=await fetch("/api/department-warehouse",{cache:"no-store"});const b=await r.json() as Snapshot;if(!r.ok)throw new Error(b.error||"Не удалось загрузить склад");setData(b);}catch(e){toast.error(e instanceof Error?e.message:"Ошибка загрузки");}finally{setLoading(false);}},[]);
  useEffect(()=>{void load();},[load]);
  const post=async(payload:Record<string,unknown>,success:string)=>{setSaving(true);try{const r=await fetch("/api/department-warehouse",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});const b=await r.json() as {error?:string};if(!r.ok)throw new Error(b.error||"Операция не выполнена");toast.success(success);await load();return b;}catch(e){toast.error(e instanceof Error?e.message:"Ошибка");throw e;}finally{setSaving(false);}};
  const onCellClick=useCallback((cell:Cell)=>setSelected(cell),[]);
  const selectedStocks=useMemo(()=>selected?data.stocks.filter((s)=>s.cellId===selected.id&&Number(s.quantity)>0):[],[selected,data.stocks]);
  const richStocks=useMemo(()=>data.stocks.map((s)=>{const p=data.products.find((x)=>x.id===s.productId);return{...s,productName:p?.name||"Материал",unit:p?.unit||"",color:p?.color||"",packType:p?.packType||"",packSize:Number(p?.packSize||0)};}),[data.stocks,data.products]);
  const submitStorage=async(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const f=new FormData(e.currentTarget);const action=mode==="floor"?"createFloorZone":"createRack";await post({action,...Object.fromEntries(f.entries())},mode==="floor"?"Напольная зона создана":"Стеллаж создан");setMode(null);};
  const place=async(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();if(!selected)return;const f=new FormData(e.currentTarget);await post({action:"place",cellId:selected.id,productId:f.get("productId"),quantity:f.get("quantity"),comment:"Размещение через 3D-склад"},"Материал размещён");e.currentTarget.reset();};
  const deleteStorage=async()=>{if(!selected)return;const rack=data.racks.find((r)=>r.id===selected.rackId);if(!rack||!confirm(`Удалить ${rack.storageType==="floor"?"напольную зону":"стеллаж"} ${rack.code}?`))return;await post({action:"deleteRack",id:rack.id},"Место хранения удалено");setSelected(null);};
  if(loading)return <main className="flex min-h-screen items-center justify-center"><Loader2 className="animate-spin text-orange-500" size={36}/></main>;
  const selectedRack=selected?data.racks.find((r)=>r.id===selected.rackId):null;
  return <main className="min-h-screen px-3 py-4 text-[var(--foreground)] sm:px-5 lg:px-7"><div className="mx-auto max-w-[1800px] space-y-4">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><Link href={base} data-same-tab="true" className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-blue-700 hover:underline"><ArrowLeft size={16}/> Назад</Link><p className="eyebrow">Склад краски · 3D-комната</p><h1 className="page-title">Склад</h1><p className="page-description">Стеллажи, ячейки и напольные зоны в одной 3D-комнате. Банки и ведра показываются прямо в месте хранения.</p></div><div className="flex flex-wrap gap-2"><Button onClick={()=>setMode("rack")} className="accent-button"><Plus/> Стеллаж</Button><Button variant="outline" onClick={()=>setMode("floor")}><MapPin/> Напольная зона</Button></div></div>
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <DepartmentRoomThreeView racks={data.racks} cells={data.cells} stocks={richStocks} selectedCellId={selected?.id} onCellClick={onCellClick}/>
      <aside className="panel h-fit p-5 xl:sticky xl:top-4">{selected?<><div className="flex items-start justify-between gap-3"><div><p className="eyebrow">{selectedRack?.storageType==="floor"?"Напольное хранение":"Ячейка"}</p><h2 className="mt-1 text-2xl font-black">{selected.code}</h2><p className="mt-1 text-sm text-slate-500">{selectedRack?.name}</p></div><div className="rounded-xl bg-slate-950 p-2.5 text-white"><QrCode size={20}/></div></div>
        <div className="mt-4 flex justify-center rounded-2xl border bg-white p-4"><QRCodeSVG value={`RL-CELL:${data.warehouse.code}:${selected.code}`} size={170}/></div><div className="mt-2 text-center text-xs font-mono text-slate-400">RL-CELL:{data.warehouse.code}:{selected.code}</div>
        <div className="mt-5 space-y-2">{selectedStocks.map((s)=>{const p=data.products.find((x)=>x.id===s.productId);return <div key={s.productId} className="rounded-xl border bg-slate-50 p-3"><div className="font-bold">{p?.name}</div><div className="mt-1 text-sm text-slate-500">{fmt(Number(s.quantity))} {p?.unit}{p?.packSize?` · ≈ ${fmt(Number(s.quantity)/Number(p.packSize))} ${p.packType||"уп."}`:""}</div></div>;})}{!selectedStocks.length&&<div className="rounded-xl border border-dashed p-4 text-center text-sm text-slate-400">Место свободно</div>}</div>
        <form onSubmit={place} className="mt-5 space-y-3 border-t pt-5"><div className="font-black">Разместить материал</div><div><Label>Материал</Label><select name="productId" required className="mt-1.5 h-10 w-full rounded-md border bg-white px-3 text-sm"><option value="">Выберите...</option>{data.products.map((p)=><option key={p.id} value={p.id}>{p.name} · {p.unit}</option>)}</select></div><div><Label>Количество</Label><Input name="quantity" required type="number" step="0.001" min="0.001" className="mt-1.5"/></div><Button disabled={saving} className="accent-button w-full"><PackagePlus/> Разместить</Button></form>
        <Button variant="outline" className="mt-3 w-full text-red-600" onClick={()=>void deleteStorage()} disabled={selectedStocks.length>0}><Trash2/> Удалить место хранения</Button>
      </>:<div className="py-12 text-center"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100"><Box size={22}/></div><h3 className="mt-4 font-black">Выберите место</h3><p className="mt-2 text-sm leading-6 text-slate-500">Нажмите на ячейку стеллажа или напольную зону. Здесь появятся QR, остаток и размещение товара.</p></div>}</aside>
    </div>
    {mode&&<div className="fixed inset-0 z-[12000] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm"><form onSubmit={submitStorage} className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl"><div className="flex items-center gap-3"><div className="rounded-xl bg-slate-100 p-2"><Layers3 size={20}/></div><div><h2 className="text-xl font-black">{mode==="floor"?"Новая напольная зона":"Новый стеллаж"}</h2><p className="text-xs text-slate-500">Объект сразу появится в 3D-комнате</p></div></div><div className="mt-5 grid gap-3 sm:grid-cols-2"><div><Label>Название</Label><Input name="name" required className="mt-1.5"/></div><div><Label>Код</Label><Input name="code" required className="mt-1.5" placeholder={mode==="floor"?"P-01":"K1"}/></div>{mode==="rack"&&<><div><Label>Полок</Label><Input name="rows" type="number" min="1" max="12" defaultValue="4" className="mt-1.5"/></div><div><Label>Ячеек на полке</Label><Input name="columns" type="number" min="1" max="20" defaultValue="4" className="mt-1.5"/></div></>}<div><Label>Ширина, м</Label><Input name="width" type="number" step="0.1" defaultValue={mode==="floor"?2:4} className="mt-1.5"/></div><div><Label>Глубина, м</Label><Input name="depth" type="number" step="0.1" defaultValue={mode==="floor"?2:1.2} className="mt-1.5"/></div></div><div className="mt-5 flex justify-end gap-2"><Button type="button" variant="outline" onClick={()=>setMode(null)}>Отмена</Button><Button className="accent-button" disabled={saving}><Plus/> Создать</Button></div></form></div>}
  </div></main>;
}
