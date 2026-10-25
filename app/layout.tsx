import { GeistSans } from "geist/font/sans";
import { JetBrains_Mono } from "next/font/google";

import { THEME_STORAGE_KEY } from "./constants/storage";
import { DEFAULT_THEME } from "./constants/theme";

import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Z-Trader AI",
  description: "Z-Trader AI trading terminal",
  icons: { icon: "/logo.ico" },
};

// A parser-blocking script selects the theme before the body can be painted.
const initializeTheme = `(() => {
  let theme = '${DEFAULT_THEME}';
  try {
    const saved = window.localStorage.getItem('${THEME_STORAGE_KEY}');
    if (saved === 'light' || saved === 'dark') theme = saved;
  } catch {}
  document.documentElement.dataset.theme = theme;
})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      data-theme={DEFAULT_THEME}
      suppressHydrationWarning
      className={`${GeistSans.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: initializeTheme }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
