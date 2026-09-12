"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, MonitorSmartphone, RefreshCw, Share, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferredInstallPrompt: InstallPromptEvent | null = null;
let installPromptListenerReady = false;

function rememberInstallPrompt(event: Event) {
  event.preventDefault();
  deferredInstallPrompt = event as InstallPromptEvent;
  window.dispatchEvent(new CustomEvent("warehouse-install-ready"));
}

export function PwaRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js");

    if (!installPromptListenerReady) {
      window.addEventListener("beforeinstallprompt", rememberInstallPrompt);
      installPromptListenerReady = true;
    }
  }, []);
  return null;
}

export function InstallGuide() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(deferredInstallPrompt);
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
    setPrompt(deferredInstallPrompt);

    const onReady = () => {
      setPrompt(deferredInstallPrompt);
      setMessage("");
    };
    const onInstalled = () => {
      deferredInstallPrompt = null;
      setInstalled(true);
      setPrompt(null);
      setMessage("Приложение установлено. Значок добавлен системой.");
    };

    window.addEventListener("warehouse-install-ready", onReady);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("warehouse-install-ready", onReady);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = async () => {
    if (installed) {
      setMessage("Приложение уже установлено на этом устройстве.");
      return;
    }

    const currentPrompt = prompt || deferredInstallPrompt;
    if (currentPrompt) {
      await currentPrompt.prompt();
      const choice = await currentPrompt.userChoice;
      if (choice.outcome === "accepted") {
        setMessage("Установка подтверждена. Значок появится среди приложений устройства.");
      } else {
        setMessage("Установка отменена.");
      }
      deferredInstallPrompt = null;
      setPrompt(null);
      return;
    }

    if (isIOS) {
      setMessage("На iPhone/iPad: Safari → Поделиться → «На экран Домой». iOS не разрешает сайту установить значок без этого подтверждения.");
      return;
    }

    if (!window.isSecureContext) {
      setMessage("Для установки приложения нужна защищённая ссылка HTTPS.");
      return;
    }

    setMessage("Chrome ещё не выдал разрешение на установку. Останьтесь на сайте около 30 секунд, нажмите любую кнопку и затем повторите установку.");
  };

  return <TabsContent value="install" className="space-y-5">
    <div>
      <p className="eyebrow">Приложение на любом устройстве</p>
      <h1 className="page-title">Установить «Русский Лес · Склад»</h1>
      <p className="page-description">Нажмите одну кнопку. Если устройство поддерживает PWA-установку, браузер откроет системное окно подтверждения.</p>
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
      <p><b className="text-[var(--foreground)]">Важно:</b> сайт уже работает по HTTPS. Chrome сам решает, когда выдать системное разрешение на установку; наша кнопка теперь сохраняет это разрешение даже если оно появилось до открытия вкладки «Установка».</p>
    </div>
  </TabsContent>;
}
