import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/warehouse",
    name: "Русский Лес — Склад",
    short_name: "РЛ Склад",
    description: "Приёмка, адресное хранение и выдача материалов",
    start_url: "/warehouse",
    display: "standalone",
    background_color: "#e9eef8",
    theme_color: "#111827",
    lang: "ru",
    prefer_related_applications: false,
    icons: [
      { src: "/app-icon.svg", sizes: "192x192", type: "image/svg+xml", purpose: "any" },
      { src: "/app-icon.svg", sizes: "512x512", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
