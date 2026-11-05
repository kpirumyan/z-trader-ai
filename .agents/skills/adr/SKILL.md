---
name: adr
description: Author, query, supersede, deprecate, retarget, synchronize, and validate Architecture Decision Records (ADRs) using the Hybrid MADR 4.0 + AI-Agent Executable Schema. Use this skill BEFORE modifying any domain module or shared layer to check governing ADRs (`pnpm adr:list --module <name>`), and whenever proposing architectural changes, introducing or removing modules or dependencies, changing layer boundaries or public contracts, renaming/moving modules, or diagnosing `pnpm adr:check` failures.
---

# Architecture Decision Records (ADR) Skill

Manage Z-Trader's Architecture Decision Log (`docs/adr/`) as an executable, machine-verifiable system rather than passive prose documentation.

## Why This Workflow Exists

Traditional prose ADRs fail in AI-assisted modular codebases in three ways:
1. **Retrieval Blindness**: Reading every file in `docs/adr/` wastes context tokens, while skipping them causes accidental architectural violations.
2. **Traceability Drift**: Manually edited tables in `docs/adr/README.md` and `src/modules/*/README.md` inevitably diverge from actual decisions.
3. **Silent Mutation**: Without cryptographic body locking and CI path checks, accepted historical decisions get silently rewritten or point to deleted files.

Z-Trader solves this with the **Hybrid MADR 4.0 + AI-Agent Executable Schema** (`ADR-0000`), backed by `.agents/skills/adr/scripts/adr-cli.mjs` and verified on every commit via `pnpm adr:check`.

---

## 1. Mandatory Pre-Flight Discovery (Before Editing Code)

Before modifying any domain module (`src/modules/<name>`) or shared segment (`src/shared/<segment>`), query its active governing decisions:

```bash
pnpm adr:list --module <module-name>
# Or query by repository path:
pnpm adr:list --path src/shared/storage
```

- Only `status: "accepted"` ADRs are returned by default so you load strictly the active constraints governing your target slice.
- Read the returned ADR files to verify their invariants and `enforced_by` gates before changing code.

---

## 2. When to Trigger an ADR Action

Do not wait for the user to explicitly say "write an ADR." Proactively create, supersede, or update ADR metadata whenever your task involves any of these architectural triggers:

| Trigger Event | Required Action |
| :--- | :--- |
| Adding a new domain module, shared layer segment, or external package | Create a new ADR via `pnpm adr:new` |
| Changing layer import rules, module boundaries, or contract perimeters | Supersede the governing ADR via `pnpm adr:supersede` or create a new ADR |
| Changing state management, streaming/transport patterns, styling, or storage strategy | Supersede the governing ADR via `pnpm adr:supersede` |
| Replacing an accepted decision with a new approach | Run `pnpm adr:supersede <ADR-XXXX>` (never edit the old ADR body) |
| Retiring a decision that is no longer relevant without a replacement | Run `pnpm adr:deprecate <ADR-XXXX>` |
| Renaming or moving a governed module or enforcement file | Run `pnpm adr:retarget <old-path> <new-path>` |
| Deleting a module or path from the repository | Run `pnpm adr:remove-path <deleted-path>` |

Routine bug fixes, internal refactors within an existing module contract, and adding unit tests that follow established patterns do **not** require a new ADR.

---

## 3. CLI Commands & Lifecycle Workflows

All operations run through `pnpm adr:*` scripts (powered by `.agents/skills/adr/scripts/adr-cli.mjs`).

### Querying Decisions (`pnpm adr:list`)

```bash
# List active (accepted) ADRs governing src/modules/chart
pnpm adr:list --module chart

# List active ADRs governing any specific repo path
pnpm adr:list --path src/shared/contracts

# List all ADRs (including superseded and deprecated)
pnpm adr:list --all

# Output structured JSON for programmatic inspection
pnpm adr:list --module market-data --json
```

### Creating a New Decision (`pnpm adr:new`)

```bash
pnpm adr:new \
  --title "WebWorker Indicator Offloading" \
  --area "Indicators & Performance" \
  --applies-to "src/modules/indicators,src/modules/chart" \
  --enforced-by "src/modules/indicators/tests/indicators.test.ts" \
  --context "Calculating complex multi-series indicators on the main thread risks frame drops." \
  --drivers "Maintain 60 FPS chart panning; keep indicator calculations deterministic." \
  --outcome "Chosen option: Dedicated WebWorker calculation pipeline with typed message contracts." \
  --confirmation "Verified via Vitest unit suite in src/modules/indicators/tests/indicators.test.ts." \
  --consequences "### Positive\n\n- Zero main-thread blocking.\n\n### Negative\n\n- Async serialization boundary." \
  --alternatives "- **Main-thread chunking**: Still shares frame budget with canvas rendering."
```

What `pnpm adr:new` does automatically:
1. Allocates the next 4-digit ID (`ADR-XXXX`) and creates `docs/adr/XXXX-<slug>.md` with canonical YAML frontmatter and all six MADR 4.0 H2 sections.
2. Computes the SHA-256 hash of the Markdown body and records it in `docs/adr/.adr-lock.json`.
3. Synchronizes `docs/adr/README.md` and `## Governing ADRs` in affected `src/modules/*/README.md` files.

### Superseding an Existing Decision (`pnpm adr:supersede`)

Accepted ADRs are immutable historical records. When an architectural decision changes, supersede it:

```bash
pnpm adr:supersede ADR-0006 \
  --title "WebGL Charting Engine Migration" \
  --area "Charting & Performance" \
  --applies-to "src/modules/chart,src/shared/theme" \
  --enforced-by "src/modules/chart/tests/chart.test.tsx"
```

What `pnpm adr:supersede` does automatically:
1. Creates the new `ADR-YYYY` record with `supersedes: "ADR-0006"` and `status: "accepted"`.
2. Updates `ADR-0006` frontmatter to `status: "superseded by ADR-YYYY"` and `superseded_by: "ADR-YYYY"` without touching `ADR-0006`'s locked Markdown body.
3. Moves `ADR-0006` from `## Active Decisions Index` to `## Historical Decisions Index` in `docs/adr/README.md` and replaces it with `ADR-YYYY` in module `README.md` files.

### Deprecating a Decision (`pnpm adr:deprecate`)

When a feature or decision is retired without a successor:

```bash
pnpm adr:deprecate ADR-0007
```

Updates the target ADR's frontmatter `status` to `"deprecated"`, keeps its body and cryptographic hash intact, and removes it from active module governance indexes.

### Renaming / Moving a Module (`pnpm adr:retarget`)

When renaming or moving a directory or enforcement file (e.g., `src/modules/indicators` -> `src/modules/indicators-engine`):

```bash
pnpm adr:retarget src/modules/indicators src/modules/indicators-engine
```

- Rewrites matching `applies_to` and `enforced_by` frontmatter paths across all **active** (`accepted` / `proposed`) ADRs.
- Leaves historical (`superseded` / `deprecated`) ADRs untouched so historical records remain accurate to their era.
- Regenerates `docs/adr/README.md` and `src/modules/*/README.md`.

### Deleting a Module or Path (`pnpm adr:remove-path`)

When deleting a module or enforcement path from the codebase:

```bash
pnpm adr:remove-path src/modules/legacy-widget
```

- Removes `src/modules/legacy-widget` (and any subpaths) from `applies_to` and `enforced_by` across active ADRs.
- If an active ADR exclusively governed the removed module (`applies_to` becomes empty), automatically transitions that ADR to `status: "deprecated"`.
- Synchronizes all README indexes.

### Synchronizing & Validating (`pnpm adr:sync` & `pnpm adr:check`)

```bash
# Regenerate docs/adr/README.md and src/modules/*/README.md Governing ADRs sections
pnpm adr:sync

# Validate schema, H2 ordering, active path existence, README sync, and cryptographic body locks
pnpm adr:check
```

---

## 4. Immutability & Cryptographic Lock Rules (`docs/adr/.adr-lock.json`)

1. **Permanent Body Lock**: Every ADR's Markdown body (everything after the closing `---` of the YAML frontmatter, trimmed) is hashed with SHA-256 in `docs/adr/.adr-lock.json`.
2. **Git HEAD Anchoring**: `pnpm adr:check` compares `docs/adr/.adr-lock.json` against `git show HEAD:docs/adr/.adr-lock.json`. Editing an existing ADR's Markdown body or altering/deleting an existing hash in `.adr-lock.json` triggers an unrecoverable tampering error.
3. **Frontmatter-Only Lifecycle Transitions**: Only lifecycle metadata in YAML frontmatter (`status`, `superseded_by`, `applies_to`, `enforced_by`) changes when decisions are superseded, deprecated, retargeted, or pruned.
4. **Zero Bypass Flags**: The CLI intentionally rejects `--force`, `--allow-edit`, and `--update-hash`. Always use `pnpm adr:supersede` to evolve architectural decisions.

---

## 5. Schema Reference

Read [`references/madr-schema.md`](./references/madr-schema.md) when authoring ADR content or diagnosing validation errors in `pnpm adr:check`. It defines:
- Required YAML frontmatter fields and allowed lifecycle statuses
- The 6 canonical MADR 4.0 H2 sections and their required order
- Active vs. historical path enforcement rules
- Complete MADR 4.0 template and examples
