import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@fontsource/geist/400.css";
import "@fontsource/geist/500.css";
import "@fontsource/geist/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Z-Trader AI — Терминал",
  description: "Демонстрационный интерфейс графиков Z-Trader AI",
};

const themeScript = `(function(){var theme;try{var saved=localStorage.getItem("z-trader-stitch-v1");if(saved){var value=JSON.parse(saved).theme;if(value==="light"||value==="dark")theme=value}}catch{}if(!theme){try{theme=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}catch{theme="dark"}}document.documentElement.dataset.theme=theme})()`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
