# Задачи разработки Z-Trader (Roadmap Checklist)

Единый журнал задач и текущего статуса реализации по шагам дорожной карты.
Используется архитектурной сессией (`/spec`) для определения следующего шага и сборочной сессией (`/build`) для фиксации выполненных этапов.

---

## Шаг 1 — Общий фундамент (`src/shared/`)

- [x] `shared-contracts` — Базовые интерфейсы расширяемости (`WidgetDefinition`, `WidgetProps`, `Instrument`) в `src/shared/contracts/`
- [x] `shared-lib-cn` — Фасад объединения классов `cn` на базе `clsx` в `src/shared/lib/cn.ts`
- [x] `shared-theme` — Дизайн-токены в `src/shared/theme/tokens.css`, хук `useTheme`, компонент `ThemeToggle` в `src/shared/theme/`
- [x] `shared-storage` — Отказоустойчивая обёртка `safeStorage` с дуальным API (string + JSON/Zod) и автоматическим in-memory fallback в `src/shared/storage/`
- [x] `shared-ui` — Пропущено: в легаси-коде отсутствуют общие UI-примитивы (компоненты инкапсулируются в доменных модулях)
- [x] `shared-globals-cleanup` — Перенос дизайн-токенов в `tokens.css` и импорт в `app/globals.css` (остаточная зачистка классов компонентов перенесена в Шаг 6)

---

## Шаг 2 — Каталог инструментов (`src/modules/instruments/`)

- [ ] `instruments-schema` — Zod-схемы валидации финансовых инструментов (`schema.ts`)
- [ ] `instruments-ui` — Компонент `InstrumentSearchDialog` с изолированным CSS-модулем
- [ ] `instruments-module` — Публичный шов `index.ts`, паспорт `README.md`, тесты чёрного ящика в `src/modules/instruments/tests/`

---

## Шаг 3 — Потоковые рыночные данные и индикаторы

- [ ] `market-data-stream` — Потоковый сервис подписок вне React (`src/modules/market-data/model/market-stream.ts`) с Zod-валидацией котировок
- [ ] `indicators-engine` — Модуль чистых математических функций расчёта технических индикаторов в `src/modules/indicators/`

---

## Шаг 4 — Доменные виджеты (`src/modules/`)

- [ ] `widget-order-book` — Виджет биржевого стакана заявок (DOM) с CSS-модулем и интеграцией с потоком данных (`src/modules/order-book/`)
- [ ] `widget-time-and-sales` — Виджет ленты сделок с CSS-модулем (`src/modules/time-and-sales/`)
- [ ] `widget-chart` — Виджет графика на Canvas-движке `lightweight-charts` с индикаторами (`src/modules/chart/`)

---

## Шаг 5 — Оконный менеджер и корень сборки

- [ ] `workspace-store` — Zustand-стор оконного менеджера (`src/modules/workspace/model/workspace-store.ts`)
- [ ] `workspace-storage` — Валидация Zod и персистентность раскладки окон в `safeStorage`
- [ ] `workspace-shell` — Оболочка терминала (`TerminalShell`, `TerminalWindow`, `WorkspaceCanvas`, `TopBar`, `StatusBar`) с CSS-модулями и телеметрией в статус-баре
- [ ] `composition-root` — Реестр сборки виджетов (`src/composition/widgets.ts`) и интеграция терминала

---

## Шаг 6 — Зачистка легаси-директорий и финальная изоляция

- [ ] `cleanup-legacy` — Удаление устаревших директорий и компонентов в `app/`: `storage-recovery-banner`, `components`, `constants`, `hooks`, `instruments`, `storage`, `types`
- [ ] `cleanup-shell` — Сокращение `app/` до базовых `layout.tsx`, `page.tsx`, `globals.css`
- [ ] `strict-gates` — Перевод `knip` в строгий режим (`--max-issues 0`), финальный аудит `dependency-cruiser` и прогон всех тестов
