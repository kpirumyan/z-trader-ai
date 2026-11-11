# Z-Trader

**Z-Trader** is a high-performance, multi-window financial trading and market analysis terminal (charts, order book, time & sales, indicators) running in Next.js.

## Technology Stack

- **Core Framework & Language**: Next.js & TypeScript
- **Boundary Validation**: Zod (runtime validation at system boundaries: ingress market streaming and storage persistence)
- **State Management**: Zustand (modular, domain-scoped stores)
- **Testing**: Vitest (unit & integration testing) and Playwright (end-to-end browser automation)
- **Architectural Boundaries & Hygiene**: `dependency-cruiser` & `eslint-plugin-boundaries` (architectural boundary governance), Knip (unused dependency & dead code elimination)
- **AI Infrastructure**: Langfuse (tracing & observability) and Promptfoo (evaluations & automated prompt testing)

## Autonomous Zero-Code Development

Z-Trader is engineered entirely by AI agents without manual code authoring. Engineering operates as a self-improving flywheel:

- **Autonomous Execution**: Agents deliver end-to-end tasks against strict ADRs and modular perimeters.
- **Deep Tracing**: Langfuse captures complete reasoning trajectories, tool invocations, and LLM telemetry.
- **Automated Evals**: Vitest, Playwright, and Promptfoo enforce quality gates and catch regressions.
- **Distilled Memory**: Edge cases, failure modes, and architectural decisions persist into rules, skills, and ADRs.
- **Compounding Flywheel**: Evaluation feedback and trace insights continuously refine agent context, compounding accuracy and velocity.

## Architecture & Conventions

- **Domain Topology & Overview**: [docs/project-overview.md](docs/project-overview.md)
- **Architectural Decision Records**: [docs/adr/README.md](docs/adr/README.md)
- **UI Design System & Tokens**: [DESIGN.md](DESIGN.md)
- **Modular Codebase Rules**: [.agents/rules/codebase-layout.md](.agents/rules/codebase-layout.md)

## Core Reasoning Rules

- Think carefully & step-by-step.
- Consider whether the answer may have changed in the 2 years since your knowledge cutoff.
- If you are not confident in your answer, begin your response with "Unsure".

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
