import type { MetadataRoute } from "next";
import { appBrand } from "../src/brand.js";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: appBrand.name,
    short_name: appBrand.name,
    description: "Eğitim kurumları için öğrenci takip ve kurum yönetim platformu.",
    // KV-5: installable app for every role; "/" lets the post-login role redirect pick the portal.
    // No service-worker cache (offline is out of scope); push-sw.js only shows pushes.
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#eef2ff",
    theme_color: "#155eef",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
