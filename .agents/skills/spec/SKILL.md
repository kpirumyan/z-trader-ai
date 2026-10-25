---
name: spec
description: Designs and drafts architectural RFC task specifications and records decision invariants.
---

# Universal Specification Workflow (`spec`)

This skill executes **Session 1 (Design & RFC)** of the Z-Trader development pipeline. The agent operates as **System Architect / Tech Lead**, strictly responsible for designing an approved specification in `.agents/plans/specs/<name>.md` and maintaining architectural decision records in `docs/adr/`.

> [!NOTE]
> **Ephemeral Lifecycle**: Specifications in `.agents/plans/specs/<name>.md` are ephemeral task artifacts that guide Session 2 (`/build`) and are deleted upon task completion.

---

## Execution Steps

### Step 0: Context & Task Ingestion
1. Extract `<name>` from prompt. If `<name>` is omitted, read `.agents/plans/tasks.md` to identify the first unchecked (`- [ ]`) task and propose it to the developer via `ask_question`. Determine task classification:
   - `module`: vertical domain slice / widget in `src/modules/<name>`.
   - `shared`: shared foundation capability in `src/shared/<path>` (`contracts`, `storage`, `theme`, `ui`, `lib`).
   - `composition`: multi-module orchestration / registry in `src/composition/`.
   - `app`: shell, routing, or global layout in `app/`.
   - `fix`: bugfix or targeted refactoring across existing units.
2. Read `.agents/plans/tasks.md`, `docs/project-overview.md`, and active decisions in `docs/adr/` to identify domain boundaries, architecture invariants, and binding constraints.

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
- Provide exact, compilable TypeScript code strictly for public contracts in Section 2 (`types.ts`, `index.ts`, and optionally `schema.ts`, `constants.ts`). For shared utilities or units without domain schemas or immutable configs, mark `schema.ts` and `constants.ts` as `N/A: Non-applicable`; never invent artificial schemas (e.g. key string validators) or dummy configs just to satisfy template slots.
- Do not write implementation code, function bodies, JSX/TSX markup, or full CSS stylesheets in Sections 3 and 4, nor executable tests in Section 5. Specify state models, action signatures, lifecycles, and Given-When-Then scenarios in prose or interfaces.
- Specify concrete Given-When-Then behavioral test scenarios applying Anti-Tautology invariants (strictly no static type checks and no external library feature suites; focus on state mutations, custom transforms, and contract seams).

### Step 4: ADR Lifecycle & Developer Approval
1. **ADR Reconciliation (Mandatory if system invariants changed)**:
   - When a design supersedes an existing ADR: draft replacement `docs/adr/<NNNN>-<name>.md`, move old approach to `## Rejected Alternatives`, delete superseded ADR, and update `docs/adr/README.md`.
   - When introducing a new system invariant: create a new numbered record in `docs/adr/` and add to `docs/adr/README.md`.
2. Present the RFC (and any ADR updates) to the developer via `ask_question`:
   - Include a direct clickable markdown link to the generated specification file (`[.agents/plans/specs/<name>.md](file:///<workspace-root>/.agents/plans/specs/<name>.md)`) and any touched ADRs in the question text so the developer can open and inspect the specification with one click before approving.
   - Summarize key architectural decisions, public contract shapes, and test scenarios.
3. Upon approval, update frontmatter to `status: approved`.
4. Instruct the developer to open a **fresh chat session** and run `/build <name>` to begin multi-agent assembly.
