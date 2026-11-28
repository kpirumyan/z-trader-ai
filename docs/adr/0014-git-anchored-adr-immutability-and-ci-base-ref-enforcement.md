---
id: "ADR-0014"
title: "Git-Anchored ADR Immutability and CI Base-Ref Enforcement"
status: "accepted"
date: "2026-11-28"
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
supersedes: "ADR-0013"
superseded_by: null
---

# ADR-0014: Git-Anchored ADR Immutability and CI Base-Ref Enforcement

## Context and Problem Statement

Supersedes [ADR-0013](./0013-path-scoped-executable-adr-governance-via-repo-and-ci-gates.md).

[ADR-0000](./0000-executable-adr-governance.md) established Hybrid MADR 4.0 governance to solve three failure modes of prose-only ADRs (Retrieval Blindness, Traceability Drift, and Unverified Invariants) using `adr-cli.mjs`, module-only discovery (`pnpm adr:list --module <name>`), and staged-file triggering via `.lintstagedrc.json`. [ADR-0011](./0011-path-scoped-executable-adr-governance.md) upgraded the CLI to TypeScript (`adr-cli.ts`), introduced `--path` discovery, added `git HEAD` frontmatter anchoring, and moved `pnpm adr:check` into `.husky/pre-commit` before GitHub Actions CI existed. [ADR-0013](./0013-path-scoped-executable-adr-governance-via-repo-and-ci-gates.md) removed unconditional `pnpm adr:check` from `.husky/pre-commit` in favor of Stage 3 (`scripts/check.ts`) and Stage 4 (`.github/workflows/ci.yml`).

Three enforcement flaws remained in the [ADR-0013](./0013-path-scoped-executable-adr-governance-via-repo-and-ci-gates.md) implementation:

1. **Blind CI Anchoring (`HEAD` vs. `HEAD`)**: In `.github/workflows/ci.yml`, the `verify` job checked out only the PR/push commit (`fetch-depth: 1`) and `adr-cli.ts` compared the working tree against `git show HEAD:...`—which on CI is identical to the committed tree itself, allowing committed ADR edits and tampered lockfiles to pass CI undetected.
2. **Redundant `.adr-lock.json` Lockfile & Draft Hash Workaround**: Maintaining SHA-256 hashes in `docs/adr/.adr-lock.json` alongside `git show HEAD` lookups caused `pnpm adr:check` to reject edits to uncommitted draft ADRs unless agents ran a manual `node -e` re-hashing snippet documented in `.agents/skills/adr/SKILL.md`.
3. **Partial Frontmatter & Deletion Protection**: Frontmatter anchoring protected `enforced_by` and premature `accepted -> deprecated` transitions, but did not guard against deleting `applies_to` paths still present on disk, mutating immutable metadata (`title`, `area`, `date`, `decision-makers`, `supersedes`), or deleting committed ADR files if `.adr-lock.json` was edited in lockstep.

Additionally, `package.json` consolidated the seven individual ADR subcommand proxy scripts (`adr:list`, `adr:new`, `adr:supersede`, `adr:deprecate`, `adr:retarget`, `adr:remove-path`, `adr:sync`) into `pnpm adr <subcommand>` alongside `pnpm adr:check` so `package.json` does not duplicate one-off CLI subcommands while keeping `adr:check` as an explicit top-level gate script for `scripts/check.ts` and guardrail telemetry.

How should Z-Trader enforce immutable committed ADRs, safe lifecycle transitions, and path-scoped ADR discovery consistently across local development and GitHub Actions CI without a redundant lockfile?

## Decision Drivers

- **Zero-Token-Waste Arbitrary Repo-Path Discovery**: Agents must be able to query only active (`accepted`) ADRs for any repository path (`src/modules/chart`, `src/shared/storage`, `src/app`, `.agents/tracing`) via a single `--path` interface without reading unrelated ADRs into context.
- **Single Source of Truth (SSOT) Without Manual Sync**: Index tables in `docs/adr/README.md` and `## Governing ADRs` sections in `src/modules/*/README.md` must be derived deterministically from ADR frontmatter.
- **Historical Immutability with Safe Module Evolution**: Superseded and deprecated ADRs must remain immutable historical records in `docs/adr/` with stable Markdown URLs, and retiring or renaming a module must never break CI checks on historical records.
- **TypeScript Tooling Alignment**: The ADR CLI runs natively as TypeScript (`.agents/skills/adr/scripts/adr-cli.ts`) consistent with the rest of the repository and test suite.
- **Mechanical Verification in Repo & CI Gates Without Pre-Commit Duplication**: Every active ADR must link to existing `applies_to` and `enforced_by` targets, verified unconditionally in `pnpm check:docs`, `pnpm check:fast`, `pnpm check`, and `.github/workflows/ci.yml` (both docs-only and code-change runs), without duplicating repo-wide `pnpm adr:check` in `.husky/pre-commit`.
- **CI-Effective Git Base Comparison Without Lockfile Indirection**: Committed ADR immutability must be verified directly against Git history (`HEAD` and branch `merge-base` locally; the PR/push base commit via `ADR_BASE_REF` / `--base` in GitHub CI) while allowing uncommitted draft ADRs to be authored freely without `.adr-lock.json` or manual `node -e` hash updates.
- **Tamper-Resistant Frontmatter Lifecycle**: Committed ADRs must remain protected against file deletion, immutable metadata edits, premature deprecation, and removal of active `applies_to` or `enforced_by` paths still present on disk.

## Decision Outcome

Chosen option: **Direct Git-Anchored ADR Immutability (`HEAD` + `merge-base` Locally, `ADR_BASE_REF` / `--base` in Full-History CI) Replacing `docs/adr/.adr-lock.json`**, while preserving MADR 4.0 structure, flat immutable logs, `--path` discovery, and Stage 3 (`scripts/check.ts`) + Stage 4 (`.github/workflows/ci.yml`) enforcement.

### 1. Hybrid MADR 4.0 Schema, Flat Immutable Log & Active-Only Path Verification

- Every ADR in `docs/adr/XXXX-<slug>.md` begins with machine-parsable YAML frontmatter (`id` (`"ADR-XXXX"`), `title`, `status` (`"proposed"` | `"accepted"` | `"rejected"` | `"deprecated"` | `"superseded by ADR-YYYY"`), `date` (`"YYYY-MM-DD"`), `decision-makers`, `area`, `applies_to` (governed repo-relative paths), `enforced_by` (linter configs, schemas, or test files), `supersedes`, `superseded_by`) and six canonical MADR 4.0 H2 sections in strict sequence:
  1. `## Context and Problem Statement`
  2. `## Decision Drivers`
  3. `## Decision Outcome`
  4. `## Confirmation and Enforcement`
  5. `## Consequences`
  6. `## Rejected Alternatives`
- **Flat Immutable Log**: All ADRs remain permanently in `docs/adr/` regardless of lifecycle status so relative Markdown links (`./000X-*.md`) in code comments, commits, PR discussions, and other ADRs never break. Deleting or renaming any committed ADR file fails `pnpm adr:check`.
- **Active vs. Historical Split & Single Source of Truth**: Frontmatter `applies_to` in active ADRs is the sole authority. `pnpm adr sync` deterministically regenerates `docs/adr/README.md`—partitioned into **Active Decisions Index** (`accepted` / `proposed`) and **Historical Decisions Index** (`superseded` / `deprecated` / `rejected`)—and `## Governing ADRs` in every `src/modules/<name>/README.md`.
- **Active-Only Path Verification**: `pnpm adr:check` enforces filesystem existence of `applies_to` and `enforced_by` paths strictly on `status: "accepted"` ADRs (each active ADR must also declare at least one `enforced_by` artifact), rejects duplicate `id` values, verifies filename numeric prefixes (`XXXX-*.md`), and enforces bidirectional `supersedes` / `superseded_by` / `status` consistency. Historical (`superseded` or `deprecated`) ADRs preserve historical paths of deleted modules without failing CI.

### 2. Path-Scoped Discovery (`pnpm adr list --path <path>`)

- Uses `--path <path>` (`getGoverningAdrsForPath` / `matchesGovernancePath` in `.agents/skills/adr/scripts/adr-cli.ts`), matching exact paths, ancestor directories, and child paths across any governed location in the repository.
- Supports `--all` and `--json` for deterministic agent consumption before editing any governed area.

### 3. TypeScript CLI, Consolidated Entrypoints & Direct Git-Anchored Immutability

- **Consolidated `package.json` Scripts (Intentional Change from ADR-0013)**: `package.json` exposes `"adr": "node .agents/skills/adr/scripts/adr-cli.ts"` and `"adr:check": "node .agents/skills/adr/scripts/adr-cli.ts check"`—replacing the 7 individual `adr:list`, `adr:new`, `adr:supersede`, `adr:deprecate`, `adr:retarget`, `adr:remove-path`, `adr:sync` proxy scripts to eliminate redundant `package.json` boilerplate for infrequently run CLI subcommands while preserving `adr:check` as a top-level verification gate for `scripts/check.ts` and tracing guardrail classification—with zero bypass flags (no `--allow-edit`, `--force`, or `--update-hash`):
  - `pnpm adr retarget <old-path> <new-path>` rewrites `applies_to` and `enforced_by` across active ADRs while leaving historical ADRs untouched and without modifying committed ADR bodies.
  - `pnpm adr remove-path <path>` / `pnpm adr deprecate <id>` prunes removed paths from multi-path active ADRs and automatically transitions ADRs that exclusively governed that path to `status: "deprecated"` (preserving historical paths).
  - Changing an architectural decision strictly requires creating a superseding decision via `pnpm adr supersede <old-id>` (which seeds the new ADR body from the superseded ADR to prevent silent information loss).
- **Direct Git-Anchored Body & Metadata Immutability (Intentional Change from ADR-0013)**: Removes `docs/adr/.adr-lock.json`, SHA-256 body hashing (`computeBodyHash`, `readLockFile`, `writeLockFile`), and the manual `node -e` re-hashing step in `.agents/skills/adr/SKILL.md`. Instead, `pnpm adr:check` compares working-tree ADRs directly against resolved Git base commits (skipping legacy pre-MADR files without YAML frontmatter):
  - **Base Ref Resolution**: Uses `--base <git-ref>` or `ADR_BASE_REF` when provided (e.g., `pull_request.base.sha` or push `before` SHA in GitHub CI) together with `HEAD`; locally without an explicit base ref, checks both `HEAD` and `merge-base(HEAD, origin/main|main|origin/master|master)` so committed tampering on a feature branch is caught locally as well as in CI.
  - **Draft Freedom**: Uncommitted ADRs absent from the base commits can be freely authored and edited before committing without hash maintenance.
  - **Committed Body & Identity Lock**: Once an ADR exists in a base commit, deleting or moving the file, modifying its normalized Markdown body (`\r\n` -> `\n`, trimmed), or altering immutable fields (`id`, `title`, `date`, `area`, `decision-makers`, `supersedes`) fails `pnpm adr:check`.
  - **Allowlisted Frontmatter Transitions**: Relative to a base commit, an existing ADR may only transition `(accepted | proposed) -> superseded by ADR-XXXX` with matching `superseded_by: "ADR-XXXX"` (when `ADR-XXXX` exists and declares `supersedes`), `proposed -> accepted`, or `(accepted | proposed) -> deprecated` (only when all base `applies_to` paths no longer exist on disk). Removing any `applies_to` or `enforced_by` path while that path still exists on disk is rejected across both active and historical records.

### 4. Repo & CI Gate Wiring

- Preserves [ADR-0013](./0013-path-scoped-executable-adr-governance-via-repo-and-ci-gates.md)'s removal of unconditional `pnpm adr:check` from `.husky/pre-commit`, enforcing `pnpm adr:check` unconditionally in Stage 3 (`pnpm check:docs`, `pnpm check:fast`, `pnpm check` via `scripts/check.ts`) and Stage 4 (`.github/workflows/ci.yml` on both docs-only and code-change runs).
- **Full-History CI Base Anchoring (Intentional Change from ADR-0013)**: `.github/workflows/ci.yml` checks out with `fetch-depth: 0` in the `verify` job and passes `ADR_BASE_REF` from the `changes` job (`pull_request.base.sha` for PRs, `github.event.before` for pushes to `main`, `HEAD~1` fallback for `workflow_dispatch`/initial push) into `pnpm check:docs` and `pnpm check:fast`.

## Confirmation and Enforcement

- **CLI Validator (`pnpm adr:check`)**: Implemented in `.agents/skills/adr/scripts/adr-cli.ts` and wired into `scripts/check.ts` (`pnpm check:docs`, `pnpm check:fast`, `pnpm check` in `package.json`) and `.github/workflows/ci.yml`. Verifies YAML frontmatter schema, duplicate `id` rejection, filename numeric prefix matching, strict ordering of all six canonical H2 sections, bidirectional `supersedes`/`superseded_by`/`status` links, active-only (`status: "accepted"`) filesystem path existence, Git-anchored body/metadata/file/frontmatter-transition immutability against resolved base commits, and zero drift in `docs/adr/README.md` and `src/modules/*/README.md`.
- **Automated Lifecycle Unit Tests (`.agents/skills/adr/tests/adr-cli.test.ts`)**: Hermetic Vitest suite verifies ADR creation, uncommitted draft authoring without a lockfile, superseding (including seeded body preservation), `--path` matching, path retargeting, module/path removal auto-deprecation, committed body/deletion/metadata tampering detection against `HEAD` and explicit `baseRef`, active `applies_to`/`enforced_by` removal & premature deprecation protection, pre-MADR legacy compatibility, and README synchronization.
- **AI Agent Skill (`.agents/skills/adr/SKILL.md`)**: Instructs coding agents to run `pnpm adr list --path <path>` (or inspect `src/modules/<name>/README.md`) before modifying governed areas, defines lifecycle triggers requiring a new or superseding ADR, and mandates the clean-context Supersede Auditor workflow using `.agents/skills/adr/references/supersede-auditor-prompt.txt`.

## Consequences

### Positive

- Coding agents can run `pnpm adr list --path <path>` or read `src/modules/<name>/README.md` (`## Governing ADRs`) to load only the exact decisions governing any module, shared layer, app route, or tooling directory.
- Automated synchronization (`pnpm adr sync`) and verification (`pnpm adr:check`) eliminate manual Markdown table maintenance and prevent broken links or stale module references.
- Module renames and removals have deterministic one-command workflows (`pnpm adr retarget` and `pnpm adr remove-path`) that preserve historical ADR accuracy.
- Eliminates `.adr-lock.json` merge conflicts, redundant SHA-256 boilerplate, and the manual `node -e` re-hashing workaround in `SKILL.md` while allowing uncommitted draft ADRs to be edited cleanly before commit.
- Closes the GitHub Actions CI blind spot (`fetch-depth: 0` + `ADR_BASE_REF`) and extends immutability protection to ADR deletion, immutable frontmatter fields, and `applies_to` removal.
- Every `check:docs`, `check:fast`, and GitHub CI run verifies invariants without slowing or breaking partial local `git commit` workflows.
- The ADR CLI shares TypeScript conventions with Vitest and repository tooling without maintaining separate `.mjs` scripts.

### Negative

- Every active ADR must declare at least one concrete `enforced_by` artifact rather than remaining purely aspirational, and adding or evolving ADRs requires running `pnpm adr sync` (or using `pnpm adr ...` CLI commands) so generated README indexes pass `pnpm adr:check`.
- Because `pnpm adr:check` no longer runs in `.husky/pre-commit`, broken `applies_to`/`enforced_by` links and local ADR edits are caught by `pnpm check:docs` / `pnpm check:fast` / GitHub CI rather than at `git commit` time.
- Legitimate removal of an `applies_to` or `enforced_by` artifact from an existing ADR requires deleting/retargeting the file on disk or superseding the ADR rather than dropping the entry while the target path still exists.
- GitHub Actions `verify` requires `fetch-depth: 0` (matching the `changes` job) rather than a shallow clone so `ADR_BASE_REF` commits are locally readable via `git show`.

## Rejected Alternatives

- **Classic Nygard Minimal Format (Title / Status / Context / Decision / Consequences Only)**: Lacks `Decision Drivers`, `Confirmation and Enforcement`, `Rejected Alternatives`, and machine-readable `applies_to`/`enforced_by` frontmatter needed for agent filtering and CI path verification.
- **Subfolder Archiving (`docs/adr/superseded/` or `docs/adr/archive/`)**: Moving ADR files when their status changes breaks relative Markdown links across Git commit messages, PR discussions, code comments, and cross-referencing ADRs.
- **Manual Dual Maintenance of Module READMEs**: Requiring developers or agents to hand-edit both `docs/adr/*.md` and `src/modules/*/README.md` violates Single Source of Truth and inevitably causes synchronization drift.
- **Unconditional Path Existence Checks on All ADRs**: Enforcing filesystem existence on `superseded` or `deprecated` ADRs would force developers to either delete historical ADRs or falsify historical path metadata when retiring a legacy module.
- **Bypass / Override Flags (`--allow-edit`, `--force`, `--update-hash`)**: Autonomous AI coding agents predictably invoke available bypass flags when encountering validation errors, defeating immutability guarantees.
- **SHA-256 Lockfile (`docs/adr/.adr-lock.json`) Anchored Only to `git HEAD`**: Duplicates Git's own object store, forces manual `node -e` hash recalculation for new drafts, creates cross-branch merge conflicts, and fails silently in CI where `HEAD` is the commit under test.
- **Unanchored Local Lockfile**: An agent could modify an ADR body and recalculate the lockfile in the same step; anchoring against Git base history ensures committed decisions remain tamper-proof.
- **Keeping `--module <name>` Only**: Leaves shared layers, `src/app`, `src/composition`, and `.agents/*` without CLI discovery support.
- **Keeping `pnpm adr:check` Only in `.lintstagedrc.json`**: Fails to catch commits that delete or break `applies_to` / `enforced_by` targets outside `docs/adr/**` and `src/modules/*/README.md`.
- **Body-Only Tampering Checks**: Permits an agent to bypass enforcement by deleting `applies_to` or `enforced_by` entries, mutating metadata, or marking an active ADR `deprecated` while its governed paths remain active.
- **Keeping Unconditional `pnpm adr:check` in `.husky/pre-commit`**: Duplicates Stage 3 (`pnpm check:docs` / `pnpm check:fast`) and Stage 4 (GitHub CI) checks and breaks partial (`git add -p`) commits.
