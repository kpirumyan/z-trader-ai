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

### 1.2 Build Antigravity Transcript Exporter (`.agents/hooks/`)

_(Архитектура согласована через /grill-me)_

- [ ] **1.2.1 Dependencies**: Add Langfuse v4 OpenTelemetry-native packages (`@langfuse/tracing`, `@langfuse/otel`, `@opentelemetry/sdk-node`) to `devDependencies` in [`package.json`](./package.json).
- [ ] **1.2.2 Core Transcript Parser (`.agents/hooks/transcript-parser.ts`)**:
  - [ ] Implement parsing of Antigravity `transcript_full.jsonl` lines in native TypeScript (`.ts`).
  - [ ] Map turns to root trace observations grouped under `sessionId = conversationId`.
  - [ ] Extract model responses and tokens (`usageDetails`) into `{ asType: "generation" }` observations with `thinking` CoT metadata.
  - [ ] Transform tool calls and execution outputs into `{ asType: "tool" }` observations.
  - [ ] Implement recursive discovery and parsing of subagent transcripts (`invoke_subagent`) into `{ asType: "agent" }` observations.
- [ ] **1.2.3 Parser Unit Tests (`.agents/hooks/tests/transcript-parser.test.ts`)**:
  - [ ] Write Vitest test suite validating turn slicing, token summation, and observation tree hierarchy (`generation`, `tool`, `agent`) against fixture transcripts.
- [ ] **1.2.4 Lifecycle Stop Hook Runner (`.agents/hooks/langfuse-stop-hook.ts`)**:
  - [ ] Implement stdin reader for Antigravity `Stop` hook context (executed directly via Node.js v24 native `.ts` support).
  - [ ] Implement cursor management (`path.dirname(transcriptPath)/.langfuse-cursor.json`).
  - [ ] Implement soft fail-open with 5s timeout and local spool buffer (`.pending-export.json`).
  - [ ] Implement OpenTelemetry `NodeSDK` + `LangfuseSpanProcessor` (`@langfuse/otel`) initialization, attribute propagation (`propagateAttributes`), and typed observation emission (`startObservation(..., { asType })`).
- [ ] **1.2.5 Context & Git Anchoring**:
  - [ ] Calculate `release` / `version` identifier (`gitShortSha-agentsHash`).
  - [ ] Auto-tag touched modules (`src/modules/*`) and invoked skills (`.agents/skills/*`).
  - [ ] Attach Git metadata (full SHA, branch, `isDirty`).
- [ ] **1.2.6 Verification**:
  - [ ] Validate dry-run execution against the live conversation transcript.
  - [ ] Run fast verification suite (`pnpm check:fast`).

### 1.3–1.4 Предстоящие шаги Фазы 1

_(Требуют отдельного обсуждения перед детализацией и кодированием)_

- [ ] **1.3 Implement Passive Gate & Feedback Scorer**: извлечение метрик качества (`tool_error_count`, `gate_first_try_pass`, `gate_retry_count`, `user_correction`) из транскрипта и запись их в Langfuse Scores.
- [ ] **1.4 Wire Lifecycle Hook & CLI Sync**: регистрация хука `Stop` в `.agents/hooks.json` с таймаутом, добавление команды `pnpm langfuse:sync` в [`package.json`](./package.json) и сквозной аудит схемы через `langfuse.cmd`.

---

## Phase 2: Error Analysis, Datasets & Evaluators

_(Требует обсуждения после завершения Фазы 1)_

- [ ] **2.1 Configure Triage Infrastructure in Langfuse**: Score Configs и Annotation Queue для анализа проблемных сессий.
- [ ] **2.2 Seed Golden Dataset v1**: отбор и версионирование реальных кейсов ошибок из логов первой фазы.
- [ ] **2.3 Calibrate Evaluators & Experiment Runner**: калибровка судей (LLM-as-a-Judge) и скрипт прогона экспериментов через SDK.

---

## Phase 3: Distillation Loop & Context Hygiene

_(Требует обсуждения после завершения Фазы 2)_

- [ ] **3.1 Create Flywheel Distillation Skill (`.agents/skills/distill`)**: полуавтоматический процесс анализа ошибок и генерации исправлений по иерархии `Gate -> ADR -> Skill -> Rule`.
- [ ] **3.2 Establish Context Hygiene & Autonomy Policy**: регламент актуализации контекста, матрица автономности (`Supervised` / `Autonomous`) и удаление устаревших правил.
