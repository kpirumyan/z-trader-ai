# Z-Trader Execution Plans

## Active Plan: Langfuse Self-Improving Agent Flywheel

- **Governing Specification**: [ADR-0008: Langfuse-Native Self-Improving Agent Flywheel](./docs/adr/0008-langfuse-native-self-improving-agent-flywheel.md)
- **Current Autonomy Mode**: `Supervised` (human approval required for all `.agents/` and `docs/adr/` changes)

### Phase 1: Observability & Automated Signal Capture

- [ ] **1.1 Retire Legacy Promptfoo Scaffolding**: Remove `evals/` directory and update [`AGENTS.md`](./AGENTS.md) references to reflect the single-platform Langfuse stack.
- [ ] **1.2 Build Antigravity Transcript Exporter (`.agents/hooks/`)**: Implement incremental exporter reading `transcript_full.jsonl` (plus nested subagent transcripts) from cursor state and emitting `Session` / `Trace` / `Generation` / `Tool` / `Agent` observations with `version` (Git SHA + `.agents/` hash) and touched `src/modules/*` tags.
- [ ] **1.3 Implement Passive Gate & Feedback Scorer**: Extract `tool_error_count`, `gate_first_try_pass`, `gate_retry_count` (from `pnpm check:fast`, `vitest`, `adr:check`, `eslint`, `typecheck` runs), and `user_correction` signals into Langfuse Scores.
- [ ] **1.4 Wire Lifecycle Hook & CLI Sync**: Register the exporter in `.agents/hooks.json` (`Stop` event, fail-open with short timeout), add `pnpm langfuse:sync` script in [`package.json`](./package.json), and execute end-to-end trace self-audit via `langfuse-cli`.

### Phase 2: Error Analysis, Datasets & Evaluators

- [ ] **2.1 Configure Triage Infrastructure in Langfuse**: Create initial Score Configs and Annotation Queue via `langfuse-cli` for reviewing flagged dev-time traces.
- [ ] **2.2 Seed Golden Dataset v1**: Promote real failure and edge-case decision traces from Phase 1 into a versioned Langfuse Dataset.
- [ ] **2.3 Calibrate Evaluators & Experiment Runner**: Set up and calibrate Langfuse Evaluators (deterministic + LLM-as-a-Judge) and add a thin Langfuse Experiments SDK runner invoking `agy` against dataset items.

### Phase 3: Distillation Loop & Context Hygiene

- [ ] **3.1 Create Flywheel Distillation Skill (`.agents/skills/`)**: Guided workflow to query low-scoring traces from Langfuse, classify root causes (`Mechanical Gate -> ADR -> Skill -> Rule`), draft minimal fixes, and verify improvements against the Langfuse Dataset.
- [ ] **3.2 Establish Context Hygiene & Autonomy Policy**: Configure task-type governance matrix (`Supervised` vs. `Autonomous` per target artifact) and periodic skill/rule effectiveness review based on Langfuse trace telemetry.
