# Z-Trader

**Z-Trader** is a high-performance, multi-window financial trading and market analysis terminal (charts, order book, time & sales, indicators) running in Next.js.

## Architecture & Conventions

- **Domain Topology & Overview**: [docs/project-overview.md](docs/project-overview.md)
- **Architectural Decision Records**: [docs/adr/README.md](docs/adr/README.md)
- **UI Design System & Tokens**: [DESIGN.md](DESIGN.md)
- **Modular Codebase Rules**: [.agents/rules/codebase-layout.md](.agents/rules/codebase-layout.md)

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
