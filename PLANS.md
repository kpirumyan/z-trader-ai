# Z-Trader Execution Plans

## Active Plan: Langfuse Self-Improving Agent Flywheel

- **Governing Specification**: [ADR-0008: Langfuse-Native Self-Improving Agent Flywheel](./docs/adr/0008-langfuse-native-self-improving-agent-flywheel.md)
- **Current Autonomy Mode**: `Supervised` (human approval required for all `.agents/` and `docs/adr/` changes)
- **Task Tracking & Status Execution**: Managed directly in [`TASKS.md`](./TASKS.md) (single source of truth for task checkmarks).

---

### Phase 1: Observability & Automated Signal Capture

- **1.1 Retire Legacy Promptfoo Scaffolding** _(Completed)_:
  - Removed obsolete `evals/` directory and updated [`AGENTS.md`](./AGENTS.md) references to unify on Langfuse.

- **1.2 Build Antigravity Transcript Exporter (`.agents/hooks/`)** _(Architecture Agreed via /grill-me)_:
  - **Dependencies**: Official Langfuse v4 OpenTelemetry-native SDK packages (`@langfuse/tracing`, `@langfuse/otel`, `@opentelemetry/sdk-node`) in `devDependencies` (not the legacy `langfuse` v3 package).
  - **Modular Architecture (Variant 3 - Dual Module in Native TypeScript `.ts`)**:
    - `transcript-parser.ts`: Strongly-typed pure parsing engine reading `transcript_full.jsonl` (and nested subagent transcripts via `invoke_subagent`), extracting token telemetry, reasoning CoT (`thinking`), and transforming steps into a structured observation tree.
    - `langfuse-stop-hook.ts`: Thin lifecycle hook runner (executed directly via Node.js v24 native TypeScript execution) reading stdin from Antigravity, managing cursor state, handling the spool retry buffer, and exporting spans via `LangfuseSpanProcessor` (`@langfuse/otel`), `propagateAttributes`, and `startObservation(..., { asType })` (`@langfuse/tracing`).
    - `tests/transcript-parser.test.ts`: Isolated Vitest unit tests verifying step parsing, token accounting, and tree hierarchy.
  - **State & Cursor Management**:
    - Cursor saved in Antigravity session directory (`path.dirname(transcriptPath)/.langfuse-cursor.json`).
    - Complies with `no-temp-files-in-workspace` (zero repo pollution).
  - **Observation Hierarchy (Langfuse v4 `@langfuse/tracing` Best Practices)**:
    - Trace-level correlation via `propagateAttributes({ sessionId: conversationId, version, tags, metadata, traceName })` and root observation (`startObservation` / `startActiveObservation`) per Turn (`${conversationId}-turn-${turnIndex}`).
    - `Generation` (`{ asType: "generation" }`): Model responses with `model`, `usageDetails` (`input`, `output`, `cache_read_input_tokens`), and CoT reasoning in `metadata.thinking`.
    - `Tool` (`{ asType: "tool" }`): Tool invocations with arguments (`input`), results (`output`), and error status (`level`, `statusMessage`).
    - `Agent` (`{ asType: "agent" }`): Subagent invocations (`invoke_subagent`) with recursive child observation linking (`agentSpan.startObservation(...)`).
  - **Resilience & Fail-Open**:
    - 5-second timeout on the `Stop` hook.
    - Soft fail-open: On network failure or timeout during `LangfuseSpanProcessor.forceFlush()` / `shutdown()`, logs warning to stderr, saves unexported batch into `.pending-export.json` next to the cursor, and exits with code 0 to never block interactive agent turns.
  - **Context & Git Anchoring**:
    - `version` / `release`: `${gitShortSha}-${agentsHash}` (SHA of current commit + SHA256 of `.agents/` customizations).
    - `tags`: Touched modules (`src/modules/*`) and invoked skills (`.agents/skills/*`) extracted from tool calls.
    - `metadata`: Full Git SHA, branch name, and `isDirty` working copy status.

- **1.3 Implement Passive Gate & Feedback Scorer**:
  - Extract deterministic signals from turn transcripts:
    - `tool_error_count`: Number of tool failures in the turn.
    - `gate_first_try_pass` & `gate_retry_count`: Pass/retry metrics for `pnpm check:fast`, `vitest`, `adr:check`, `eslint`, `typecheck`.
    - `user_correction`: Captured when subsequent user turn signals rollbacks or corrections.

- **1.4 Wire Lifecycle Hook & CLI Sync**:
  - Register `langfuse-stop-hook.ts` in `.agents/hooks.json` under the `Stop` lifecycle event.
  - Add `pnpm langfuse:sync` in [`package.json`](./package.json) for manual / dry-run synchronization.
  - Perform trace self-audit via `langfuse-cli` to verify trace schema compliance.

---

### Phase 2: Error Analysis, Datasets & Evaluators

- **2.1 Configure Triage Infrastructure in Langfuse**:
  - Configure initial Score Configs and Annotation Queue via `langfuse-cli` for reviewing flagged dev-time traces.
- **2.2 Seed Golden Dataset v1**:
  - Promote real failure and edge-case decision traces from Phase 1 into a versioned Langfuse Golden Dataset.
- **2.3 Calibrate Evaluators & Experiment Runner**:
  - Set up and calibrate Langfuse Evaluators (deterministic + LLM-as-a-Judge) and build a lightweight experiment runner invoking `agy` against golden dataset items.

---

### Phase 3: Distillation Loop & Context Hygiene

- **3.1 Create Flywheel Distillation Skill (`.agents/skills/`)**:
  - Guided skill workflow to triage low-scoring traces, classify root causes according to the remediation hierarchy (`Mechanical Gate -> ADR -> Skill -> Rule`), draft fixes, and verify against datasets.
- **3.2 Establish Context Hygiene & Autonomy Policy**:
  - Configure task-type governance matrix (`Supervised` vs. `Autonomous`) and prune stale context rules based on empirical trace data.
