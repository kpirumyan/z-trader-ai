# Z-TraderBot

- Пиши по-русски. Для исследования, проектирования и реализации прочитай [главную роль](.agents/roles/project-lead.md), если она ещё не прочитана в этом чате.
- Для большой задачи используй [глобальный план](.agents/plans/global.md); для обнаружения диапазонов/каналов — [план диапазонов](.agents/plans/range-detection.md). Читай только план выбранной задачи. При общем «продолжай проект» начни с глобального плана.
- Для локальной правки, проверки ссылки или организации файлов читай только затронутые документы; роль и планы нужны лишь при изменении их содержания.
- Ссылки — указатели, не команда загрузить всё. Дополнительные файлы читай только при условии, указанном рядом со ссылкой; не обходи ссылки рекурсивно и не перечитывай неизменённый контекст.
- Текущий статус и следующий шаг хранятся в выбранном плане. Согласованные решения и проверенные результаты фиксируй в предназначенных для них документах по правилам плана; гипотезы не отмечай как результаты.
- Сообщения коммитов всегда пиши только на английском.
- Выбирай тест по уровню поведения: Vitest + React Testing Library (`tests/unit`) — для отдельных функций и React-компонентов в изоляции; Playwright (`tests/e2e`) — для пользовательских сценариев в настоящем браузере, включая интеграцию, хранение состояния и адаптивность. Это разные уровни, не взаимозаменяемые инструменты. Для сложного или критичного поведения сочетай unit/component-тесты с E2E; для простых изменений добавляй только осмысленную проверку соответствующего уровня. Команды: `pnpm test:unit` и `pnpm test:e2e`.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
