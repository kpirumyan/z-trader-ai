---
name: spec
description: Designs and drafts an architectural RFC specification (.agents/plans/specs/<name>.md) for any Z-Trader task (module, shared foundation, composition wiring, app shell, or refactor) through domain context ingestion, seam auditing, interactive developer interviews, and formal approval before implementation.
---

# Universal Specification Workflow (`spec`)

This skill executes **Session 1 (Design & RFC)** of the Z-Trader development pipeline. The agent operates as **System Architect / Tech Lead**, strictly responsible for designing an approved specification in `.agents/plans/specs/<name>.md` and maintaining architectural decision records in `docs/adr/`. Do not write production or test code in this session.

> [!NOTE]
> **Ephemeral Lifecycle**: Specifications in `.agents/plans/specs/<name>.md` are ephemeral task artifacts that guide Session 2 (`/build`) and are deleted upon task completion.

---

## Execution Steps

### Step 0: Context & Task Ingestion
1. Extract `<name>` from prompt or ask developer via `ask_question`. Determine task classification:
   - `module`: vertical domain slice / widget in `src/modules/<name>`.
   - `shared`: shared foundation capability in `src/shared/<path>` (`contracts`, `storage`, `theme`, `ui`, `lib`).
   - `composition`: multi-module orchestration / registry in `src/composition/`.
   - `app`: shell, routing, or global layout in `app/`.
   - `fix`: bugfix or targeted refactoring across existing units.
2. Read `docs/project-overview.md` and active decisions in `docs/adr/` to identify domain boundaries, architecture invariants, and binding constraints.

### Step 1: Audit Seams & Architectural Invariants
1. Scan existing code, shared contracts, UI primitives, and store patterns to ensure reuse and prevent duplicate implementations.
2. Verify whether the task complies with existing ADRs or requires an architectural invariant change.

### Step 2: Interactive Design Interview
Start with an **Opening Context Anchor**: a concise (2-3 sentences) statement framing the task's role in the terminal architecture (data flow subscriptions, widget/service type, or shared foundation layer).

Conduct an adaptive, context-driven interview using `ask_question`. Probe:
- Purpose, boundaries, constraints, and explicit non-goals.
- Public contract: exported symbols, TypeScript interfaces, and validation schemas.
- Core logic: store shape & actions (for modules), adapters/hooks (for shared), or reproduction steps (for bugfixes).
- UI presentation (if visual): layout, empty/loading/error states, and `DESIGN.md` tokens (mark `N/A` if non-visual).
- Behavioral test scenarios (Given-When-Then cases, boundary conditions, error recovery).
- Wiring point (`src/composition/widgets.ts`, `providers.ts`, or `none`) and Playwright E2E necessity.
- **Architectural Invariant Impact**: If the design alters system-wide patterns (cross-module boundaries, storage protocols, layer direction, or shared foundations), explicitly agree with the developer on an ADR revision before proceeding.

### Step 3: RFC Generation (`.agents/plans/specs/<name>.md`)
Write `.agents/plans/specs/<name>.md` following [spec-template.md](./resources/spec-template.md):
- Set frontmatter with `name`, `type`, `target_path`, and `status: draft`.
- Link relevant active ADRs in `Architectural Invariants`.
- Provide exact, compilable TypeScript code for public types and schemas (strictly in English; no pseudo-code or placeholders).
- Specify concrete Given-When-Then behavioral test scenarios.

### Step 4: ADR Lifecycle & Developer Approval
1. **ADR Reconciliation (Mandatory if system invariants changed)**:
   - When a design supersedes an existing ADR: draft replacement `docs/adr/<NNNN>-<name>.md`, move old approach to `## Rejected Alternatives`, delete superseded ADR, and update `docs/adr/README.md`.
   - When introducing a new system invariant: create a new numbered record in `docs/adr/` and add to `docs/adr/README.md`.
2. Present the RFC (and any ADR updates) to the developer via `ask_question`.
3. Upon approval, update frontmatter to `status: approved`.
4. Instruct the developer to open a **fresh chat session** and run `/build <name>` to begin multi-agent assembly.
