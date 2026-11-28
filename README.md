# Z-Trader AI

High-performance, multi-window financial trading and market analysis terminal (charts, order book, time & sales, indicators) built with Next.js and TypeScript.

## Quick Start

```sh
pnpm install
pnpm dev
```

Development server runs at: `http://localhost:3000` (or `http://127.0.0.1:3000`).

## Verification & Build

```sh
# Fast parallel checks: formatting, types, lint, CSS/MD lint, depcruise, knip, ADRs, unit tests
pnpm check:fast

# Docs-only checks: formatting, Markdown lint, ADR governance
pnpm check:docs

# Code-only static checks: typecheck, lint, CSS lint, depcruise, knip
pnpm check:code

# Full suite: fast checks + Playwright E2E tests
pnpm check

# Unit tests only
pnpm test:unit

# Production build and run
pnpm build
pnpm start
```
