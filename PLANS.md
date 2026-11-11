# Z-Trader Execution Plans

## Active Plan: Langfuse Self-Improving Agent Flywheel

- **Governing Specification**: [ADR-0008: Langfuse-Native Self-Improving Agent Flywheel](./docs/adr/0008-langfuse-native-self-improving-agent-flywheel.md)
- **Current Autonomy Mode**: `Supervised` (human approval required for all `.agents/` and `docs/adr/` changes)
- **Task Tracking & Status Execution**: Managed directly in [`TASKS.md`](./TASKS.md) (single source of truth for task checkmarks).

---

### Phase 1: Observability & Automated Signal Capture

- **1.1 Retire Legacy Promptfoo Scaffolding** _(Completed)_:
  - Removed obsolete `evals/` directory and updated [`AGENTS.md`](./AGENTS.md) references to unify on Langfuse.

- **1.2 Build Antigravity Transcript Exporter (`.agents/hooks/langfuse/`)** _(Architecture Agreed via /grill-me + Langfuse v6 Best Practices)_:
  - **Dependencies**: Official Langfuse OpenTelemetry-native JS/TS SDK v6 packages (`@langfuse/tracing`, `@langfuse/otel`, `@opentelemetry/sdk-node`) in `devDependencies` targeting the Langfuse v4 platform.
  - **Modular Architecture (Variant 3 - Dual Module in Native TypeScript `.ts`)**:
    - `.agents/hooks/langfuse/transcript-parser.ts`: Strongly-typed pure parsing engine reading `transcript_full.jsonl` (with fallback to `transcript.jsonl` and recursive discovery of subagent transcripts via `invoke_subagent`), deserializing double-encoded tool arguments, extracting clean `<USER_REQUEST>` inputs, preserving historical step timestamps (`startTime` / `endTime`), extracting token telemetry and reasoning CoT (`thinking`), and transforming steps into a structured observation tree.
    - `.agents/hooks/langfuse/langfuse-stop-hook.ts`: Thin lifecycle hook runner (executed directly via Node.js v24 native TypeScript execution) reading stdin from Antigravity, resolving `transcript_full.jsonl`, managing cursor state, handling the spool retry buffer, and exporting spans via `LangfuseSpanProcessor` (`@langfuse/otel`), `propagateAttributes`, `createTraceId`, and `startObservation(..., { asType, startTime })` (`@langfuse/tracing`), while outputting valid `{"decision": "allow"}` JSON on `stdout`.
    - `.agents/hooks/langfuse/tests/transcript-parser.test.ts`: Isolated Vitest unit tests verifying step parsing, double-encoded arg deserialization, clean user request extraction, historical timestamp preservation, token accounting, and tree hierarchy (`agent`, `generation`, `tool`).
  - **State & Cursor Management**:
    - Cursor saved in Antigravity session directory (`path.dirname(transcriptPath)/.langfuse-cursor.json`).
    - Complies with `no-temp-files-in-workspace` (zero repo pollution).
  - **Observation Hierarchy (Langfuse JS/TS SDK v6 `@langfuse/tracing` Best Practices)**:
    - Trace-level correlation wrapping root span creation via `propagateAttributes({ sessionId: conversationId, version, tags, metadata, traceName: "agent-turn" }, ...)` with alphanumeric metadata keys ≤ 200 chars (`gitSha`, `gitBranch`, `isDirty`, `turnIndex`), deterministic `traceId` via `await createTraceId(`${conversationId}-turn-${turnIndex}`)` (`parentSpanContext`), and low-cardinality root observation `"agent-turn"` (`{ asType: "agent" }`).
    - `Generation` (`{ asType: "generation" }`): Model responses with `model`, `usageDetails` (`input`, `output`, `cache_read_input_tokens`), CoT reasoning in both output message and `metadata.thinking`, and historical `startTime`/`endTime`.
    - `Tool` (`{ asType: "tool" }`): Tool invocations nested as siblings of the requesting `generation` under the orchestrating `agent` span, with deserialized arguments (`input`), results (`output`), error status (`level`, `statusMessage`), and historical `startTime`/`endTime`.
    - `Agent` (`{ asType: "agent" }`): Subagent invocations (`invoke_subagent`) emitted directly as distinct role-named `agent` observations (e.g., `subagent:codebase-researcher`, avoiding duplicate `tool` dispatch + `agent` spans) with recursive child observation linking (`agentSpan.startObservation(...)`).
  - **Resilience & Fail-Open**:
    - 5-second timeout on the `Stop` hook.
    - Soft fail-open: On network failure or timeout during `LangfuseSpanProcessor.forceFlush()` / `sdk.shutdown()`, logs warning strictly to `stderr`, saves unexported turns into a dedicated per-conversation spool file within the dedicated Spool Directory (`<appDataDir>/brain/.langfuse-spool/<conversationId>.json`), outputs `{"decision": "allow"}` on `stdout`, and exits with code 0 to never block interactive agent turns.
    - **Zero-Touch Cross-Session Spool Directory (Maildir Pattern)**:
      - Uses a dedicated spool folder `<appDataDir>/brain/.langfuse-spool/` where each session writes exclusively to its own `<conversationId>.json` (eliminating race conditions and duplicate registry files).
      - Lifecycle hooks (`SessionStart` bootstrap and `Stop` turn completion) inspect `<appDataDir>/brain/.langfuse-spool/` via an $O(1)$ filesystem scan and automatically flush any backlogged session files in the background (preserving historical `startTime`/`endTime` and deterministic `traceId`).
      - On successful flush, each spooled file is unlinked atomically (`fs.unlinkSync`).
      - Zero manual intervention: developers never need to manually run export scripts or remember to sync backlogged traces after network or cloud outages.
  - **Context & Git Anchoring**:
    - `version` (in `propagateAttributes`) & `release` (in `LangfuseSpanProcessor`): `${gitShortSha}-${agentsHash}` (SHA of current commit + SHA256 of `.agents/` customizations).
    - `tags`: Touched modules (`module:<name>` from `src/modules/*`) and invoked skills (`skill:<name>` from `.agents/skills/*`) extracted from tool calls.
    - `metadata`: Compact propagated metadata (`gitSha`, `gitBranch`, `isDirty`, `turnIndex`) plus root observation metadata.

- **1.3 Implement Passive Gate & Feedback Scorer**:
  - Extract deterministic signals from turn transcripts:
    - `tool_error_count`: Number of tool failures in the turn.
    - `gate_first_try_pass` & `gate_retry_count`: Pass/retry metrics for `pnpm check:fast`, `vitest`, `adr:check`, `eslint`, `typecheck`.
    - `user_correction`: Captured when subsequent user turn signals rollbacks or corrections.

- **1.4 Wire Lifecycle Hook & CLI Sync**:
  - Register lifecycle hooks in `.agents/hooks.json` under `Stop` (end of turn export + drain) and `SessionStart` (zero-touch automatic cross-session spool drain on session bootstrap).
  - Add `pnpm langfuse:sync` in [`package.json`](./package.json) as a convenience / CI fallback command for manual audit and dry-run synchronization.
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
