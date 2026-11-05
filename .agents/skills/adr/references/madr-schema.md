# Hybrid MADR 4.0 + AI-Agent Executable Schema Reference

This reference defines the exact file naming, YAML frontmatter, Markdown body structure, and synchronization rules enforced by `pnpm adr:check`.

## Table of Contents

1. [File Naming & Location](#1-file-naming--location)
2. [YAML Frontmatter Specification](#2-yaml-frontmatter-specification)
3. [Canonical MADR 4.0 H2 Section Order](#3-canonical-madr-40-h2-section-order)
4. [Active vs. Historical Path Enforcement](#4-active-vs-historical-path-enforcement)
5. [Cryptographic Body Lock (`docs/adr/.adr-lock.json`)](#5-cryptographic-body-lock-docsadr-adr-lockjson)
6. [Complete ADR Template](#6-complete-adr-template)

---

## 1. File Naming & Location

- All ADRs live in a flat directory: `docs/adr/XXXX-<kebab-case-slug>.md` (e.g., `docs/adr/0005-market-data-streaming-and-transport-separation.md`).
- Never move superseded or deprecated ADRs into subdirectories (`archive/`, `superseded/`), because doing so breaks relative links across code comments, commits, and other ADRs.
- The 4-digit filename prefix `XXXX` must match the numeric portion of `id: "ADR-XXXX"` in the YAML frontmatter.

---

## 2. YAML Frontmatter Specification

Every ADR must begin with a YAML frontmatter block delimited by `---`:

```yaml
---
id: "ADR-0005"
title: "Out-of-React Market Data Streaming & Transport Separation"
status: "accepted"
date: "2026-10-25"
decision-makers:
  - "Product Owner"
  - "Architect Agent"
area: "Market Data & Streaming"
applies_to:
  - "src/shared/contracts"
  - "src/modules/market-data"
  - "src/modules/chart"
enforced_by:
  - ".dependency-cruiser.cjs"
  - "src/modules/market-data/tests/market-stream.test.ts"
supersedes: null
superseded_by: null
---
```

### Field Rules

| Field | Type | Validation Rule |
| :--- | :--- | :--- |
| `id` | `string` | Format `"ADR-XXXX"` matching the filename prefix `XXXX-*.md`. |
| `title` | `string` | Non-empty decision title; must match the `# ADR-XXXX: <title>` H1 heading. |
| `status` | `string` | One of `"proposed"`, `"accepted"`, `"rejected"`, `"deprecated"`, or `"superseded by ADR-YYYY"`. |
| `date` | `string` | ISO 8601 date `"YYYY-MM-DD"`. |
| `decision-makers` | `string[]` | Non-empty list of roles or agents (e.g., `["Product Owner", "Architect Agent"]`). |
| `area` | `string` | Architectural domain label displayed in index tables (e.g., `"Tooling & Governance"`). |
| `applies_to` | `string[]` | Repo-relative paths governed by this ADR. Must be non-empty for `accepted`/`proposed` ADRs. |
| `enforced_by` | `string[]` | Repo-relative paths to tests, linter configs, or schemas that mechanically verify the decision. Must be non-empty for `accepted` ADRs. |
| `supersedes` | `string \| null` | `null` or `"ADR-XXXX"`. Must match `superseded_by` on the target ADR. |
| `superseded_by` | `string \| null` | `null` or `"ADR-YYYY"`. Must match `status: "superseded by ADR-YYYY"` and `supersedes` on `ADR-YYYY`. |

---

## 3. Canonical MADR 4.0 H2 Section Order

Immediately after the YAML frontmatter, the Markdown body must start with `# ADR-XXXX: <Title>` and contain these **six H2 headings in strict order**, each with non-empty prose:

1. `## Context and Problem Statement`
   - Explain the architectural problem, domain forces, and concrete failure modes that motivated the decision.
2. `## Decision Drivers`
   - Bullet list of key constraints, quality attributes, and non-negotiable requirements.
3. `## Decision Outcome`
   - State the `Chosen option: ...` clearly, followed by numbered `###` subsections detailing the architectural design and boundaries.
4. `## Confirmation and Enforcement`
   - Document how every path listed in `enforced_by` mechanically verifies compliance (lint rules, dependency-cruiser rules, contract schemas, unit/E2E tests).
5. `## Consequences`
   - Include `### Positive` and `### Negative` trade-offs resulting from the decision.
6. `## Rejected Alternatives`
   - Bullet list of concrete alternatives considered and the technical reasons they were rejected.

---

## 4. Active vs. Historical Path Enforcement

- **Active ADRs (`status: "accepted"`)**: Every path in `applies_to` and `enforced_by` must be a valid repo-relative path (no `..` parent traversal or leading `/`) that currently exists on disk.
- **Historical ADRs (`status: "deprecated"`, `"rejected"`, or `"superseded by ADR-YYYY"`)**: Path existence on disk is **not** enforced by `pnpm adr:check`. This allows legacy modules to be deleted (`pnpm adr:remove-path`) or renamed (`pnpm adr:retarget`) without corrupting or deleting historical ADRs.

---

## 5. Cryptographic Body Lock (`docs/adr/.adr-lock.json`)

`docs/adr/.adr-lock.json` stores the SHA-256 hex digest of each ADR's normalized Markdown body (LF line endings, frontmatter stripped, outer whitespace trimmed):

```json
{
  "version": 1,
  "records": {
    "ADR-0000": "1ab639775924100f299174a42829e4f54895788c974636ad4eb05f1766558b53"
  }
}
```

- During `pnpm adr:check`, each ADR's current Markdown body hash is compared against `docs/adr/.adr-lock.json`.
- If `docs/adr/.adr-lock.json` exists in `git HEAD`, `pnpm adr:check` also verifies that no existing hash in `HEAD:docs/adr/.adr-lock.json` was modified or removed, and that no locked ADR file was deleted.

---

## 6. Complete ADR Template

```markdown
---
id: "ADR-XXXX"
title: "<Decision Title>"
status: "accepted"
date: "YYYY-MM-DD"
decision-makers:
  - "Product Owner"
  - "Architect Agent"
area: "<Architectural Area>"
applies_to:
  - "src/modules/<module>"
enforced_by:
  - "src/modules/<module>/tests/<module>.test.ts"
supersedes: null
superseded_by: null
---

# ADR-XXXX: <Decision Title>

## Context and Problem Statement

<Describe the architectural context, technical problem, and why a decision is needed.>

## Decision Drivers

- **<Driver 1>**: <Explanation>
- **<Driver 2>**: <Explanation>

## Decision Outcome

Chosen option: **<Summary of Chosen Option>**.

### 1. <Primary Mechanism or Boundary>

- <Detail>

## Confirmation and Enforcement

- **<Test or Gate Name> (`src/modules/<module>/tests/<module>.test.ts`)**: <How it enforces the decision.>

## Consequences

### Positive

- <Positive impact>

### Negative

- <Trade-off or operational cost>

## Rejected Alternatives

- **<Alternative 1>**: <Why it was rejected.>
```
