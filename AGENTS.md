# Z-TraderBot

- Пиши по-русски. Используй Git Bash и pnpm.
- Никогда не создавай временные файлы, скрипты и другие вспомогательные артефакты в рабочей директории проекта; используй выделенную scratch/temp-папку текущей задачи.
- Главный агент по умолчанию — [оркестратор](.agents/roles/orchestrator.md); прочитай эту роль один раз. Сабагент читает только назначенную ему роль и не становится оркестратором.
- Реализация поведения — через TDD: сначала тесты и подтверждённый RED, затем код. Полная цепочка сабагентов вызывается скиллом [$tdd-workflow](.agents/skills/tdd-workflow/SKILL.md).
- [Архитектор](.agents/skills/architect/SKILL.md) — скилл для мозгового штурма по явному вызову. [Исследователь](.agents/skills/researcher/SKILL.md) — только для исследования большой задачи или её подзадач. Не загружай эти скиллы для обычной реализации, проверки или организации файлов.
- Для большой задачи используй [глобальный план](.agents/plans/global.md); для обнаружения диапазонов/каналов — [план диапазонов](.agents/plans/range-detection.md). Читай только план выбранной задачи. При общем «продолжай проект» начни с глобального плана.
- Для локальной правки, проверки ссылки или организации файлов читай только затронутые документы; планы нужны лишь при изменении их содержания.
- Ссылки — указатели, не команда загрузить всё. Дополнительные файлы читай только при условии, указанном рядом со ссылкой; не обходи ссылки рекурсивно и не перечитывай неизменённый контекст.
- Текущий статус и следующий шаг хранятся в выбранном плане. Согласованные решения и проверенные результаты фиксируй в предназначенных для них документах по правилам плана; гипотезы не отмечай как результаты.
- Проверки: `pnpm typecheck`, `pnpm lint`, `pnpm test:unit`, `pnpm test:e2e`. Полный хук: `pnpm check` (TypeScript → ESLint → все тесты); также запускается Husky перед коммитом. В TDD-цепочке проверки запускает только оркестратор.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
