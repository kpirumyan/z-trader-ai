---
name: adr
description: Architectural Decision Records (ADRs) management and governance for Z-Trader. Guides and enforces MADR 4.0 standards, active-decision querying, cryptographic immutability, automated synchronization, and lifecycle workflows (create, supersede, deprecate, retarget, remove-path). Use whenever creating or reviewing architectural decisions, modifying module boundaries, consulting governing ADRs before changing a module, or checking ADR compliance with pnpm adr:check.
---

# Architectural Decision Records (ADR) Governance

This skill guides humans and AI agents in querying, authoring, superseding, and verifying Architectural Decision Records (ADRs) in **Z-Trader** according to the **MADR 4.0 (Markdown Architectural Decision Records)** standard with bidirectional machine-readable traceability.

## Core Principles

1. **Active vs. Historical Partitioning**:
   - Only active decisions (`status: "accepted"`) govern new code and CI path verification.
   - Historical records (`superseded by ADR-XXXX`, `deprecated`, `rejected`) remain permanent immutable records in `docs/adr/` to prevent broken links in code comments, PRs, and commit history.
2. **Cryptographic Body Immutability**:
   - The markdown body of every accepted ADR is hashed with SHA-256 and locked in `docs/adr/.adr-lock.json`.
   - Modifying an existing ADR body is prohibited and flagged by `pnpm adr:check` against Git HEAD.
   - To alter an architectural decision, always create a superseding record via `pnpm adr:supersede`.
3. **Single Source of Truth**:
   - `applies_to` and `enforced_by` in frontmatter are the single authority.
   - Never edit table indexes in `docs/adr/README.md` or `## Governing ADRs` in `src/modules/*/README.md` manually; run `pnpm adr:sync`.

---

## When to Trigger This Skill

- Before starting code changes in any domain module: query active ADRs governing that module.
- When designing a new architecture, domain module, storage engine, or communication contract.
- When replacing or deprecating an existing architectural pattern.
- When renaming, moving, or removing a module path.
- When verifying PR / commit compliance with `pnpm adr:check`.

---

## Agent Workflows

### 1. Pre-Task Discovery (Consult Governing ADRs)

Before modifying code in a vertical domain module (e.g. `src/modules/chart`), find the active architectural decisions governing it:

```bash
# Query active ADRs governing a specific module
pnpm adr:list --module chart

# Query in machine-readable JSON format
pnpm adr:list --module chart --json
```

Or read the `## Governing ADRs` section in `src/modules/<name>/README.md`.

### 2. Creating a New Architectural Decision

When introducing a new architectural pattern, vertical slice, or global standard:

1. Run the CLI creation command:
   ```bash
   pnpm adr:new --title "My New Architecture" --area "Architecture & Layout" --applies-to "src/modules/example,src/shared" --enforced-by "src/modules/example/tests/example.test.ts"
   ```
2. The CLI will:
   - Allocate the next sequential ID (e.g. `ADR-0008` in `docs/adr/0008-my-new-architecture.md`).
   - Populate the canonical MADR 4.0 template.
   - Hash the initial body and register it in `docs/adr/.adr-lock.json`.
   - Synchronize `docs/adr/README.md` and module READMEs.
3. Edit the sections in `docs/adr/0008-my-new-architecture.md` to document the decision drivers, outcome, consequences, and rejected alternatives.
4. Update the lockfile hash if the body was edited before initial acceptance:
   ```bash
   # Re-hash and update during initial draft
   node -e '
     const fs = require("fs");
     const crypto = require("crypto");
     const raw = fs.readFileSync("docs/adr/0008-my-new-architecture.md", "utf8");
     const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
     const h = crypto.createHash("sha256").update(m[2].replace(/\r\n/g, "\n").trim()).digest("hex");
     const lock = JSON.parse(fs.readFileSync("docs/adr/.adr-lock.json", "utf8"));
     lock.records["ADR-0008"] = h;
     fs.writeFileSync("docs/adr/.adr-lock.json", JSON.stringify(lock, null, 2) + "\n");
   '
   pnpm adr:check
   ```

### 3. Superseding an Existing Decision

When a architectural decision is replaced, modified, or evolved:

```bash
pnpm adr:supersede ADR-0001 --title "Modular Architecture v2" --area "Architecture & Layout"
```

The CLI automatically:
- Creates `docs/adr/0008-modular-architecture-v2.md` with `supersedes: "ADR-0001"`.
- Updates `ADR-0001` frontmatter with `status: "superseded by ADR-0008"` and `superseded_by: "ADR-0008"` (leaving body unchanged).
- Adds the new record to `docs/adr/.adr-lock.json`.
- Runs `pnpm adr:sync` to reflect the change across all documentation.

### 4. Renaming or Moving a Module Path

When a module or directory path is renamed or relocated:

```bash
pnpm adr:retarget src/modules/old-name src/modules/new-name
```

Updates `applies_to` and `enforced_by` across all active ADRs and re-synchronizes indexes without breaking cryptographic body locks.

### 5. Removing a Module Path

When a module is deleted:

```bash
pnpm adr:remove-path src/modules/legacy-name
```

- If an ADR exclusively governed this path, it is automatically marked `status: "deprecated"`.
- If an ADR governed multiple paths, only the deleted path is removed.

### 6. Verifying Compliance & Consistency

Before committing changes, execute the verification gate:

```bash
pnpm adr:check
```

This verifies:
- Frontmatter schema (id, title, status, date, decision-makers, area, applies_to, enforced_by).
- Strict ordering of all 6 canonical MADR 4.0 H2 sections.
- Bidirectional superseding links.
- Filesystem existence of `applies_to` and `enforced_by` for active decisions.
- Cryptographic body hash against `docs/adr/.adr-lock.json` and Git HEAD.
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
