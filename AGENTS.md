# Z-Trader

Multi-window trading and market-analysis terminal (charts, order book, time & sales, indicators). All code is written by AI agents: you own each task end-to-end, including tests and verification.

## Stack

- pnpm · Next.js 16 · React 19 (React Compiler) · TypeScript
- Charts: lightweight-charts v5 (TradingView)
- Styling: CSS Modules · clsx (no Tailwind / UI kits)
- State: Zustand 5 (domain-scoped stores) · Validation: Zod 4 at system boundaries (market-data ingress, storage persistence)
- Tests: Vitest 5 + Testing Library (unit, integration) · Playwright (E2E)
- Boundaries & hygiene: dependency-cruiser · ESLint · Knip
- Agent observability: Langfuse

## Rules

- Never treat an ADR as the absolute, final authority. You should always follow best practices. If your decisions conflict with an ADR, you must bring the matter up for discussion.
- A change is done only when `pnpm check:docs` passes for changes limited to `docs/` and `*.md` files, or `pnpm check:fast` passes for any other change; UI or user-flow changes also require `pnpm test:e2e`.

## Context Map

Open a file only when its trigger applies; treat links inside it the same way.

- [ARCHITECTURE.md](ARCHITECTURE.md) — brainstorming or designing a solution; adding a new feature or refactoring; changing cross-module data flow; creating, moving or deleting files; locating where code lives.
- [docs/adr/README.md](docs/adr/README.md) — before proposing/designing an approach or changing a module's behavior, dependencies, patterns, or cross-module contracts (check active rules and prior accepted/rejected/superseded decisions); making or reversing an architectural decision.
- [DESIGN.md](DESIGN.md) — changing anything visible: styles, colors, typography, layout, component appearance, logos.
- [PLANS.md](PLANS.md) — only when the user explicitly refers to a plan, roadmap, or this file.
- [TASKS.md](TASKS.md) — only when the user explicitly asks to check, pick up from, or update the task list / backlog.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
