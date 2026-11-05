---
id: "ADR-0000"
title: "Executable ADR Governance via Hybrid MADR 4.0 and Bidirectional Traceability"
status: "accepted"
date: "2026-11-05"
decision-makers:
  - "Product Owner"
  - "Main Agent"
area: "Tooling & Governance"
applies_to:
  - "docs/adr"
  - ".agents/skills/adr"
enforced_by:
  - ".agents/skills/adr/scripts/adr-cli.mjs"
  - ".agents/skills/adr/tests/adr-cli.test.ts"
supersedes: null
superseded_by: null
---

# ADR-0000: Executable ADR Governance via Hybrid MADR 4.0 and Bidirectional Traceability

## Context and Problem Statement

When autonomous AI coding agents and human developers collaborate on a modular codebase, traditional prose-only Architectural Decision Records (ADRs) suffer from three failure modes:

1. **Retrieval Blindness**: Agents editing a domain module (e.g., `src/modules/chart`) do not know which subset of `docs/adr/*.md` governs that module without reading every ADR into context.
2. **Traceability Drift**: Manually maintained index tables in `docs/adr/README.md` or module READMEs inevitably fall out of sync when decisions are added, superseded, or deprecated, or when modules are renamed or removed.
3. **Unverified Invariants**: Without machine-readable links between architectural decisions, governed filesystem paths, and automated enforcement gates, ADRs degrade into passive historical essays rather than executable constraints.

How should Z-Trader structure, govern, and mechanically verify its Architecture Decision Log so that both humans and AI agents can deterministically query, evolve, and enforce architectural decisions?

## Decision Drivers

- **Zero-Token-Waste Agent Discovery**: Coding agents must be able to query only the active (`accepted`) ADRs that govern a target module before making code changes.
- **Single Source of Truth (SSOT) Without Manual Sync**: Index tables in `docs/adr/README.md` and `## Governing ADRs` sections in `src/modules/*/README.md` must be derived deterministically from ADR metadata.
- **Historical Immutability with Safe Module Evolution**: Superseded and deprecated ADRs must remain immutable historical records in `docs/adr/` with stable Markdown URLs, and retiring or renaming a module must never break CI checks on historical records.
- **Mechanical Verification in CI**: Every active ADR must link to existing governed paths (`applies_to`) and concrete verification gates (`enforced_by`), checked automatically in `pnpm check:fast` and `pnpm check`.

## Decision Outcome

Chosen option: **Hybrid MADR 4.0 + AI-Agent Executable Schema with Single-Source-of-Truth Bidirectional Sync (`adr-cli.mjs`)**, because it combines industry-standard MADR 4.0 decision capture with deterministic CLI queries, automated README index generation, and active-only filesystem path verification.

### 1. Hybrid MADR 4.0 + AI-Agent Frontmatter & Section Schema

- Every ADR in `docs/adr/XXXX-<slug>.md` begins with machine-parsable YAML frontmatter:
  - `id` (`"ADR-XXXX"`), `title`, `status` (`"proposed"` | `"accepted"` | `"rejected"` | `"deprecated"` | `"superseded by ADR-YYYY"`), `date` (`"YYYY-MM-DD"`), `decision-makers`, `area`, `applies_to` (governed repo-relative paths), `enforced_by` (linter configs, schemas, or test files), `supersedes`, and `superseded_by`.
- Every ADR body follows the six canonical MADR 4.0 H2 sections in strict order:
  1. `## Context and Problem Statement`
  2. `## Decision Drivers`
  3. `## Decision Outcome`
  4. `## Confirmation and Enforcement`
  5. `## Consequences`
  6. `## Rejected Alternatives`

### 2. Flat Immutable Log & Active-Only Path Enforcement

- **Flat Directory Structure**: All ADRs remain permanently in `docs/adr/` regardless of lifecycle status so relative Markdown links (`./000X-*.md`) in code comments, commits, and other ADRs never break.
- **Active vs. Historical Split**: `docs/adr/README.md` automatically partitions records into **Active Decisions Index** (`accepted` / `proposed`) and **Historical Decisions Index** (`superseded` / `deprecated`).
- **Active-Only Path Verification**: `pnpm adr:check` enforces filesystem existence of `applies_to` and `enforced_by` paths strictly on `status: "accepted"` ADRs. Historical (`superseded` or `deprecated`) ADRs preserve the historical paths of deleted modules without failing CI.

### 3. Bidirectional Traceability & Module Lifecycle Automation

- **Single Source of Truth**: Frontmatter `applies_to` in active ADRs is the sole authority. Running `pnpm adr:sync` regenerates `docs/adr/README.md` and the `## Governing ADRs` section in every `src/modules/<name>/README.md`.
- **Module Rename / Refactor (`pnpm adr:retarget <old-path> <new-path>`)**: Rewrites `applies_to`, `enforced_by`, and body references across active ADRs while leaving historical ADRs untouched.
- **Module Removal (`pnpm adr:remove-path <path>` / `pnpm adr:deprecate <id>`)**: Prunes removed module paths from active multi-module ADRs and automatically transitions single-module ADRs that exclusively governed the removed module to `status: "deprecated"`.

### 4. Permanent Body Immutability & Git-Anchored Cryptographic Lock (`docs/adr/.adr-lock.json`)

- **Cryptographic Body Lock**: Every accepted and historical ADR has its Markdown body (`## Context...` through `## Rejected Alternatives`) hashed with SHA-256 and locked in `docs/adr/.adr-lock.json`.
- **Git HEAD Anchoring**: During `pnpm adr:check`, existing lock entries are compared against `git show HEAD:docs/adr/.adr-lock.json`. Modifying an existing ADR body or altering an existing hash in `.adr-lock.json` triggers an unrecoverable tampering violation.
- **Zero Bypass Flags**: The ADR CLI deliberately contains no `--allow-edit`, `--force`, or `--update-hash` flags. Changing an architectural decision strictly requires creating a new decision via `pnpm adr:supersede`.

## Confirmation and Enforcement

- **CLI Validator (`pnpm adr:check`)**: Implemented in `.agents/skills/adr/scripts/adr-cli.mjs` and wired into `pnpm check:fast` and `pnpm check` in `package.json`. Verifies YAML frontmatter, canonical H2 section ordering, bidirectional `supersedes`/`superseded_by` links, active path existence, cryptographic body hashes, and zero drift in `docs/adr/README.md` and `src/modules/*/README.md`.
- **Pre-Commit Interceptor (`.lintstagedrc.json`)**: Executes `pnpm adr:check` on staged `docs/adr/**` and `src/modules/*/README.md` changes before git commits can be created.
- **Automated Lifecycle Unit Tests (`.agents/skills/adr/tests/adr-cli.test.ts`)**: Hermetic Vitest suite testing ADR creation, superseding, module rename retargeting, module removal auto-deprecation, body tampering detection, and git HEAD lock validation.
- **AI Agent Skill (`.agents/skills/adr/SKILL.md`)**: Instructs coding agents to run `pnpm adr:list --module <name>` before modifying a module and defines the implicit triggers requiring a new or superseding ADR.

## Consequences

### Positive

- AI agents can run `pnpm adr:list --module <name>` or read a module's `README.md` (`## Governing ADRs`) to load only the exact decisions governing their task.
- Automated synchronization (`pnpm adr:sync`) and verification (`pnpm adr:check`) eliminate manual Markdown table maintenance and prevent broken links or stale module references.
- Module renames and removals have deterministic one-command workflows (`pnpm adr:retarget` and `pnpm adr:remove-path`) that preserve historical ADR accuracy.
- Accepted ADR bodies cannot be silently edited or hacked with bypass flags by developers or agents.

### Negative

- Adding or modifying an ADR requires running `pnpm adr:sync` (or using the `pnpm adr:*` CLI commands) so generated README indexes pass `pnpm adr:check`.
- Every ADR must declare at least one concrete `enforced_by` verification artifact rather than remaining purely aspirational.

## Rejected Alternatives

- **Classic Nygard Minimal Format (Title / Status / Context / Decision / Consequences Only)**: Lacks `Decision Drivers`, `Confirmation and Enforcement`, `Rejected Alternatives`, and machine-readable `applies_to`/`enforced_by` frontmatter needed for agent filtering and CI path verification.
- **Subfolder Archiving (`docs/adr/superseded/` or `docs/adr/archive/`)**: Moving ADR files when their status changes breaks relative Markdown links across Git commit messages, PR discussions, code comments, and cross-referencing ADRs.
- **Manual Dual Maintenance of Module READMEs**: Requiring developers or agents to hand-edit both `docs/adr/*.md` and `src/modules/*/README.md` violates Single Source of Truth and inevitably causes synchronization drift.
- **Unconditional Path Existence Checks on All ADRs**: Enforcing filesystem existence on `superseded` or `deprecated` ADRs would force developers to either delete historical ADRs or falsify historical path metadata when retiring a legacy module.
- **Bypass / Override Flags (`--allow-edit`, `--force`)**: Autonomous AI coding agents predictably invoke available bypass flags when encountering validation errors, defeating immutability guarantees.
- **Unanchored Local Lockfile**: An agent could modify an ADR body and recalculate the lockfile in the same step; anchoring against `git HEAD` ensures that past commits remain tamper-proof.
