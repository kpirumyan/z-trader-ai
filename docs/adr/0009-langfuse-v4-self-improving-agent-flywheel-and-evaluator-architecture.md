---
id: "ADR-0009"
title: "Langfuse v4 Self-Improving Agent Flywheel and Evaluator Architecture"
status: "accepted"
date: "2026-11-16"
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
supersedes: "ADR-0008"
superseded_by: null
---

# ADR-0009: Langfuse v4 Self-Improving Agent Flywheel and Evaluator Architecture

## Context and Problem Statement

Supersedes [ADR-0008](./0008-langfuse-native-self-improving-agent-flywheel.md). Z-Trader is developed under an Autonomous Zero-Code Development model where AI coding agents author, verify, and evolve the codebase against strict modular boundaries ([ADR-0001](./0001-modular-architecture.md), [ADR-0002](./0002-boundary-enforcement-and-quarantine.md)) and executable ADRs ([ADR-0000](./0000-executable-adr-governance.md)). Because LLM coding agents do not retain state across sessions, engineering improvements only compound if execution trajectories, failure modes, and quality signals are systematically captured, evaluated, and distilled back into repository guardrails and context.

[ADR-0008](./0008-langfuse-native-self-improving-agent-flywheel.md) originally coupled trajectory ingestion with passive score computation inside the local `Stop`-hook exporter (`tool_error_count`, `gate_first_try_pass`, `gate_retry_count`, `user_correction`). In Langfuse v4, mixing tracing ingestion with score emission inside repository exporter code duplicates evaluation logic, makes scoring thresholds and categories hard to backfill or iterate on without re-parsing transcripts, and lacks structured multi-turn conversation context or explicit hook `terminationReason` handling for user cancellations (`USER_CANCELED`).

How should Z-Trader evolve its Langfuse-native observability and evaluation architecture so that `.agents/tracing/` remains strictly responsible for raw trajectory and evaluation-context capture while Langfuse v4 Evaluators handle deterministic and conversational scoring without breaking existing isolation, Git-authority, and remediation invariants?

## Decision Drivers

- **Clean Separation of Tracing vs. Scoring (Langfuse v4)**: Repository tracing code must record raw facts as structured Evaluation Context on `agent-turn` metadata, while Langfuse Evaluators (Code Evaluators and LLM-as-a-Judge) compute, version, and backfill Scores on the platform.
- **Single Platform Source of Truth**: Eliminate overlapping schemas and glue scripts between tracing, datasets, experiments, Code Evaluators, and LLM-as-a-Judge evaluators.
- **Strict Dev-Time vs. Runtime Isolation**: Dev-time coding agent telemetry must never mix with future runtime in-app AI assistant telemetry in Langfuse or leak dependencies into `src/`.
- **Zero-Latency Agent Execution**: Capturing multi-step agent trajectories, token usage, and subagent graphs must not slow down individual tool calls during active coding sessions.
- **Causal Traceability to Agent Context**: Every trace in Langfuse must record which version of repository rules, skills, and commits governed the agent at execution time.
- **Mechanical-First Remediation & Anti-Context-Bloat**: Insights from failed traces must prioritize deterministic enforcement over endlessly appending prose instructions to `AGENTS.md`.
- **Calibrated Judge Governance & Graduated Autonomy**: LLM-as-a-Judge evaluators must be empirically calibrated on labeled datasets before rule activation, supporting human-approved distillation initially and task-scoped autonomous self-improvement later.

## Decision Outcome

Chosen option: **Langfuse v4 Self-Improving Agent Flywheel with Strict Tracing-vs-Scoring Separation, Metadata Evaluation Context, and Managed Evaluators**, because it preserves all project isolation, Promptfoo retirement, Git-authority, and remediation invariants of [ADR-0008](./0008-langfuse-native-self-improving-agent-flywheel.md) while delegating all Score generation to declarative Langfuse Code Evaluators and calibrated LLM-as-a-Judge rules operating over rich `agent-turn` observation metadata.

### 1. Project & Perimeter Isolation (Dev-Time vs. Future Runtime AI)

- **Dedicated Langfuse Projects**: Dev-time agent engineering uses a dedicated Langfuse project configured via `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, and `LANGFUSE_BASE_URL` in `.env.local`. Future in-app AI features inside `src/modules/` must use a separate Langfuse project (`LANGFUSE_APP_*`).
- **Filesystem Quarantine**: All dev-time flywheel scripts, hooks, and experiment runners reside strictly within `.agents/` and never inside `src/`.

### 2. Langfuse-Only Evaluation Stack (Retirement of Promptfoo)

- **Single Evaluation Engine**: Langfuse natively provides observability traces, annotation queues, versioned datasets (`Datasets`), SDK-driven experiment runs (`Experiments`), TypeScript Code Evaluators, and managed `LLM-as-a-Judge` evaluators. Promptfoo (`evals/`) remains retired from the stack to eliminate duplicate dataset definitions, dual UIs, and synchronization glue.

### 3. Authority Boundary Between Git and Langfuse Cloud

- **Git as Sole Authority for Coding Agent Context**: `AGENTS.md`, `.agents/rules/`, `.agents/skills/`, `.agents/memory/`, and `docs/adr/` are stored and edited exclusively in Git so they remain atomic with code branches and readable by Antigravity's local filesystem discovery.
- **Context Version Linking on Traces**: Every exported trace attaches a `version` / `release` identifier (Git commit SHA plus content hash of active `.agents/` customizations) and metadata listing invoked skills and touched `src/modules/*` slices.
- **Langfuse Cloud as Authority for Evaluators, Judges & Datasets**: Code Evaluator definitions, calibrated Judge prompts (via Langfuse Prompt Management), and Golden/Calibration Datasets (versioned via Langfuse Dataset Versions) live natively in Langfuse so live trace failures can be promoted directly into regression items and historical spans can be backfilled.

### 4. Incremental Trajectory Ingestion & Signal Evaluation

- **Tracing in `.agents/tracing/` (Evaluation Context in `metadata`) vs. Scoring in Langfuse Evaluators**:
  - **Repository Tracing Layer (`.agents/hooks/langfuse-stop.ts` & `.agents/tracing/`)**: Incrementally parses new steps from Antigravity's `transcript_full.jsonl` on the `Stop` hook (recursively linking subagent transcripts as `agent` observations) into structured Langfuse traces (`sessionId = conversationId`, root `agent-turn` observation, `generation` observations with token counts and `thinking`, and classified `tool` / `retriever` / `evaluator` / `guardrail` / `event` observations). The exporter **does not invoke the Langfuse Scores API**; instead, it writes all raw execution facts as **Evaluation Context** into `metadata` on the root `agent-turn` span:
    - `terminationReason` (from `Stop` hook `stdin`) and `interrupted` (`true` plus `level: "WARNING"` when `terminationReason === "USER_CANCELED"`),
    - `errorCount` and `failedTools: string[]` (failed tool calls across the turn and nested subagents),
    - `gateSummary: TurnGateSummary` (`totalRuns`, `firstTryPassed`, `finalPassed`, `retryCount`, `failedGates`) aggregated from child `evaluator` and `guardrail` observations,
    - `hasPreviousTurn`, `previousTurnInput`, and `previousTurnOutput` (for turns with `turnIndex > 1`, with `hasPreviousTurn` propagated as a string attribute via `propagateAttributes` for Langfuse rule filtering).
  - **Platform Scoring Layer (Langfuse Evaluators)**: All quality and behavioral signals are computed inside Langfuse from the root `agent-turn` observation and its `metadata`:
    - **Code Evaluator (`agent-turn-signals`, TypeScript)** running on `observation.name = "agent-turn"`.
    - **LLM-as-a-Judge (`user-message-type`)** running on `observation.name = "agent-turn"` filtered by `metadata.hasPreviousTurn = "true"` (created inactive and activated only after reaching `>= 85%` agreement on calibration dataset `judge-calibration/user-message-type`).
- **Approved Target Signal Set**:
  - `tool_error_occurred` (`BOOLEAN`): `true` / `false` (`errorCount > 0`), with `failedTools` summary in `comment` (Code Evaluator `agent-turn-signals`).
  - `tool_error_count` (`NUMERIC`): integer count of failed tool calls in the turn including nested subagents (Code Evaluator `agent-turn-signals`).
  - `gate_outcome` (`CATEGORICAL`): `passed_first_try` | `passed_after_retry` | `failed` derived from `metadata.gateSummary`; omitted (unlabeled) when `gateSummary.totalRuns === 0` (Code Evaluator `agent-turn-signals`).
  - `turn_interrupted` (`BOOLEAN`): `true` / `false` derived from `metadata.interrupted` or `terminationReason === "USER_CANCELED"`, with stop reason in `comment` (Code Evaluator `agent-turn-signals`).
  - `user_message_type` (`CATEGORICAL`): `steering` | `correction` | `repeated_instruction` | `positive_reaction` | `negative_reaction` with brief reasoning in `comment`, evaluated against `input` and `metadata.previousTurnInput` / `metadata.previousTurnOutput` (LLM-as-a-Judge `user-message-type`).

### 5. Three-Tier Evaluation Pyramid

1. **Tier 1 — Online Session Radar (100% of Dev Sessions)**: Continuous passive tracing and platform-side evaluator scoring (`agent-turn-signals` and `user-message-type`) across all daily coding sessions.
2. **Tier 2 — Targeted Decision Datasets (Micro-Evals in Langfuse Datasets)**: Failing decision points extracted from Tier 1 traces (e.g., skill selection, ADR lookup, module boundary planning, judge calibration) are added to Langfuse Datasets and executed via the Langfuse Experiments SDK to validate rule, prompt, or skill edits in seconds.
3. **Tier 3 — End-to-End Sandbox Benchmarks**: Full task runs in isolated git worktrees gated by `pnpm check:fast`, reserved for comparing major model upgrades.

### 6. Remediation Hierarchy & Graduated Autonomy

- **Strict Remediation Order**: When triaging failure patterns in Langfuse, fixes must be applied at the highest deterministic layer possible:
  1. **Mechanical Gate** (`eslint`, `depcruise`, `knip`, `adr:check`, unit/E2E test)
  2. **Architectural Decision Record** (`docs/adr/`)
  3. **Modular Skill / Lifecycle Hook** (`.agents/skills/`, `.agents/hooks/`)
  4. **Contextual Rule / Memory** (`.agents/rules/`, `.agents/memory/`, `AGENTS.md`)
- **Context Hygiene**: Any newly added rule or skill modification must demonstrate measurable improvement on Tier 2 datasets or Tier 1 signal rates; stale or uninvoked rules are pruned during periodic reviews.
- **Graduated Autonomy Tiers**:
  - **Supervised Mode (Default / Initial Stage)**: Agents analyze Langfuse traces, curate candidate dataset items, calibrate evaluators, and propose diffs to `.agents/` or `docs/adr/`, requiring explicit human approval before activation.
  - **Task-Scoped Autonomous Mode (Future Stage)**: Enabled selectively per task type, permitting agents to autonomously append regression cases and update bounded `.agents/memory/` or skill refinements verified by passing Langfuse experiments, while keeping `docs/adr/`, mechanical gates, and root `AGENTS.md` human-gated.

## Confirmation and Enforcement

- **ADR Governance Gate (`pnpm adr:check`)**: Validates frontmatter schema, canonical section structure, bidirectional `ADR-0008` <-> `ADR-0009` superseding links, active path existence, and cryptographic body lock in `docs/adr/.adr-lock.json`.
- **Tracing Unit Suite (`pnpm test:unit` / `pnpm check:fast`)**: Verifies `.agents/tracing/` metadata enrichment (`terminationReason`, `failedTools`, `gateSummary`, `previousTurnInput`/`previousTurnOutput`, `hasPreviousTurn` propagation) without direct Scores API calls.
- **Langfuse Self-Audit & Evaluator Verification (`.agents/skills/langfuse/SKILL.md`)**: Requires verifying exported traces, Code Evaluator backfill/online runs, and LLM-as-a-Judge calibration accuracy (`>= 85%`) via `langfuse-cli` and Langfuse Experiments SDK.

## Consequences

### Positive

- Decouples local transcript ingestion from scoring logic, allowing Score definitions, comments, and categorical mappings to evolve and backfill directly in Langfuse without modifying or re-running `.agents/hooks/langfuse-stop.ts`.
- Eliminates ambiguous or noisy ad-hoc score names (`gate_first_try_pass`, `gate_retry_count`, `user_correction`) in favor of a cohesive 5-signal taxonomy (`tool_error_occurred`, `tool_error_count`, `gate_outcome`, `turn_interrupted`, `user_message_type`) aligned with Langfuse v4 Evaluators.
- Captures accurate user cancellation signals via `Stop`-hook `terminationReason` (`USER_CANCELED`) and multi-turn conversational context (`previousTurnInput`/`previousTurnOutput`) on `agent-turn` spans.
- Preserves full dev-time vs. runtime isolation, Git authority over agent instructions, and mechanical-first remediation discipline.

### Negative

- Requires keeping the metadata schema in `.agents/tracing/` synchronized with the field names expected by Langfuse Code Evaluator `agent-turn-signals` and LLM-as-a-Judge `user-message-type` variable mappings.
- Relies on Langfuse Evaluator availability and a configured project LLM Connection for running `user-message-type` online scoring, mitigated by non-blocking fail-open behavior in the `Stop` hook and inactive-first judge calibration.

## Rejected Alternatives

- **Exporter-Side Score Emission in `.agents/tracing/` (Keeping [ADR-0008](./0008-langfuse-native-self-improving-agent-flywheel.md) §4)**: Rejected because computing and posting Scores inside the `Stop` hook couples scoring rules to repository deploys, prevents zero-code backfills in Langfuse UI, and forces duplicate client/auth handling outside the platform's native Evaluator engine.
- **Dedicated `model_switched` Score**: Rejected because IDE model switches frequently reflect quota management or intentional planning-to-coding transitions rather than quality failures; model changes remain recorded as `settings:model-change` events and `model` attributes on `generation` observations for grouping Scores.
- **Deferred `git blame` Commit Survival Tracking (`commit_survived_unreverted`)**: Rejected because correlating future Git commits back to historical `traceId` values adds high operational complexity for marginal gain over immediate `gate_outcome` and `user_message_type` signals.
- **Dual-Stack Langfuse + Promptfoo (`evals/`) & `PostToolUse` Streaming**: Remains rejected for the reasons established in [ADR-0008](./0008-langfuse-native-self-improving-agent-flywheel.md).
