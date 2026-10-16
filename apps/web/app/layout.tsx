import type { ReactNode } from "react";
import localFont from "next/font/local";
import { appBrand, appBrandTitle } from "../src/brand.js";
import { Providers } from "./providers.js";
import "./globals.css";

// IBM Plex Sans ships with the repo (SIL OFL 1.1, app/fonts/OFL.txt) so the build never fetches Google Fonts:
// the Google loader fails the Turbopack build when Google answers with extensionless /l/font?kit= URLs
// (vercel/next.js#99114). The complete cut covers latin and latin-ext, Turkish included.
const bodyFont = localFont({
  display: "swap",
  src: [
    { path: "./fonts/IBMPlexSans-Regular.woff2", style: "normal", weight: "400" },
    { path: "./fonts/IBMPlexSans-Medium.woff2", style: "normal", weight: "500" },
    { path: "./fonts/IBMPlexSans-SemiBold.woff2", style: "normal", weight: "600" },
    { path: "./fonts/IBMPlexSans-Bold.woff2", style: "normal", weight: "700" },
  ],
  variable: "--font-ibm-plex-sans",
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
