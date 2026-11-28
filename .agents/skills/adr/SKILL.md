---
name: adr
description: Architectural Decision Records (ADRs) management and governance for Z-Trader. Guides and enforces MADR 4.0 standards, active-decision querying, Git-anchored immutability, automated synchronization, and lifecycle workflows (create, supersede, deprecate, retarget, remove-path). Use whenever creating or reviewing architectural decisions, modifying module boundaries, consulting governing ADRs before changing a module, or checking ADR compliance with pnpm adr:check.
---

# Architectural Decision Records (ADR) Governance

This skill guides humans and AI agents in querying, authoring, superseding, and verifying Architectural Decision Records (ADRs) in **Z-Trader** according to the **MADR 4.0 (Markdown Architectural Decision Records)** standard with bidirectional machine-readable traceability.

## Core Principles

1. **Active vs. Historical Partitioning**:
   - Only active decisions (`status: "accepted"`) govern new code and CI path verification.
   - Historical records (`superseded by ADR-XXXX`, `deprecated`, `rejected`) remain permanent immutable records in `docs/adr/` to prevent broken links in code comments, PRs, and commit history.
2. **Git-Anchored Immutability**:
   - Once an ADR is committed in Git, its Markdown body and core identity metadata (`id`, `title`, `date`, `area`, `decision-makers`, `supersedes`) are immutable and verified directly against Git history (`HEAD` and branch `merge-base` locally; `ADR_BASE_REF` / PR base commit in GitHub CI).
   - Uncommitted draft ADRs created via `pnpm adr new` or `pnpm adr supersede` can be freely edited before committing—no separate lockfile or manual re-hashing is required.
   - To alter an already-committed architectural decision, always create a superseding record via `pnpm adr supersede`.
3. **Single Source of Truth**:
   - `applies_to` and `enforced_by` in frontmatter are the single authority.
   - Never edit table indexes in `docs/adr/README.md` or `## Governing ADRs` in `src/modules/*/README.md` manually; run `pnpm adr sync`.

---

## Agent Workflows

### 1. Pre-Task Discovery (Consult Governing ADRs)

Before modifying code in any governed path (e.g. `src/modules/chart`, `src/shared/storage`, `src/app`, `src/composition`, `.agents/tracing`), find the active architectural decisions governing it:

```bash
# Query active ADRs governing a module path
pnpm adr list --path src/modules/chart

# Query active ADRs governing any repo path
pnpm adr list --path src/shared/storage

# Query in machine-readable JSON format
pnpm adr list --path src/app --json
```

Or read the `## Governing ADRs` section in `src/modules/<name>/README.md` (for domain modules).

### 2. Creating a New Architectural Decision

When introducing a new architectural pattern, vertical slice, or global standard:

1. Run the CLI creation command:
   ```bash
   pnpm adr new --title "My New Architecture" --area "Architecture & Layout" --applies-to "src/modules/example,src/shared" --enforced-by "src/modules/example/tests/example.test.ts"
   ```
2. The CLI will:
   - Allocate the next sequential ID (e.g. `ADR-0008` in `docs/adr/0008-my-new-architecture.md`).
   - Populate the canonical MADR 4.0 template.
   - Synchronize `docs/adr/README.md` and module READMEs.
3. Edit the sections in `docs/adr/0008-my-new-architecture.md` to document the decision drivers, outcome, consequences, and rejected alternatives.
4. Run `pnpm adr sync` (if you updated `applies_to` or `status`) and verify compliance:
   ```bash
   pnpm adr:check
   ```

### 3. Superseding an Existing Decision

When an architectural decision is replaced, modified, or evolved:

1. Scaffold the superseding record from the existing ADR:

   ```bash
   pnpm adr supersede ADR-0001 --title "Modular Architecture v2" --area "Architecture & Layout"
   ```

   The CLI automatically:

   - Creates `docs/adr/0008-modular-architecture-v2.md` with `supersedes: "ADR-0001"`, seeding its body from `ADR-0001` (with an updated H1 title and `Supersedes [ADR-0001](./...)` prepended to `## Context and Problem Statement`) so existing drivers, invariants, checks, consequences, and rejected alternatives are preserved as the starting draft.
   - Updates `ADR-0001` frontmatter with `status: "superseded by ADR-0008"` and `superseded_by: "ADR-0008"` (leaving the old body untouched).
   - Runs `pnpm adr sync` to reflect the change across all documentation.

2. Edit the seeded draft in place so the new ADR is **fully self-contained**:

   - Keep every still-valid invariant, enforcement gate, negative consequence, and rejected alternative from the superseded ADR.
   - For every rule, check, risk, or alternative that is intentionally changed or removed, explicitly state what changed and why (never silently drop items or rely on blanket statements like `"preserves all invariants of ADR-XXXX"`).

3. **Run the mandatory clean-context Supersede Audit** before finalizing and presenting the change:

   - Launch an independent read-only subagent with a **clean context** (e.g., `research`) using the prompt in [references/supersede-auditor-prompt.txt](references/supersede-auditor-prompt.txt), passing **only** `<OLD_ADR_PATH>` and `<NEW_ADR_PATH>`.
   - If the verdict is `FAIL`, fix every finding in `<NEW_ADR_PATH>` (either restore the lost/weakened item or explicitly document its removal and rationale) and re-run the clean-context audit until the verdict is `PASS`.
   - Run `pnpm adr sync` (if frontmatter changed) and `pnpm adr:check`, and include the auditor's compact coverage summary (`PRESERVED` / `EXPLICITLY_CHANGED`) when reporting back to the user.

### 4. Renaming or Moving a Module Path

When a module or directory path is renamed or relocated:

```bash
pnpm adr retarget src/modules/old-name src/modules/new-name
```

Updates `applies_to` and `enforced_by` across all active ADRs and re-synchronizes indexes without modifying committed ADR bodies.

### 5. Removing a Module Path

When a module is deleted:

```bash
pnpm adr remove-path src/modules/legacy-name
```

- If an ADR exclusively governed this path, it is automatically marked `status: "deprecated"` (allowed only once the governed `applies_to` paths are deleted from disk).
- If an ADR governed multiple paths, only the deleted path is removed (allowed only for paths deleted from disk).

### 6. Verifying Compliance & Consistency

Before committing or finishing changes, execute the verification gate:

```bash
pnpm adr:check
```

This verifies:

- Frontmatter schema (id, title, status, date, decision-makers, area, applies_to, enforced_by) and filename ID prefix.
- Strict ordering of all 6 canonical MADR 4.0 H2 sections.
- Bidirectional superseding links (`supersedes`, `superseded_by`, `status`).
- Filesystem existence of `applies_to` and `enforced_by` for active decisions.
- Git-anchored immutability of committed ADR bodies, immutable metadata fields, and protected `applies_to`/`enforced_by`/deprecation rules (checked against `HEAD` + branch `merge-base` locally, or `--base` / `ADR_BASE_REF` in CI).
- Zero drift in `docs/adr/README.md` and module READMEs.

---

## Canonical MADR 4.0 Section Ordering

Every ADR must contain these 6 H2 sections in exact sequence:

1. `## Context and Problem Statement`
2. `## Decision Drivers`
3. `## Decision Outcome`
4. `## Confirmation and Enforcement`
5. `## Consequences`
6. `## Rejected Alternatives`

For complete frontmatter attributes and section templates, see [madr-template.md](references/madr-template.md).
