import type { MetadataRoute } from "next";
import { appBrand } from "../src/brand.js";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: appBrand.name,
    short_name: appBrand.name,
    description: "Eğitim kurumları için öğrenci takip ve kurum yönetim platformu.",
    start_url: "/",
    display: "standalone",
    background_color: "#eef2ff",
    theme_color: "#155eef",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
