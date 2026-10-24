---
name: spec-module
description: Designs and drafts an architectural RFC specification (docs/specs/<name>.md) for a new Z-Trader module through domain context ingestion, shared seam auditing, interactive developer interviews, and formal approval before implementation.
---

# Module Specification Workflow (`spec-module`)

This skill executes **Session 1 (Design & RFC)** of the Z-Trader modular development pipeline. The agent operates as **System Architect**, strictly responsible for designing an approved module specification in `docs/specs/<name>.md` and maintaining architectural decision records in `docs/adr/`. Do not write production or test code in this session.

---

## Execution Steps

### Step 0: Context & ADR Ingestion
1. Extract `<module-name>` from the prompt or ask the developer if omitted.
2. Read `docs/project-overview.md` and active decisions in `docs/adr/` to identify domain boundaries, architecture invariants, and binding constraints.

### Step 1: Audit Public Seams in `src/shared/` & ADR Alignment
1. Scan `src/shared/` to inspect existing foundation contracts, UI primitives, storage adapters, theme tokens, and utilities.
2. Verify whether the module complies with existing ADRs or requires an architectural invariant change.

### Step 2: Interactive Design Interview
Start the interview with an **Opening Context Anchor**: a concise (2-3 sentences) statement framing the module's role in the terminal (data flow subscriptions, widget/service type, and composition registry point in `src/composition/`).

Conduct an adaptive, context-driven interview using `ask_question`. Probe:
- Domain responsibilities, constraints, and explicit non-goals.
- Public contract: exported symbols, TypeScript interfaces, and validation schemas.
- Internal state management, store shape, actions, and data subscriptions.
- UI components, layout, states (empty, loading, error, active), and `DESIGN.md` tokens.
- Behavioral test scenarios (happy paths, boundary conditions, recovery).
- Composition registration point (`src/composition/`) and Playwright E2E necessity.
- **Architectural Invariant Impact**: If the design alters system-wide patterns (cross-module boundaries, storage protocols, layer direction, or shared foundations), explicitly agree with the developer on an ADR revision before proceeding.

### Step 3: RFC Generation (`docs/specs/<name>.md`)
Write `docs/specs/<name>.md` following [spec-template.md](./resources/spec-template.md):
- Set frontmatter with `status: draft`.
- Link relevant active ADRs in `Architectural Invariants`.
- Provide exact, compilable TypeScript code for public types and schemas (no pseudo-code or placeholders).
- Specify concrete Given-When-Then behavioral test scenarios.

### Step 4: ADR Lifecycle & Developer Approval
1. **ADR Reconciliation (Mandatory if system invariants changed)**:
   - When a design supersedes an existing ADR: draft the replacement `docs/adr/<NNNN>-<name>.md`, move the old approach and rationale into `## Rejected Alternatives`, delete the superseded ADR file, and update `docs/adr/README.md`.
   - When introducing a new system-wide invariant: create a new numbered record in `docs/adr/` and add it to `docs/adr/README.md`.
2. Present the RFC (and any ADR updates) to the developer via `ask_question`.
3. Upon approval, update frontmatter to `status: approved`.
4. Instruct the developer to open a **fresh chat session** and run `/build-module <name>` to begin multi-agent assembly.
