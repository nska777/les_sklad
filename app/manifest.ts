import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Русский Лес — Склад",
    short_name: "РЛ Склад",
    description: "Приёмка, адресное хранение и выдача материалов",
    start_url: "/",
    display: "standalone",
    background_color: "#e9eef8",
    theme_color: "#111827",
    lang: "ru",
    icons: [
      { src: "/app-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
