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
# Fast checks: formatting, types, lint, dependency-cruiser, knip, unit tests
pnpm check:fast

# Full suite: fast checks + Playwright E2E tests
pnpm check

# Unit tests only
pnpm test:unit

# Production build and run
pnpm build
pnpm start
```

## Architecture & Conventions

- **Domain Topology & Overview**: [docs/project-overview.md](docs/project-overview.md)
- **Architectural Decision Records**: [docs/adr/README.md](docs/adr/README.md)
- **UI Design System & Tokens**: [DESIGN.md](DESIGN.md)
- **Modular Codebase Rules**: [.agents/rules/codebase-layout.md](.agents/rules/codebase-layout.md)

## Commit Policy

Husky enforces that all commit messages are written strictly in English without Cyrillic characters.
