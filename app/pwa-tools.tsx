"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, MonitorSmartphone, RefreshCw, Share, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function PwaRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js");
  }, []);
  return null;
}

export function InstallGuide() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [message, setMessage] = useState("");

  const isIOS = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    return /iPhone|iPad|iPod/i.test(navigator.userAgent);
  }, []);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches
      || ("standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
    setInstalled(standalone);

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPromptEvent);
      setMessage("");
    };
    const onInstalled = () => {
      setInstalled(true);
      setPrompt(null);
      setMessage("Приложение установлено. Значок добавлен системой.");
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = async () => {
    if (installed) {
      setMessage("Приложение уже установлено на этом устройстве.");
      return;
    }

    if (prompt) {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === "accepted") {
        setMessage("Установка подтверждена. Значок появится среди приложений устройства.");
      } else {
        setMessage("Установка отменена.");
      }
      setPrompt(null);
      return;
    }

    if (isIOS) {
      setMessage("На iPhone/iPad: Safari → Поделиться → «На экран Домой». iOS не разрешает сайту установить значок без этого подтверждения.");
      return;
    }

    if (!window.isSecureContext) {
      setMessage("Для установки приложения нужна защищённая ссылка HTTPS. На текущем HTTP-адресе браузер не разрешает автоматическую установку.");
      return;
    }

    setMessage("Браузер пока не предлагает установку. Обновите страницу и попробуйте ещё раз.");
  };

  return <TabsContent value="install" className="space-y-5">
    <div>
      <p className="eyebrow">Приложение на любом устройстве</p>
      <h1 className="page-title">Установить «Русский Лес · Склад»</h1>
      <p className="page-description">Нажмите одну кнопку. Если устройство поддерживает PWA-установку, браузер сам добавит приложение и его значок после вашего подтверждения.</p>
    </div>

    <div className="install-hero panel">
      <div>
        <span className="glass-kicker"><MonitorSmartphone size={16} /> PWA-приложение</span>
        <h2>Установить склад на устройство</h2>
        <p>После установки приложение запускается отдельным окном и появляется среди приложений устройства.</p>
        <Button onClick={() => void install()} className="mt-5" disabled={installed}>
          <Download /> {installed ? "Уже установлено" : "Установить приложение"}
        </Button>
        {message && <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--muted-foreground)]">{message}</p>}
      </div>
      <Smartphone className="install-phone" />
    </div>

    <div className="grid gap-4 md:grid-cols-3">
      <article className="panel install-card"><b>iPhone и iPad</b><p>Safari → «Поделиться» → «На экран Домой». Apple требует это действие вручную.</p><Share /></article>
      <article className="panel install-card"><b>Android</b><p>Нажмите кнопку «Установить приложение» выше и подтвердите системное окно.</p><Download /></article>
      <article className="panel install-card"><b>Mac и Windows</b><p>В Chrome/Edge нажмите кнопку выше и подтвердите установку приложения.</p><MonitorSmartphone /></article>
    </div>

    <div className="panel flex items-start gap-3 p-5 text-sm leading-6 text-[var(--muted-foreground)]">
      <RefreshCw className="mt-0.5 shrink-0 text-[var(--primary)]" size={19} />
      <p><b className="text-[var(--foreground)]">Важно:</b> настоящая PWA-установка на компьютере и Android требует HTTPS. После подключения HTTPS кнопка будет работать в один клик с системным подтверждением.</p>
    </div>
  </TabsContent>;
}
