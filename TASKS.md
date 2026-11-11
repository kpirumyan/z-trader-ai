# Z-Trader Active Tasks

- **Active Plan**: [PLANS.md](./PLANS.md)
- **Governing Specification**: [ADR-0008: Langfuse-Native Self-Improving Agent Flywheel](./docs/adr/0008-langfuse-native-self-improving-agent-flywheel.md)
- **Status Convention**: All progress checkmarks are maintained in this file. Granular subtasks are added only after architectural review via `/grill-me`.

---

## Phase 1: Observability & Automated Signal Capture

### 1.1 Retire Legacy Promptfoo Scaffolding

- [x] Remove obsolete `evals/` directory and configuration files.
- [x] Update [`AGENTS.md`](./AGENTS.md) references to reflect the unified Langfuse stack.
- [x] Commit changes (`d7211a0`).

### 1.2 Build Antigravity Transcript Exporter (`.agents/hooks/langfuse/`)

_(Architecture agreed via /grill-me + refined per Langfuse SDK v6 Best Practices)_

- [x] **1.2.1 Dependencies**: Add Langfuse OpenTelemetry-native JS/TS SDK v6 packages (`@langfuse/tracing`, `@langfuse/otel`, `@opentelemetry/sdk-node`) to `devDependencies` in [`package.json`](./package.json) and wire `.agents/hooks/` into [`tsconfig.json`](./tsconfig.json), [`vitest.config.mts`](./vitest.config.mts), and [`knip.json`](./knip.json).
- [x] **1.2.2 Core Transcript Parser (`.agents/hooks/langfuse/transcript-parser.ts`)**:
  - [x] Implement parsing of Antigravity `transcript_full.jsonl` lines in native TypeScript (`.ts`), including clean `<USER_REQUEST>` extraction, double-encoded `tool_calls[].args` deserialization, and historical step timestamps (`startTime` / `endTime`).
  - [x] Map turns to low-cardinality `"agent-turn"` (`{ asType: "agent" }`) root observations with deterministic `traceId` (`${conversationId}-turn-${turnIndex}`) grouped under `sessionId = conversationId`.
  - [x] Extract model responses and tokens (`usageDetails`) into `{ asType: "generation" }` observations with `thinking` CoT in output and `metadata.thinking`.
  - [x] Transform tool calls and execution outputs into `{ asType: "tool" }` observations nested as siblings of the requesting `generation`.
  - [x] Implement recursive discovery and parsing of subagent transcripts (`invoke_subagent`) directly into distinct role-named `{ asType: "agent" }` observations (without duplicate `tool` dispatch spans).
- [x] **1.2.3 Parser Unit Tests (`.agents/hooks/langfuse/tests/transcript-parser.test.ts`)**:
  - [x] Write Vitest test suite validating turn slicing, clean prompt extraction, arg deserialization, timestamp preservation, token summation, and observation tree hierarchy (`agent`, `generation`, `tool`) against fixture transcripts.
- [x] **1.2.4 Lifecycle Stop Hook Runner (`.agents/hooks/langfuse/langfuse-stop-hook.ts`)**:
  - [x] Implement stdin reader for Antigravity `Stop` hook context (executed directly via Node.js v24 native `.ts` support), resolving sibling `transcript_full.jsonl` and outputting `{"decision": "allow"}` on `stdout`.
  - [x] Implement cursor management (`path.dirname(transcriptPath)/.langfuse-cursor.json`).
  - [x] Implement soft fail-open with 5s timeout and local spool buffer (`.pending-export.json`).
  - [x] Implement OpenTelemetry `NodeSDK` + `LangfuseSpanProcessor` (`@langfuse/otel`) initialization (`release`, `environment`), outer attribute propagation (`propagateAttributes` with alphanumeric keys ≤ 200 chars), deterministic `createTraceId`, and typed observation emission (`startObservation(..., { asType, startTime })`).
- [x] **1.2.5 Context & Git Anchoring**:
  - [x] Calculate `release` / `version` identifier (`gitShortSha-agentsHash`).
  - [x] Auto-tag touched modules (`src/modules/*`) and invoked skills (`.agents/skills/*`).
  - [x] Attach Git metadata (`gitSha`, `gitBranch`, `isDirty`, `turnIndex`).
- [x] **1.2.6 Verification**:
  - [x] Validate dry-run execution against the live conversation transcript.
  - [x] Run fast verification suite (`pnpm check:fast`).

### 1.3–1.4 Upcoming Phase 1 Steps

_(Requires separate discussion prior to detail refinement and implementation)_

- [ ] **1.3 Implement Passive Gate & Feedback Scorer**: extract quality metrics (`tool_error_count`, `gate_first_try_pass`, `gate_retry_count`, `user_correction`) from turn transcripts and record them as Langfuse Scores.
- [ ] **1.4 Wire Lifecycle Hook & CLI Sync**: register lifecycle hooks (`Stop` for export/flush and `SessionStart` for zero-touch automatic cross-session spool directory draining) in `.agents/hooks.json` with timeouts, add `pnpm langfuse:sync` convenience command in [`package.json`](./package.json) (for CI / manual audits), and perform end-to-end trace schema verification via `langfuse.cmd`.

---

## Phase 2: Error Analysis, Datasets & Evaluators

_(Requires discussion following Phase 1 completion)_

- [ ] **2.1 Configure Triage Infrastructure in Langfuse**: Score Configs and Annotation Queue for reviewing flagged dev-time traces.
- [ ] **2.2 Seed Golden Dataset v1**: curate and version real failure and edge-case decision traces from Phase 1 logs.
- [ ] **2.3 Calibrate Evaluators & Experiment Runner**: calibrate evaluators (LLM-as-a-Judge) and experiment runner invoking `agy` against golden dataset items.

---

## Phase 3: Distillation Loop & Context Hygiene

_(Requires discussion following Phase 2 completion)_

- [ ] **3.1 Create Flywheel Distillation Skill (`.agents/skills/distill`)**: guided workflow for error analysis and patch generation following the remediation hierarchy `Mechanical Gate -> ADR -> Skill -> Rule`.
- [ ] **3.2 Establish Context Hygiene & Autonomy Policy**: context maintenance protocol, autonomy matrix (`Supervised` / `Autonomous`), and empirical rule pruning based on trace data.
