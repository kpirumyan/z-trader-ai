# Z-Trader AI — Design Guidelines

This document defines the visual rules for the terminal. The source of brand colors is the logo files in `public/`. The interface is English-first; text examples for buttons, menus, states, and tooltips must also be in English.

## Brand Identity

- Shape: Four candlesticks and an ascending gold arrow. Mood — precision, momentum, and calm confidence, without decorative "crypto" glows around the interface.
- Light theme: Use `public/logo.png` or `public/brand.png`. The dark parts of the symbol and wordmark remain near-black.
- Dark theme: Use `public/logo-dark.png` or `public/brand-dark.png`. **On dark backgrounds, all near-black parts of the logo and wordmark must be white.** The gold arrow and gold portion of the wordmark preserve their color. Never place the light version of the logo onto a dark surface.
- Use `logo*.png` for the standalone mark, and `brand*.png` for the horizontal wordmark. Preserve the PNG proportions and transparency; do not recolor the entire mark with a single CSS filter.

## Color System

The logo consists of near-black, white, and warm gold. Below are the interface tokens based on them. Gold in the source PNGs has subtle gradients and anti-aliasing variations; token values represent normalized UI colors rather than claims about every individual pixel.

| Role             | Light Theme | Dark Theme | Application                                       |
| ---------------- | ----------- | ---------- | ------------------------------------------------- |
| `canvas`         | `#FFFFFF`   | `#0E0E0E`  | Workspace background                              |
| `surface`        | `#F7F7F7`   | `#1A1A1A`  | Chart windows and panels                          |
| `surface-raised` | `#EFEFEF`   | `#242424`  | Active panels, menus, popovers                    |
| `text-primary`   | `#0E0E0E`   | `#FFFFFF`  | Primary text and icons                            |
| `text-secondary` | `#555555`   | `#BDBDBD`  | Secondary labels                                  |
| `border`         | `#D8D8D8`   | `#393939`  | Subtle dividers and borders                       |
| `grid`           | `#E9E9E9`   | `#2B2B2B`  | Chart grid lines                                  |
| `brand-gold`     | `#F5A600`   | `#FFB700`  | Brand accent, active instrument, key focus marker |
| `on-gold`        | `#0E0E0E`   | `#0E0E0E`  | Text placed over gold fills                       |

Gold must serve as an accent, not as large background fills. Black in the dark theme serves solely as background and as text color over gold fills; regular text, icons, and dark logo elements become white. In charts, do not encode candlestick direction by color alone: preserve fill vs. outline distinctions and accessible value labels.

## Typography & Density

- Primary interface: Geist or system sans-serif; numerical values, prices, time, and chart axes: JetBrains Mono or system monospace.
- Working text size: 13–14px; secondary labels: 11–12px; window titles: 14–16px. Align prices and time so numerals do not jitter on updates.
- Preserve terminal compactness without crowding: interactive elements must have clearly visible borders, hover states, and focus indicators.

## Terminal Layout

- The workspace prioritizes desktop displays. Independent candlestick chart windows occupy primary focus; toolbars and instrument search remain accessible without occluding charts.
- Each window clearly displays title, instrument, timeframe, and active state. Highlight active windows with a subtle gold line or marker, not a heavy colored fill.
- Axes, grid, and indicators must be visually quieter than price action. Separate surfaces with fine borders and subtle contrast shifts; heavy drop shadows are forbidden.
- Loading, empty data, and error states must render within the corresponding window; recovery actions and messages must remain legible in both themes.

## Components & Interactions

- Buttons and menus: Neutral surface, white text in dark theme, near-black in light theme. Gold indicates selection, active instrument, and primary emphasis.
- Search inputs and settings: Distinct borders, noticeable cursor, visible focus ring. Never rely solely on color to indicate selection.
- Chart drawing tools: Distinct cursor shapes and preview indicators. Undo and redo must be predictable.
- Motion: Brief and functional (100–150ms transitions for menus and selections); streaming market updates must never animate the entire viewport.
- Verify readability of text, icons, grid lines, and selection markers against real chart backgrounds in both themes. A design document does not replace verification on the running UI.

## Scope of Application

This is a visual specification for terminal UI development and future refactoring. Logo sources: `public/logo.png`, `public/logo-dark.png`, `public/brand.png`, `public/brand-dark.png`.
