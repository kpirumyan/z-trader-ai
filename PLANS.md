# План реализации: Захват сигналов качества (Langfuse Capturing Signals) в Z-Trader

> **Основание:** [Langfuse Academy — Capturing signals](https://langfuse.com/academy/monitoring/capturing-signals), [Writing good evaluators](https://langfuse.com/academy/evaluate/writing-evaluators), [Choosing what to evaluate](https://langfuse.com/academy/evaluate/choosing-what-to-evaluate), [What does a good trace look like?](https://langfuse.com/docs/observability/best-practices) и [ADR-0008](docs/adr/0008-langfuse-native-self-improving-agent-flywheel.md).

---

## 1. Архитектурная концепция и разделение ответственности

В **Z-Trader** конечный веб-терминал (`src/modules/*`) не содержит пользовательского ИИ-чата, а dev-time телеметрия строго изолирована в `.agents/` ([ADR-0008 §1](docs/adr/0008-langfuse-native-self-improving-agent-flywheel.md)). Следовательно, объектом мониторинга в Langfuse выступает **кодинг-агент Antigravity** (Autonomous Zero-Code Development flywheel):

- **Пользователь (User):** Разработчик / Product Owner в Antigravity IDE.
- **Приложение (Application):** Кодинг-агент Antigravity и его субагенты (экспортируются через `.agents/hooks/langfuse-stop.ts`).
- **Среда (Environment):** Репозиторий, компилятор TypeScript, тестовые раннеры (`vitest`, `playwright`) и архитектурные гейты (`pnpm check:fast`, `adr:check`, `depcruise`, `eslint`, `knip`).

### Принцип разделения «Tracing vs. Scoring» (по канонам Langfuse v4)

1. **Код в `.agents/tracing/` отвечает исключительно за Tracing (сбор сырых фактов):**
   - Экспортер (`Stop`-хук) не вызывает Scores API и не размазывает логику скоринга по коду репозитория.
   - Все факты о ходе работы агента, необходимые для оценки (ошибки тулов, результаты прогона гейтов, точная причина остановки хода из `stdin` хука `Stop`, контекст предыдущего хода диалога), записываются как **Evaluation Context** в `metadata` корневого спана `agent-turn` ([Best Practices — Add metadata for context](https://langfuse.com/docs/observability/best-practices#add-metadata-for-context)).
2. **Платформа Langfuse (Evaluators) отвечает за Scoring (выставление оценок):**
   - **Детерминированные сигналы (P0)** вычисляются одним **Langfuse Code Evaluator** (`agent-turn-signals` на TypeScript), который запускается на каждом корневом спане `name = "agent-turn"` и возвращает массив Scores.
   - **Разговорные сигналы (P1)** вычисляются модельным эвалюатором **Langfuse LLM-as-a-Judge** (`user-message-type`), который запускается на спанах `name = "agent-turn"` только со 2-го хода сессии (`metadata.hasPreviousTurn = "true"`).

---

## 2. Что из статьи `Capturing signals` исключено (Out of Scope)

1. **Browser SDK (`@langfuse/browser`) и UI-кнопки 👍/👎 в `src/`:** В торговом терминале нет пользовательского ИИ, а системные кнопки 👍/👎 внутри интерфейса чата Antigravity IDE отправляют телеметрию напрямую в Google и не попадают ни в `transcript_full.jsonl`, ни в локальные хуки `.agents/hooks.json`.
2. **Сигналы саппорт-ботов и inline-автокомплита:** `handoff_to_human`, `ticket_reopened`, `tab_suggestion_dismissed`.
3. **Отложенный анализ выживаемости строк через `git blame` (`commit_survived_unreverted`):** Сложность реализации (Effort: L — склейка будущих коммитов с историческими `traceId`) не оправдана при наличии мгновенных детерминированных сигналов прохождения гейтов (`gate_outcome`) и разговорного сигнала коррекции (`user_message_type`).
4. **Отдельный Score на переключение модели (`model_switched`):** По правилу Langfuse [_Tie every metric to a decision_](https://langfuse.com/academy/evaluate/choosing-what-to-evaluate#tie-every-metric-to-a-decision), само по себе переключение модели в IDE неоднозначно (часто делается ради экономии квоты или перехода от планирования к кодингу). Смена модели остается как `event`-спан `settings:model-change` и штатный атрибут `model` на генерациях, по которому группируются остальные Scores.

---

## 3. Утвержденная матрица сигналов (Target Metric Set)

| Priority | Категория (по статье)                            | Score Name                                  | Data Type              | Значения / Формат                                                                                                                                                                            | Источник данных в спане `agent-turn`                                                                             | Эвалюатор в Langfuse                                                                |
| :------- | :----------------------------------------------- | :------------------------------------------ | :--------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------- |
| **P0**   | **Outcome** (среда / инструменты)                | `tool_error_occurred`<br>`tool_error_count` | `BOOLEAN`<br>`NUMERIC` | `true` / `false` (`1` / `0`)<br>`0, 1, 2...` (+ список упавших тулов в `comment`)                                                                                                            | `metadata.errorCount`, `metadata.failedTools`                                                                    | Code Evaluator `agent-turn-signals`                                                 |
| **P0**   | **Outcome** (среда / гейты качества)             | `gate_outcome`                              | `CATEGORICAL`          | • `passed_first_try`<br>• `passed_after_retry`<br>• `failed`<br>_(Не выставляется на ходах, где гейты не запускались — Unlabeled)_                                                           | `metadata.gateSummary` (агрегация дочерних спанов `evaluator` и `guardrail`)                                     | Code Evaluator `agent-turn-signals`                                                 |
| **P0**   | **Behavioral** (поведение пользователя)          | `turn_interrupted`                          | `BOOLEAN`              | `true` / `false` (+ причина из `terminationReason` в `comment`)                                                                                                                              | `metadata.interrupted`, `metadata.terminationReason`                                                             | Code Evaluator `agent-turn-signals`                                                 |
| **P1**   | **Conversation** (реакция в следующем сообщении) | `user_message_type`                         | `CATEGORICAL`          | • `steering` (норма)<br>• `correction` (ошибка агента)<br>• `repeated_instruction` (игнор правила)<br>• `positive_reaction`<br>• `negative_reaction`<br>_(+ объяснение причины в `comment`)_ | `input` (текущий промпт хода `N`) + `metadata.previousTurnInput` и `metadata.previousTurnOutput` (из хода `N-1`) | LLM-as-a-Judge `user-message-type` (только при `metadata.hasPreviousTurn = "true"`) |

---

## 4. Спецификация доработок по слоям

### 4.1. Контракт обогащения `metadata` в `.agents/tracing/`

1. **Проброс `terminationReason` из Antigravity `Stop`-хука:**
   - В [.agents/hooks/langfuse-stop.ts](.agents/hooks/langfuse-stop.ts) читать поле `terminationReason` (а также `fullyIdle`, `continuationActive`) из JSON в `stdin` и передавать в `StopHookInput`.
   - Для последнего (активного) хода в транскрипте записывать `terminationReason` в `metadata.terminationReason`.
   - Если `terminationReason === "USER_CANCELED"`, принудительно выставлять на этом ходе `metadata.interrupted = true`, `level = "WARNING"` и `statusMessage = "Turn canceled by user (USER_CANCELED)"` (даже если до отмены модель уже успела вывести промежуточный текст в раннем шаге хода).

2. **Детализация ошибок тулов (`metadata.failedTools`):**
   - В [.agents/tracing/parser/turn-builder.ts](.agents/tracing/parser/turn-builder.ts) при подсчете `errorCount` собирать список упавших вызовов инструментов (включая ошибки внутри субагентов, если они есть) в компактный массив строк `failedTools: string[]` (например, `["edit_file (step 4)", "run_command:vitest (step 7)"]`).

3. **Агрегация результатов проверок (`metadata.gateSummary`):**
   - Обходить дочерние наблюдения хода (типы `evaluator` и `guardrail`, уже размечаемые в [.agents/tracing/parser/classifier.ts](.agents/tracing/parser/classifier.ts), включая вложенные спаны субагентов):
     ```ts
     export interface TurnGateSummary {
       totalRuns: number;
       firstTryPassed: boolean | null; // null, если totalRuns === 0
       finalPassed: boolean | null; // null, если totalRuns === 0
       retryCount: number; // число повторных запусков гейтов после первого падения
       failedGates: string[]; // уникальные имена упавших гейтов, например ["run_command:lint"]
     }
     ```
   - Записывать `gateSummary` в `metadata` корневого спана `agent-turn`.

4. **Контекст предыдущего хода для разговорных сигналов (`turnIndex > 1`):**
   - В `parseTranscriptTurns` ([.agents/tracing/parser/turn-builder.ts](.agents/tracing/parser/turn-builder.ts)) для каждого хода с `idx > 0` (где существует предыдущий ход `parsedTurns[idx - 1]` или предыдущий слайс):
     - `metadata.hasPreviousTurn = true` (и `"false"` для `turnIndex === 1`), плюс пробрасывать `hasPreviousTurn: String(Boolean(turn.metadata.hasPreviousTurn))` в `propagateAttributes` в [.agents/tracing/observations.ts](.agents/tracing/observations.ts), чтобы фильтр правила в Langfuse мог отбирать `metadata.hasPreviousTurn = "true"`.
     - `metadata.previousTurnInput`: промпт пользователя из хода `N-1` (с безопасным усечением до 4000 символов).
     - `metadata.previousTurnOutput`: финальный ответ ассистента из хода `N-1` (с безопасным усечением до 4000 символов).

---

### 4.2. Спецификация Langfuse Code Evaluator (`agent-turn-signals`)

- **Целевое правило (Rule):** `observation.name = "agent-turn"` (или `isRootObservation = true`).
- **Язык:** TypeScript (erasable syntax, без внешних библиотек).
- **Логика `evaluate({ observation: { metadata } })`:**
  1. Читает `errorCount = Number(metadata?.errorCount ?? 0)` и `failedTools = Array.isArray(metadata?.failedTools) ? metadata.failedTools : []`.
     - Добавляет Score `tool_error_occurred` (`BOOLEAN`, `value: errorCount > 0`, `comment`: список из `failedTools` или `"No tool errors"`).
     - Добавляет Score `tool_error_count` (`NUMERIC`, `value: errorCount`).
  2. Читает `gateSummary = metadata?.gateSummary`. Если `gateSummary && gateSummary.totalRuns > 0`:
     - Определяет категорию:
       - `gateSummary.firstTryPassed === true && gateSummary.finalPassed === true` -> `"passed_first_try"`
       - `gateSummary.finalPassed === true` -> `"passed_after_retry"`
       - иначе -> `"failed"`
     - Добавляет Score `gate_outcome` (`CATEGORICAL`, `value`, `comment`: количество запусков, ретраев и список `failedGates`).
     - Если `totalRuns === 0`, Score `gate_outcome` **не возвращается** (ход остается Unlabeled для гейтов).
  3. Читает `interrupted = Boolean(metadata?.interrupted)` и `terminationReason = metadata?.terminationReason`.
     - `isInterrupted = interrupted || terminationReason === "USER_CANCELED"`.
     - Добавляет Score `turn_interrupted` (`BOOLEAN`, `value: isInterrupted`, `comment`: причина остановки или `"Completed normally"`).

---

### 4.3. Спецификация Langfuse LLM-as-a-Judge (`user-message-type`)

- **Целевое правило (Rule):** `observation.name = "agent-turn"` И `metadata.hasPreviousTurn = "true"`.
- **Маппинг переменных:**
  - `{{current_user_message}}` -> `observation.input`
  - `{{previous_user_message}}` -> `observation.metadata.previousTurnInput`
  - `{{previous_agent_response}}` -> `observation.metadata.previousTurnOutput`
- **Выходной Score:** `user_message_type` (`CATEGORICAL`):
  - `steering` — обычное продолжение работы, ответ на вопрос агента (например, в `/grill-me`), уточнение следующей задачи.
  - `correction` — пользователь указывает на ошибку, неверное действие или неправильное понимание в предыдущем ответе агента.
  - `repeated_instruction` — пользователь вынужден повторить требование или правило, которое уже давал ранее, но агент его проигнорировал.
  - `positive_reaction` — явное подтверждение успеха или благодарность без коррекции.
  - `negative_reaction` — выражение фрустрации или недовольства без конкретной технической правки.
- **Процесс запуска (по `.agents/skills/langfuse/references/judge-calibration.md`):**
  1. Сначала создать эвалюатор с **неактивным правилом**.
  2. Собрать калибровочный датасет `judge-calibration/user-message-type` (10–20 примеров, покрывающих все 5 категорий).
  3. Прогнать калибровку через Experiments SDK до достижения согласия >= 85% по классам, утвердить с пользователем и активировать правило.
