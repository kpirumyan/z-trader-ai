---
id: "ADR-0013"
title: "Path-Scoped Executable ADR Governance via Repo and CI Gates"
status: "superseded by ADR-0014"
date: "2026-11-27"
decision-makers:
  - "Product Owner"
  - "Architect Agent"
area: "Tooling & Governance"
applies_to:
  - "docs/adr"
  - ".agents/skills/adr"
enforced_by:
  - ".agents/skills/adr/scripts/adr-cli.ts"
  - ".agents/skills/adr/tests/adr-cli.test.ts"
  - "scripts/check.ts"
  - "package.json"
  - ".github/workflows/ci.yml"
supersedes: "ADR-0011"
superseded_by: "ADR-0014"
---

# ADR-0013: Path-Scoped Executable ADR Governance via Repo and CI Gates

## Context and Problem Statement

Supersedes [ADR-0011](./0011-path-scoped-executable-adr-governance.md).

[ADR-0000](./0000-executable-adr-governance.md) established Hybrid MADR 4.0 governance to solve three failure modes of prose-only ADRs (Retrieval Blindness, Traceability Drift, and Unverified Invariants) using `adr-cli.mjs`, module-only discovery (`pnpm adr:list --module <name>`), and staged-file triggering via `.lintstagedrc.json`. [ADR-0011](./0011-path-scoped-executable-adr-governance.md) upgraded the CLI to TypeScript (`adr-cli.ts`), introduced `--path` discovery, added `git HEAD` frontmatter anchoring, and moved `pnpm adr:check` into `.husky/pre-commit` before GitHub Actions CI existed.

With `.github/workflows/ci.yml` and the parallel repo runner (`scripts/check.ts`) now enforcing `pnpm adr:check` on every `check:docs`, `check:fast`, `check`, and CI run, running `pnpm adr:check` unconditionally in `.husky/pre-commit` duplicates work and breaks partial (`git add -p`) commits.

How should Z-Trader maintain path-scoped executable ADR discovery and tamper-resistant governance while aligning `pnpm adr:check` enforcement with the repository-wide and GitHub CI gates?

## Decision Drivers

- **Zero-Token-Waste Arbitrary Repo-Path Discovery**: Agents must be able to query only active (`accepted`) ADRs for any repository path (`src/modules/chart`, `src/shared/storage`, `src/app`, `.agents/tracing`) via a single `--path` interface without reading unrelated ADRs into context.
- **Single Source of Truth (SSOT) Without Manual Sync**: Index tables in `docs/adr/README.md` and `## Governing ADRs` sections in `src/modules/*/README.md` must be derived deterministically from ADR frontmatter.
- **Historical Immutability with Safe Module Evolution**: Superseded and deprecated ADRs must remain immutable historical records in `docs/adr/` with stable Markdown URLs, and retiring or renaming a module must never break CI checks on historical records.
- **TypeScript Tooling Alignment**: The ADR CLI runs natively as TypeScript (`.agents/skills/adr/scripts/adr-cli.ts`) consistent with the rest of the repository and test suite.
- **Mechanical Verification in Repo & CI Gates Without Pre-Commit Duplication**: Every active ADR must link to existing `applies_to` and `enforced_by` targets, verified unconditionally in `pnpm check:docs`, `pnpm check:fast`, `pnpm check`, and `.github/workflows/ci.yml` (both docs-only and code-change runs). (**Intentional Change from ADR-0011**: removes unconditional `pnpm adr:check` from `.husky/pre-commit` so partial commits work cleanly and local commits are not slowed by repo-wide checks already enforced in Stage 3 and Stage 4 CI.)
- **Tamper-Resistant Frontmatter Lifecycle**: Active (`accepted`) ADRs must remain protected against premature deprecation or removal of active `enforced_by` gates.

## Decision Outcome

Chosen option: **TypeScript ADR CLI (`adr-cli.ts`) with Path-Scoped Discovery (`--path`), Git `HEAD` Frontmatter Anchoring, and Unconditional Stage 3 (`scripts/check.ts`) + Stage 4 (`.github/workflows/ci.yml`) Enforcement**, preserving the MADR 4.0 flat immutable log and SHA-256 body lock introduced in [ADR-0000](./0000-executable-adr-governance.md).

### 1. Hybrid MADR 4.0 Schema, Flat Immutable Log & Active-Only Path Verification

- Every ADR in `docs/adr/XXXX-<slug>.md` begins with machine-parsable YAML frontmatter (`id` (`"ADR-XXXX"`), `title`, `status` (`"proposed"` | `"accepted"` | `"rejected"` | `"deprecated"` | `"superseded by ADR-YYYY"`), `date` (`"YYYY-MM-DD"`), `decision-makers`, `area`, `applies_to` (governed repo-relative paths), `enforced_by` (linter configs, schemas, or test files), `supersedes`, `superseded_by`) and six canonical MADR 4.0 H2 sections in strict sequence:
  1. `## Context and Problem Statement`
  2. `## Decision Drivers`
  3. `## Decision Outcome`
  4. `## Confirmation and Enforcement`
  5. `## Consequences`
  6. `## Rejected Alternatives`
- **Flat Immutable Log**: All ADRs remain permanently in `docs/adr/` regardless of lifecycle status so relative Markdown links (`./000X-*.md`) in code comments, commits, PR discussions, and other ADRs never break.
- **Active vs. Historical Split & Single Source of Truth**: Frontmatter `applies_to` in active ADRs is the sole authority. `pnpm adr:sync` deterministically regenerates `docs/adr/README.md`—partitioned into **Active Decisions Index** (`accepted` / `proposed`) and **Historical Decisions Index** (`superseded` / `deprecated` / `rejected`)—and `## Governing ADRs` in every `src/modules/<name>/README.md`.
- **Active-Only Path Verification**: `pnpm adr:check` enforces filesystem existence of `applies_to` and `enforced_by` paths strictly on `status: "accepted"` ADRs (each active ADR must also declare at least one `enforced_by` artifact). Historical (`superseded` or `deprecated`) ADRs preserve the historical paths of deleted modules without failing CI.

### 2. Path-Scoped Discovery (`pnpm adr:list --path <path>`)

- Uses `--path <path>` (`getGoverningAdrsForPath` / `matchesGovernancePath` in `.agents/skills/adr/scripts/adr-cli.ts`), matching exact paths, ancestor directories, and child paths across any governed location in the repository.
- Supports `--all` and `--json` for deterministic agent consumption before editing any governed area.

### 3. TypeScript CLI & Git `HEAD` Integrity Anchoring

- Implements all ADR lifecycle commands (`list`, `check`, `sync`, `new`, `supersede`, `deprecate`, `retarget`, `remove-path`) in `.agents/skills/adr/scripts/adr-cli.ts` with zero bypass flags (no `--allow-edit`, `--force`, or `--update-hash`):
  - `retarget <old-path> <new-path>` rewrites `applies_to` and `enforced_by` across active ADRs while leaving historical ADRs untouched. Body-reference rewriting is deliberately omitted from `retarget` because modifying accepted ADR Markdown bodies violates the SHA-256 cryptographic body lock (`docs/adr/.adr-lock.json`) anchored against `git HEAD`.
  - `remove-path <path>` / `deprecate <id>` prunes removed paths from multi-path active ADRs and automatically transitions ADRs that exclusively governed that path to `status: "deprecated"` (preserving their historical paths).
  - Changing an architectural decision strictly requires creating a superseding decision via `pnpm adr:supersede` (which seeds the new ADR body from the superseded ADR to prevent silent information loss).
- **Cryptographic Body Lock & Git `HEAD` Anchoring**: Every accepted and historical ADR has its Markdown body (`## Context...` through `## Rejected Alternatives`) hashed with SHA-256 and locked in `docs/adr/.adr-lock.json`. During `pnpm adr:check`, existing lock entries are compared against `git show HEAD:docs/adr/.adr-lock.json`; modifying an existing ADR body or altering an existing hash triggers an unrecoverable tampering violation.
- **Git `HEAD` Frontmatter Anchoring**: `pnpm adr:check` compares active ADR frontmatter against `git show HEAD:<adrRelPath>`, rejecting `accepted -> deprecated` transitions while all `HEAD` `applies_to` paths still exist on disk, and rejecting removal of an `enforced_by` path from an `accepted` ADR while that file still exists on disk.

### 4. Repo & CI Gate Wiring (Replacing Pre-Commit)

- **Intentional Change from ADR-0011**: Removes `pnpm adr:check` from `.husky/pre-commit` and enforces it unconditionally in Stage 3 (`pnpm check:docs`, `pnpm check:fast`, `pnpm check` via `scripts/check.ts`) and Stage 4 (`.github/workflows/ci.yml` on both docs-only and code-change runs), catching deleted or renamed governed targets before merge without slowing or breaking partial local commits.

## Confirmation and Enforcement

- **CLI Validator (`pnpm adr:check`)**: Implemented in `.agents/skills/adr/scripts/adr-cli.ts` and wired into `scripts/check.ts` (`pnpm check:docs`, `pnpm check:fast`, `pnpm check` in `package.json`) and `.github/workflows/ci.yml`. Verifies YAML frontmatter schema, strict ordering of all six canonical H2 sections, bidirectional `supersedes`/`superseded_by` links, active-only (`status: "accepted"`) filesystem path existence, SHA-256 cryptographic body hashes, `git HEAD` lockfile and frontmatter anchoring, and zero drift in `docs/adr/README.md` and `src/modules/*/README.md`.
- **Automated Lifecycle Unit Tests (`.agents/skills/adr/tests/adr-cli.test.ts`)**: Hermetic Vitest suite verifies ADR creation, superseding (including seeded body preservation), `--path` matching, path retargeting, module/path removal auto-deprecation, body tampering detection, `git HEAD` lockfile & frontmatter anchoring, and README synchronization.
- **AI Agent Skill (`.agents/skills/adr/SKILL.md`)**: Instructs coding agents to run `pnpm adr:list --path <path>` (or inspect `src/modules/<name>/README.md`) before modifying governed areas, defines lifecycle triggers requiring a new or superseding ADR, and mandates the clean-context Supersede Auditor workflow using `.agents/skills/adr/references/supersede-auditor-prompt.txt`.

## Consequences

### Positive

- Coding agents can run `pnpm adr:list --path <path>` or read `src/modules/<name>/README.md` (`## Governing ADRs`) to load only the exact decisions governing any module, shared layer, app route, or tooling directory.
- Automated synchronization (`pnpm adr:sync`) and verification (`pnpm adr:check`) eliminate manual Markdown table maintenance and prevent broken links or stale module references.
- Module renames and removals have deterministic one-command workflows (`pnpm adr:retarget` and `pnpm adr:remove-path`) that preserve historical ADR accuracy.
- Every `check:docs`, `check:fast`, and GitHub CI run verifies that `applies_to` and `enforced_by` targets still exist and that accepted ADR bodies and frontmatter cannot be silently edited, weakened, or bypassed, while local `git commit` stays fast and supports partial commits.
- The ADR CLI shares TypeScript conventions with Vitest and repository tooling without maintaining separate `.mjs` scripts.

### Negative

- Every active ADR must declare at least one concrete `enforced_by` artifact rather than remaining purely aspirational, and adding or evolving ADRs requires running `pnpm adr:sync` (or using `pnpm adr:*` CLI commands) so generated README indexes pass `pnpm adr:check`.
- Because `pnpm adr:check` no longer runs in `.husky/pre-commit`, broken `applies_to`/`enforced_by` links are caught by `pnpm check:docs` / `pnpm check:fast` / GitHub CI rather than at `git commit` time.
- Legitimate removal of an enforcement artifact from an `accepted` ADR requires deleting/retargeting the file or superseding the ADR rather than removing the `enforced_by` entry in place.

## Rejected Alternatives

- **Classic Nygard Minimal Format (Title / Status / Context / Decision / Consequences Only)**: Lacks `Decision Drivers`, `Confirmation and Enforcement`, `Rejected Alternatives`, and machine-readable `applies_to`/`enforced_by` frontmatter needed for agent filtering and CI path verification.
- **Subfolder Archiving (`docs/adr/superseded/` or `docs/adr/archive/`)**: Moving ADR files when their status changes breaks relative Markdown links across Git commit messages, PR discussions, code comments, and cross-referencing ADRs.
- **Manual Dual Maintenance of Module READMEs**: Requiring developers or agents to hand-edit both `docs/adr/*.md` and `src/modules/*/README.md` violates Single Source of Truth and inevitably causes synchronization drift.
- **Unconditional Path Existence Checks on All ADRs**: Enforcing filesystem existence on `superseded` or `deprecated` ADRs would force developers to either delete historical ADRs or falsify historical path metadata when retiring a legacy module.
- **Bypass / Override Flags (`--allow-edit`, `--force`, `--update-hash`)**: Autonomous AI coding agents predictably invoke available bypass flags when encountering validation errors, defeating immutability guarantees.
- **Unanchored Local Lockfile**: An agent could modify an ADR body and recalculate the lockfile in the same step; anchoring against `git HEAD` ensures that past commits remain tamper-proof.
- **Keeping `--module <name>` Only**: Leaves shared layers, `src/app`, `src/composition`, and `.agents/*` without CLI discovery support.
- **Keeping `pnpm adr:check` Only in `.lintstagedrc.json`**: Fails to catch commits that delete or break `applies_to` / `enforced_by` targets outside `docs/adr/**` and `src/modules/*/README.md`.
- **Body-Only Tampering Checks**: Permits an agent to bypass enforcement by deleting `enforced_by` entries or marking an active ADR `deprecated` while its governed paths remain active.
- **Keeping Unconditional `pnpm adr:check` in `.husky/pre-commit`**: Duplicates Stage 3 (`pnpm check:docs` / `pnpm check:fast`) and Stage 4 (GitHub CI) checks and breaks partial (`git add -p`) commits.
