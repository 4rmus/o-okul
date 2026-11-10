import type { ReactNode } from "react";
import localFont from "next/font/local";
import { appBrand, appBrandTitle } from "../src/brand.js";
import { appearanceBootstrapScript } from "../src/appearance.js";
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

// Customer-workspace fonts remain local and load only when the Campus shell uses them.
const campusBodyFont = localFont({
  display: "swap",
  preload: false,
  src: "./fonts/Manrope-Variable.ttf",
  weight: "200 800",
  style: "normal",
  variable: "--font-manrope",
});
const campusDisplayFont = localFont({
  display: "swap",
  preload: false,
  src: "./fonts/Fraunces-Variable.ttf",
  weight: "100 900",
  style: "normal",
  variable: "--font-fraunces",
});

const boardBodyFont = localFont({
  display: "swap",
  preload: false,
  src: "./fonts/ShantellSans-Variable.woff2",
  weight: "300 800",
  style: "normal",
  variable: "--font-shantell-sans",
});
const boardDisplayFont = localFont({
  display: "swap",
  preload: false,
  src: [
    { path: "./fonts/Kalam-Regular.woff2", style: "normal", weight: "400" },
    { path: "./fonts/Kalam-Bold.woff2", style: "normal", weight: "700" },
  ],
  variable: "--font-kalam",
});

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
    <html className={`${bodyFont.variable} ${campusBodyFont.variable} ${campusDisplayFont.variable} ${boardBodyFont.variable} ${boardDisplayFont.variable}`} data-appearance="whiteboard" data-theme="light" lang="tr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: appearanceBootstrapScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
