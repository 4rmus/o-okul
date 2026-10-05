import type { ReactNode } from "react";
import { IBM_Plex_Sans } from "next/font/google";
import { appBrand, appBrandTitle } from "../src/brand.js";
import { Providers } from "./providers.js";
import "./globals.css";

const bodyFont = IBM_Plex_Sans({
  display: "swap",
  subsets: ["latin", "latin-ext"],
  variable: "--font-ibm-plex-sans",
  weight: ["400", "500", "600", "700"],
});

// Paint öncesi tema: tarayıcıda saklı kullanıcı tercihi yoksa prefers-color-scheme (DEC-20260930-01).
const themeScript = `(function(){var d=document.documentElement;try{var t=localStorage.getItem("o-okul-theme");if(t!=="light"&&t!=="dark"){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}d.dataset.theme=t}catch(e){d.dataset.theme="light"}})();`;

export const metadata = {
  title: appBrandTitle,
  applicationName: appBrand.name,
  metadataBase: new URL(appBrand.siteUrl),
  description:
    "Özel okullar ve eğitim kurumları için deneme sonuçları, okul notu, devamsızlık, ödev ve ödeme planını tek öğrenci kaydında toplayan öğrenci takibi.",
  icons: {
    icon: "/icon.svg",
    apple: "/icons/apple-touch-icon.png",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html className={bodyFont.variable} data-theme="light" lang="tr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
