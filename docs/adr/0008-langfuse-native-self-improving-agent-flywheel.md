---
id: "ADR-0008"
title: "Langfuse-Native Self-Improving Agent Flywheel"
status: "accepted"
date: "2026-11-11"
decision-makers:
  - "Product Owner"
  - "Architect Agent"
area: "AI & Observability"
applies_to:
  - ".agents/skills/langfuse"
  - ".agents/hooks"
  - ".agents/tracing"
  - ".agents/memory"
  - ".agents/rules"
  - "AGENTS.md"
enforced_by:
  - ".agents/skills/langfuse/SKILL.md"
  - ".agents/skills/adr/scripts/adr-cli.mjs"
supersedes: null
superseded_by: null
---

# ADR-0008: Langfuse-Native Self-Improving Agent Flywheel

## Context and Problem Statement

Z-Trader is developed under an Autonomous Zero-Code Development model where AI coding agents author, verify, and evolve the codebase against strict modular boundaries ([ADR-0001](./0001-modular-architecture.md), [ADR-0002](./0002-boundary-enforcement-and-quarantine.md)) and executable ADRs ([ADR-0000](./0000-executable-adr-governance.md)). Because LLM coding agents do not retain state across sessions, engineering improvements only compound if execution trajectories, failure modes, and quality signals are systematically captured, evaluated, and distilled back into repository guardrails and context.

At the same time, introducing multiple overlapping AI evaluation tools (such as maintaining both Langfuse and Promptfoo) or mixing dev-time coding agent telemetry with future in-app runtime AI features creates dual sources of truth, synchronization friction, and context bloat.

How should Z-Trader architect its observability, evaluation, and context-distillation loop so that coding agents continuously improve without duplicating tooling, polluting application runtime bundles, or degrading repository context?

## Decision Drivers

- **Single Platform Source of Truth**: Eliminate overlapping schemas and glue scripts between tracing, datasets, experiments, and LLM-as-a-Judge evaluators.
- **Strict Dev-Time vs. Runtime Isolation**: Dev-time coding agent telemetry must never mix with future runtime in-app AI assistant telemetry in Langfuse or leak dependencies into `src/`.
- **Zero-Latency Agent Execution**: Capturing multi-step agent trajectories, token usage, and subagent graphs must not slow down individual tool calls during active coding sessions.
- **Causal Traceability to Agent Context**: Every trace in Langfuse must record which version of repository rules, skills, and commits governed the agent at execution time.
- **Mechanical-First Remediation & Anti-Context-Bloat**: Insights from failed traces must prioritize deterministic enforcement over endlessly appending prose instructions to `AGENTS.md`.
- **Graduated Autonomy Governance**: Support 100% human-approved distillation initially while structurally supporting task-scoped autonomous self-improvement later.

## Decision Outcome

Chosen option: **Single-Platform Langfuse-Native Dev-Time Flywheel with Git-Anchored Agent Context, Incremental `Stop`-Hook Ingestion, Three-Tier Evaluation Pyramid, and Graduated Autonomy Governance**, because it unifies tracing, dataset curation, and experimentation inside Langfuse while preserving Git as the sole authority for repository rules, skills, and mechanical gates.

### 1. Project & Perimeter Isolation (Dev-Time vs. Future Runtime AI)

- **Dedicated Langfuse Projects**: Dev-time agent engineering uses a dedicated Langfuse project configured via `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, and `LANGFUSE_BASE_URL` in `.env.local`. Future in-app AI features inside `src/modules/` must use a separate Langfuse project (`LANGFUSE_APP_*`).
- **Filesystem Quarantine**: All dev-time flywheel scripts, hooks, and experiment runners reside strictly within `.agents/` and never inside `src/`.

### 2. Langfuse-Only Evaluation Stack (Retirement of Promptfoo)

- **Single Evaluation Engine**: Langfuse natively provides observability traces, annotation queues, versioned datasets (`Datasets`), SDK-driven experiment runs (`Experiments`), and managed evaluators (`LLM-as-a-Judge`). Promptfoo (`evals/`) is retired from the stack to eliminate duplicate dataset definitions, dual UIs, and synchronization glue.

### 3. Authority Boundary Between Git and Langfuse Cloud

- **Git as Sole Authority for Coding Agent Context**: `AGENTS.md`, `.agents/rules/`, `.agents/skills/`, `.agents/memory/`, and `docs/adr/` are stored and edited exclusively in Git so they remain atomic with code branches and readable by Antigravity's local filesystem discovery.
- **Context Version Linking on Traces**: Every exported trace attaches a `version` / `release` identifier (Git commit SHA plus content hash of active `.agents/` customizations) and metadata listing invoked skills and touched `src/modules/*` slices.
- **Langfuse Cloud as Authority for Judges & Datasets**: Evaluator prompts (calibrated via Langfuse Prompt Management) and Golden Datasets (versioned via Langfuse Dataset Versions) live natively in Langfuse so live trace failures can be promoted directly into regression items.

### 4. Incremental Trajectory Ingestion & Passive Signal Extraction

- **End-of-Turn `Stop` Hook Export**: Rather than invoking network requests on every `PostToolUse` step, a lifecycle hook on the `Stop` event incrementally parses new steps from Antigravity's `transcript_full.jsonl` (and recursively links subagent transcripts as `agent` observations) into a structured Langfuse trace (`sessionId = conversationId`, `generation` observations with token counts and `thinking`, and `tool` spans).
- **Deterministic Gate Scores**: The exporter passively extracts execution signals from the turn transcript and records them as Langfuse Scores without re-running heavy builds:
  - `tool_error_count`: count of failed tool invocations in the turn.
  - `gate_first_try_pass` and `gate_retry_count`: whether `pnpm check:fast`, `vitest`, `adr:check`, `eslint`, or `typecheck` succeeded on the first execution or required retries.
  - `user_correction`: scored on the preceding trace when the subsequent user turn rolls back or corrects agent output.

### 5. Three-Tier Evaluation Pyramid

1. **Tier 1 — Online Session Radar (100% of Dev Sessions)**: Continuous passive tracing and deterministic gate scoring across all daily coding sessions.
2. **Tier 2 — Targeted Decision Datasets (Micro-Evals in Langfuse Datasets)**: Failing decision points extracted from Tier 1 traces (e.g., skill selection, ADR lookup, module boundary planning) are added to Langfuse Datasets and executed via the Langfuse Experiments SDK to validate rule or skill edits in seconds.
3. **Tier 3 — End-to-End Sandbox Benchmarks**: Full task runs in isolated git worktrees gated by `pnpm check:fast`, reserved for comparing major model upgrades.

### 6. Remediation Hierarchy & Graduated Autonomy

- **Strict Remediation Order**: When triaging failure patterns in Langfuse, fixes must be applied at the highest deterministic layer possible:
  1. **Mechanical Gate** (`eslint`, `depcruise`, `knip`, `adr:check`, unit/E2E test)
  2. **Architectural Decision Record** (`docs/adr/`)
  3. **Modular Skill / Lifecycle Hook** (`.agents/skills/`, `.agents/hooks/`)
  4. **Contextual Rule / Memory** (`.agents/rules/`, `.agents/memory/`, `AGENTS.md`)
- **Context Hygiene**: Any newly added rule or skill modification must demonstrate measurable improvement on Tier 2 datasets or Tier 1 error rates; stale or uninvoked rules are pruned during periodic reviews.
- **Graduated Autonomy Tiers**:
  - **Supervised Mode (Default / Initial Stage)**: Agents analyze Langfuse traces, curate candidate dataset items, and propose diffs to `.agents/` or `docs/adr/`, requiring explicit human approval before activation.
  - **Task-Scoped Autonomous Mode (Future Stage)**: Enabled selectively per task type, permitting agents to autonomously append regression cases and update bounded `.agents/memory/` or skill refinements verified by passing Langfuse experiments, while keeping `docs/adr/`, mechanical gates, and root `AGENTS.md` human-gated.

## Confirmation and Enforcement

- **ADR Governance Gate (`pnpm adr:check`)**: Validates frontmatter schema, canonical section structure, active path existence, and cryptographic body lock in `docs/adr/.adr-lock.json`.
- **Langfuse Self-Audit Protocol (`.agents/skills/langfuse/SKILL.md`)**: Requires end-to-end trace emission and verification via `langfuse-cli` against Langfuse observability best practices (`model`, token usage, span hierarchy, observation types, and clean input/output).

## Consequences

### Positive

- Unifies live agent observability, failure triage, dataset versioning, and experiments inside a single platform (Langfuse) with zero glue code for Promptfoo.
- Captures complete Antigravity reasoning trajectories, token telemetry, subagent graphs, and Z-Trader quality gate outcomes with zero mid-turn latency overhead.
- Prevents `AGENTS.md` and `.agents/` context rot by enforcing a mechanical-first remediation hierarchy and version-linked empirical evaluation.
- Cleanly separates dev-time engineering telemetry from future in-app AI assistant features.

### Negative

- Requires maintaining a custom transcript-to-Langfuse ingestion script in `.agents/hooks/` tailored to Antigravity's JSONL transcript schema.
- Relies on Langfuse availability (cloud or self-hosted) for dataset storage and judge execution, mitigated by non-blocking fail-open behavior in the `Stop` hook so local coding never halts if offline.

## Rejected Alternatives

- **Dual-Stack Langfuse + Promptfoo (`evals/`)**: Rejected because modern Langfuse natively covers datasets, experiment runners, and LLM-as-a-Judge; keeping Promptfoo duplicates schemas and requires custom bidirectional sync scripts for a dev-time coding flywheel that does not need red-teaming.
- **Single Shared Langfuse Project for Dev-Time and Runtime App AI**: Rejected because mixing coding-agent traces with end-user trading terminal AI traces pollutes dashboards, scores, and datasets.
- **Storing Coding Agent Rules/Skills in Langfuse Prompt Management**: Rejected because Antigravity discovers `AGENTS.md`, `.agents/rules/`, and `.agents/skills/` from the local filesystem and those instructions must remain branch-atomic with code and ADRs in Git.
- **Per-Step Real-Time Hook Streaming (`PostToolUse`)**: Rejected because Antigravity hooks execute synchronously; network calls on every file read or command execution would degrade interactive agent responsiveness.
