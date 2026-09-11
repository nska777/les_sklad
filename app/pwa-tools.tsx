"use client";

import { useEffect, useState } from "react";
import { Download, MonitorSmartphone, RefreshCw, Share, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

export function PwaRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js");
  }, []);
  return null;
}

export function InstallGuide() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  useEffect(() => {
    const onPrompt = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPromptEvent); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);
  const install = async () => { if (!prompt) return; await prompt.prompt(); await prompt.userChoice; setPrompt(null); };

  return <TabsContent value="install" className="space-y-5">
    <div><p className="eyebrow">Приложение на любом устройстве</p><h1 className="page-title">Установить «Русский Лес · Склад»</h1><p className="page-description">Один сервер и одна база. На телефоне, планшете и компьютере приложение открывается отдельным значком.</p></div>
    <div className="install-hero panel"><div><span className="glass-kicker"><MonitorSmartphone size={16} /> PWA-приложение</span><h2>Склад всегда под рукой</h2><p>Ничего не нужно переустанавливать после обновлений: новая версия загружается автоматически при следующем открытии.</p>{prompt && <Button onClick={() => void install()} className="mt-5"><Download /> Установить сейчас</Button>}</div><Smartphone className="install-phone" /></div>
    <div className="grid gap-4 md:grid-cols-3">
      <article className="panel install-card"><b>iPhone и iPad</b><p>Откройте сайт в Safari → нажмите «Поделиться» → «На экран Домой».</p><Share /></article>
      <article className="panel install-card"><b>Android</b><p>Откройте сайт в Chrome → меню ⋮ → «Установить приложение».</p><Download /></article>
      <article className="panel install-card"><b>Mac и Windows</b><p>Откройте сайт в Chrome или Edge → значок установки справа в адресной строке.</p><MonitorSmartphone /></article>
    </div>
    <div className="panel flex items-start gap-3 p-5 text-sm leading-6 text-[var(--muted-foreground)]"><RefreshCw className="mt-0.5 shrink-0 text-[var(--primary)]" size={19} /><p><b className="text-[var(--foreground)]">Важно:</b> для общей базы и синхронизации между устройствами требуется интернет. При временном отключении приложение откроется, но складские операции нужно проводить после восстановления связи.</p></div>
  </TabsContent>;
}
