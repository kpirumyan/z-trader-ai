# Z-Trader

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

- Для большой задачи используй [глобальный план](.agents/plans/global.md); для обнаружения диапазонов/каналов — [план диапазонов](.agents/plans/range-detection.md). Читай только план выбранной задачи. При общем «продолжай проект» начни с глобального плана.

- Текущий статус и следующий шаг хранятся в выбранном плане. Согласованные решения и проверенные результаты фиксируй в предназначенных для них документах по правилам плана; гипотезы не отмечай как результаты.

- [Реестр задач](.agents/plans/tasks.md) — единый источник истины (SSOT) для состава, кодов, статусов ([x]/[ ]) и текущего шага всех задач. Планы и архитектурные контракты описывают цели, архитектуру, спецификации и критерии приёмки, ссылаясь на реестр задач, и не дублируют чеклисты или логи прогонов.

- При завершении задачи или этапа обязательно проведи ревизию затронутых файлов задач, планов и архитектурных контрактов: обнови статусы и текущий шаг в реестре задач (свернув промежуточные подзадачи завершённого этапа), оставь в планах только актуальные решения и статус, а из архитектурных контрактов удали временные планы проектирования конкретной задачи (пофайловые перечни, сигнатуры и промежуточные шаги), сохранив только действующие архитектурные инварианты и критерии приёмки.
