# Задачи по реализации захвата сигналов в Langfuse (для отдельных чатов)

Каждая задача ниже спроектирована как **самодостаточный промпт/спецификация для отдельного чата**. Перед началом работы в новом чате агент должен прочитать [PLANS.md](./PLANS.md) и профильный скилл `/langfuse` ([.agents/skills/langfuse/SKILL.md](.agents/skills/langfuse/SKILL.md)).

---

## Статус задач

| ID         | Задача                                                                                      | Зависимости | Статус     |
| :--------- | :------------------------------------------------------------------------------------------ | :---------- | :--------- |
| **TASK-1** | Обогащение `metadata` спана `agent-turn` и проброс `terminationReason` в `.agents/tracing/` | Нет         | `[x] Done` |
| **TASK-2** | Актуализация ADR-0008 (Supersede -> ADR-0009) под архитектуру Evaluators в Langfuse v4      | TASK-1      | `[x] Done` |
| **TASK-3** | Создание и верификация детерминированного Langfuse Code Evaluator (`agent-turn-signals`)    | TASK-1      | `[x] Done` |
| **TASK-4** | Создание и калибровка модельного судьи Langfuse LLM-as-a-Judge (`user-message-type`)        | TASK-1      | `[ ] Todo` |

---

## TASK-1: Обогащение `metadata` спана `agent-turn` и проброс `terminationReason` в `.agents/tracing/`

**Цель:** Доработать пайплайн трассировки в `.agents/hooks/langfuse-stop.ts` и `.agents/tracing/` так, чтобы на корневом спане хода `agent-turn` записывался полный **Evaluation Context** в `metadata`, необходимый для работы эвалюаторов Langfuse (без вызовов Scores API из кода).

**Ссылки на контекст:**

- План и контракты: [PLANS.md (§4.1)](./PLANS.md)
- Скиллы: [.agents/skills/langfuse/SKILL.md](.agents/skills/langfuse/SKILL.md), [.agents/skills/tdd/SKILL.md](C:/Users/Karen/.gemini/config/skills/tdd/SKILL.md)
- Затрагиваемые файлы:
  - [.agents/hooks/langfuse-stop.ts](.agents/hooks/langfuse-stop.ts)
  - [.agents/tracing/types.ts](.agents/tracing/types.ts)
  - [.agents/tracing/parser/turn-builder.ts](.agents/tracing/parser/turn-builder.ts)
  - [.agents/tracing/exporter.ts](.agents/tracing/exporter.ts)
  - [.agents/tracing/observations.ts](.agents/tracing/observations.ts)
  - Тесты в `.agents/tracing/tests/`

**Что нужно сделать (по TDD — сначала тесты, затем код):**

1. **Проброс `terminationReason` из хука `Stop`:**
   - В `StopHookInput` и `ParseTranscriptOptions` добавить опциональное поле `terminationReason?: string`.
   - В `.agents/hooks/langfuse-stop.ts` извлекать `str(data.terminationReason)` из JSON в `stdin` и передавать в `runStopHook`.
   - В `turn-builder.ts` на последнем распарсенном ходе транскрипта сохранять `metadata.terminationReason` (если передан). Если `terminationReason === "USER_CANCELED"`, выставлять `metadata.interrupted = true`, `level = "WARNING"` и `statusMessage = "Turn canceled by user (USER_CANCELED)"` даже в том случае, если в ходе уже был промежуточный текст ассистента.
2. **Список упавших тулов (`metadata.failedTools`):**
   - В `turn-builder.ts` собирать массив `failedTools: string[]` (например, `["edit_file (step 4)", "run_command:vitest (step 7)"]`, включая ошибки внутри субагентов) и класть в `metadata.failedTools` корневого спана `agent-turn`.
3. **Сводка прохождения гейтов (`metadata.gateSummary`):**
   - Вычислять для каждого хода объект `TurnGateSummary` по всем дочерним наблюдениям с `type === "evaluator"` или `type === "guardrail"` (включая вложенные наблюдения субагентов):
     - `totalRuns`: общее число запусков проверок в ходе,
     - `firstTryPassed`: `true`, если `totalRuns > 0` и ни одна проверка в ходе не упала (`level !== "ERROR"`), `false` если были падения, `null` если `totalRuns === 0`,
     - `finalPassed`: `true`, если `totalRuns > 0` и последняя проверка в ходе завершилась без ошибки (`level !== "ERROR"`), иначе `false` (или `null` при `totalRuns === 0`),
     - `retryCount`: число запусков проверок после первого упавшего гейта в рамках хода,
     - `failedGates`: массив уникальных имен упавших проверок (например, `["run_command:lint"]`).
   - Записывать `gateSummary` в `metadata.gateSummary` спана `agent-turn`.
4. **Контекст предыдущего хода диалога (`turnIndex > 1`):**
   - В `parseTranscriptTurns` (`turn-builder.ts`) добавлять в `metadata` каждого хода:
     - `hasPreviousTurn`: `boolean` (`true` для `turnIndex > 1`, `false` для `turnIndex === 1`),
     - для `turnIndex > 1`: `previousTurnInput` и `previousTurnOutput` (промпт пользователя и финальный ответ агента из хода `turnIndex - 1`, усеченные до 4000 символов).
   - В `observations.ts` (`emitRootObservation`) добавить `hasPreviousTurn: String(Boolean(turn.metadata.hasPreviousTurn))` в `propagateAttributes({ metadata: ... })`, чтобы в правилах эвалюаторов Langfuse работал фильтр верхнего уровня `metadata.hasPreviousTurn = "true"`.

**Критерии приемки (Definition of Done):**

- Написаны unit-тесты в `.agents/tracing/tests/` на все 4 пункта (`terminationReason: "USER_CANCELED"`, `failedTools`, `gateSummary` с ретраями и без гейтов, `previousTurnInput`/`previousTurnOutput`).
- Полностью проходит `pnpm check:fast`.

**Готовый промпт для запуска в новом чате:**

```text
/langfuse Прочитай PLANS.md и TASKS.md и выполни TASK-1 (Обогащение metadata спана agent-turn и проброс terminationReason в .agents/tracing/) по TDD с проверкой через pnpm check:fast.
```

---

## TASK-2: Актуализация ADR-0008 (Supersede -> ADR-0009) под архитектуру Evaluators в Langfuse v4

**Цель:** Привести архитектурный лог (`docs/adr/`) в соответствие с утвержденным разделением ответственности в [PLANS.md](./PLANS.md) (сырые факты собираются в `metadata` спана `agent-turn` в `.agents/tracing/`, а скоринг выполняется через Langfuse Code Evaluator и LLM-as-a-Judge).

**Ссылки на контекст:**

- План: [PLANS.md](./PLANS.md)
- Скилл управления ADR: [.agents/skills/adr/SKILL.md](.agents/skills/adr/SKILL.md)
- Текущая запись: [docs/adr/0008-langfuse-native-self-improving-agent-flywheel.md](docs/adr/0008-langfuse-native-self-improving-agent-flywheel.md)

**Что нужно сделать:**

1. Прочитать `.agents/skills/adr/SKILL.md` (раздел _3. Superseding an Existing Decision_).
2. Выполнить команду `pnpm adr:supersede ADR-0008 --title "Langfuse v4 Self-Improving Agent Flywheel and Evaluator Architecture" --area "AI & Observability"`.
3. В новом файле `docs/adr/0009-...` сохранить все инварианты ADR-0008 (изоляция проектов, отказ от Promptfoo, Git как источник истины для правил/скиллов, иерархия ремедиации), обновив раздел **4. Incremental Trajectory Ingestion & Signal Evaluation**:
   - Зафиксировать разделение **Tracing in `.agents/tracing/` (Evaluation Context in `metadata`) vs. Scoring in Langfuse Evaluators**.
   - Зафиксировать утвержденный набор сигналов (`tool_error_occurred`, `tool_error_count`, `gate_outcome`, `turn_interrupted`, `user_message_type`).
4. Обновить SHA-256 хэш в `docs/adr/.adr-lock.json` и выполнить `pnpm adr:sync` и `pnpm adr:check`.

**Критерии приемки (Definition of Done):**

- Полностью проходят `pnpm adr:check` и `pnpm check:fast`.

**Готовый промпт для запуска в новом чате:**

```text
Прочитай .agents/skills/adr/SKILL.md, PLANS.md и TASKS.md и выполни TASK-2 (Supersede ADR-0008 -> ADR-0009) с проверкой через pnpm adr:check и pnpm check:fast.
```

---

## TASK-3: Создание и верификация детерминированного Langfuse Code Evaluator (`agent-turn-signals`)

**Цель:** Создать, протестировать и включить в Langfuse детерминированный TypeScript Code Evaluator `agent-turn-signals`, который выставляет Scores `tool_error_occurred`, `tool_error_count`, `gate_outcome` и `turn_interrupted` на корневых наблюдениях `agent-turn`.

**Ссылки на контекст:**

- План и спецификация эвалюатора: [PLANS.md (§3 и §4.2)](./PLANS.md)
- Скилл Langfuse: [.agents/skills/langfuse/SKILL.md](.agents/skills/langfuse/SKILL.md), [.agents/skills/langfuse/references/setting-up-evals.md](.agents/skills/langfuse/references/setting-up-evals.md), [.agents/skills/langfuse/references/user-feedback.md](.agents/skills/langfuse/references/user-feedback.md), [.agents/skills/langfuse/references/cli.md](.agents/skills/langfuse/references/cli.md)
- Документация Langfuse: `https://langfuse.com/docs/evaluation/evaluation-methods/code-evaluators.md`

**Что нужно сделать:**

1. Сверить актуальную документацию `code-evaluators.md` и схему API эвалюаторов через `npx langfuse-cli api __schema`.
2. Проверить через `langfuse-cli` наблюдения, попадающие под фильтр `observation.name = "agent-turn"`, чтобы убедиться, что фильтр выбирает ровно корневые спаны ходов и не дублирует скоринг на дочерних спанах.
3. Создать в проекте Langfuse TypeScript **Code Evaluator** `agent-turn-signals` (и сохранить эталонный код функции `evaluate` в репозитории/документации при необходимости), возвращающий:
   - `tool_error_occurred` (`BOOLEAN`) + `comment` со списком `failedTools`,
   - `tool_error_count` (`NUMERIC`),
   - `gate_outcome` (`CATEGORICAL`: `passed_first_try` | `passed_after_retry` | `failed`) — **только если `gateSummary.totalRuns > 0`**,
   - `turn_interrupted` (`BOOLEAN`) + `comment` с `terminationReason`.
4. Привязать правило (Evaluation Rule) на спаны `name = "agent-turn"` (с backfill на существующие спаны).
5. Проверить через `langfuse-cli api scores list`, что Scores корректно создались на трейсах, и поделиться ссылкой на эвалюатор с пользователем.

**Готовый промпт для запуска в новом чате:**

```text
/langfuse Прочитай PLANS.md и TASKS.md и выполни TASK-3 (Создание и верификация детерминированного Langfuse Code Evaluator agent-turn-signals).
```

---

## TASK-4: Создание и калибровка модельного судьи Langfuse LLM-as-a-Judge (`user-message-type`)

**Цель:** Создать, откалибровать на датасете и запустить в Langfuse модельный эвалюатор `LLM-as-a-Judge` (`user-message-type`) для классификации разговорных сигналов пользователя (`steering` | `correction` | `repeated_instruction` | `positive_reaction` | `negative_reaction`).

**Ссылки на контекст:**

- План и спецификация судьи: [PLANS.md (§3 и §4.3)](./PLANS.md)
- Скилл Langfuse:
  - [.agents/skills/langfuse/SKILL.md](.agents/skills/langfuse/SKILL.md)
  - [.agents/skills/langfuse/references/judge-calibration.md](.agents/skills/langfuse/references/judge-calibration.md)
  - [.agents/skills/langfuse/references/prompt-engineering.md](.agents/skills/langfuse/references/prompt-engineering.md)
- Документация Langfuse:
  - `https://langfuse.com/docs/evaluation/evaluation-methods/llm-as-a-judge.md`
  - `https://langfuse.com/academy/evaluate/writing-evaluators.md`

**Что нужно сделать:**

1. Проверить наличие настроенного LLM Connection в проекте Langfuse (если нет — попросить пользователя добавить его в `Settings -> LLM Connections`).
2. По регламенту [judge-calibration.md](.agents/skills/langfuse/references/judge-calibration.md) создать эвалюатор `user-message-type` (`CATEGORICAL`: `steering`, `correction`, `repeated_instruction`, `positive_reaction`, `negative_reaction`) с правилом на `observation.name = "agent-turn"` и `metadata.hasPreviousTurn = "true"`, оставив правило **неактивным (inactive)** на время калибровки.
3. Составить 5-компонентный промпт судьи (`judge-calibration/user-message-type` в Prompt Management) с маппингом переменных `{{current_user_message}}` (`input`), `{{previous_user_message}}` (`metadata.previousTurnInput`) и `{{previous_agent_response}}` (`metadata.previousTurnOutput`), требующий сначала вывести краткий reasoning (в `comment`), а затем вердикт.
4. Сформировать калибровочный датасет `judge-calibration/user-message-type` из реальных ходов (`turnIndex > 1`) и/или репрезентативных примеров по всем 5 классам.
5. Запустить калибровочный эксперимент через Langfuse Experiments SDK, показать таблицу совпадений/ошибок пользователю и после достижения целевой точности (>= 85%) и аппрува пользователя активировать правило эвалюатора.

**Готовый промпт для запуска в новом чате:**

```text
/langfuse Прочитай PLANS.md, TASKS.md и .agents/skills/langfuse/references/judge-calibration.md и выполни TASK-4 (Создание и калибровка LLM-as-a-Judge эвалюатора user-message-type).
```
