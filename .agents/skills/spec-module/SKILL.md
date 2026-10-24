---
name: spec-module
description: Designs and drafts an architectural RFC specification (docs/specs/<name>.md) for a new Z-Trader module through domain context ingestion, shared seam auditing, interactive developer interviews, and formal approval before implementation.
---

# Module Specification Workflow (`spec-module`)

This skill executes **Session 1 (Design & RFC)** of the Z-Trader modular development pipeline. It is strictly scoped to producing an approved specification in `docs/specs/<name>.md`; do not write production or test code in this session.

---

## Execution Steps

### Step 0: Context Ingestion
1. Extract `<module-name>` from the prompt or ask the developer if omitted.
2. Read the project overview document (`docs/project-overview.md`) and architectural decisions (`docs/adr/`) to understand domain boundaries and terminal concepts.

### Step 1: Audit Public Seams in `src/shared/`
Scan `src/shared/` to inspect existing foundation contracts, UI primitives, storage adapters, theme tokens, and utilities. Identify reusable abstractions and verify whether any foundational seam needs to be leveraged.

### Step 2: Interactive Design Interview
Start the interview with an **Opening Context Anchor**: a concise (2-3 sentences) statement framing the module's role in the terminal (data flow subscriptions, widget/service type, and composition registry point in `src/composition/`).

Then conduct an adaptive, context-driven interview (in the style of `/grill-me`) using `ask_question`. Do not recite a static questionnaire; instead, actively probe the specific task, propose concrete technical choices, and resolve ambiguities across:
- Domain responsibilities, constraints, and explicit non-goals.
- Public contract: exported symbols, TypeScript interfaces, and validation schemas.
- Internal state management, store shape, actions, and data subscriptions.
- UI components, layout, states (empty, loading, error, active), and `DESIGN.md` tokens.
- Behavioral test scenarios (happy paths, boundary conditions, recovery).
- Composition registration point (`src/composition/`) and need for Playwright E2E coverage.

### Step 3: RFC Generation (`docs/specs/<name>.md`)
Write `docs/specs/<name>.md` following [spec-template.md](./resources/spec-template.md):
- Set frontmatter with `status: draft`.
- Provide exact, compilable TypeScript code for public types and schemas (no pseudo-code or placeholders).
- Specify concrete Given-When-Then behavioral test scenarios.

### Step 4: Developer Approval & Session Handoff
1. Present the RFC to the developer for confirmation or refinement via `ask_question`.
2. Upon approval, update frontmatter to `status: approved`.
3. Instruct the developer to open a **fresh chat session** and run `/build-module <name>` to begin multi-agent assembly.
