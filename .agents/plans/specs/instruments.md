---
name: instruments
type: module
status: approved
target_path: src/modules/instruments
composition_point: none
e2e_required: false
---

# Specification: instruments

## 1. Purpose & Scope

### 1.1 In-Scope Responsibilities
- Предоставление независимого вертикального доменного модуля каталога финансовых инструментов (`src/modules/instruments/`).
- Определение и реэкспорт типов финансовых инструментов (`Instrument`, `InstrumentCatalogProvider`, `InstrumentSearchDialogProps`).
- Валидация структур инструментов и списков каталога через runtime-схемы Zod (`instrumentSchema`, `instrumentCatalogSchema`).
- Поставка неизменяемого списка инструментов по умолчанию (`DEFAULT_INSTRUMENTS`) и дефолтных заголовков окон (`DEFAULT_WINDOW_KIND_LABELS`).
- Реализация асинхронного сервиса каталога инструментов (`demoInstrumentCatalog`) с регистронезависимым поиском по тикеру и наименованию.
- Реализация доступного модального React-компонента поиска инструментов (`InstrumentSearchDialog`) на базе нативного `<dialog>` с современными веб-стандартами (семантический `<search>`, декларативный light-dismiss `closedby="any"` с бэкдроп-фолбэком, нативный `onCancel`, `useDeferredValue` для быстрого ввода).
- Реализация навигации в стиле профессиональных торговых терминалов (Command Palette / Combobox UX): фокус остаётся в строке ввода, стрелки `ArrowDown`/`ArrowUp` перемещают активный выбор, `Enter` выбирает подсвеченный тикер.
- Локальный CSS-модуль (`instrument-search-dialog.module.css`) на семантических токенах `DESIGN.md`.
- Изолированное тестирование чёрного ящика в `src/modules/instruments/tests/instruments.test.tsx`, импортирующее исключительно публичный API модуля (`../index`).

### 1.2 Non-Goals & Out-of-Scope
- Потоковое обновление рыночных котировок, стакана или ленты сделок (зона ответственности `src/modules/market-data`).
- Управление состоянием окон терминала и персистенция активного инструмента в хранилище (зона ответственности `src/modules/workspace`).
- Регистрация в реестре окон `src/composition/widgets.ts` (диалог поиска является модальным сервисом интерфейса, а не отдельным типом окна терминала).
- Удаление легаси-файлов в `app/instruments/` и `app/components/instrument-search-dialog.tsx` (запланировано в Шаге 6 дорожной карты).

### 1.3 Architectural Invariants
- **Vertical Slice Encapsulation (ADR-0001)**: Все внешние потребители импортируют функциональность строго через публичный вход `@/src/modules/instruments`. Прямой импорт внутренних файлов (`@/src/modules/instruments/*`) строго запрещён правилами ESLint и Dependency Cruiser.
- **Unidirectional Foundation Rule**: Модуль может импортировать только типы, контракты и токены из `@/src/shared/*` (`@/src/shared/contracts`, `@/src/shared/theme`). Любые импорты из `app/**` или недопустимых слоёв запрещены.
- **CSS Modules & Design Tokens (ADR-0003)**: Стилизация компонента изолирована в `instrument-search-dialog.module.css` с использованием семантических CSS-переменных из `tokens.css` (`--surface`, `--surface-raised`, `--border`, `--brand-gold`, `--text-primary`, `--text-secondary`). Глобальные rogue-классы запрещены.
- **Single Public Seam & Black-Box Tests**: Тесты в `src/modules/instruments/tests/` тестируют поведение системы через публичный вход `../index` без обращения к внутренним файлам (`model/`, `ui/`, `schema.ts`, `constants.ts`).

---

## 2. Public Contract Perimeter

### 2.1 Types (`src/modules/instruments/types.ts`)
```typescript
import type { Instrument, WindowKind } from "@/src/shared/contracts";

export type { Instrument, WindowKind };

export interface InstrumentCatalogProvider {
  search(query: string): Promise<Instrument[]>;
}

export interface InstrumentSearchDialogProps {
  readonly kind?: WindowKind;
  readonly title?: string;
  readonly catalog: InstrumentCatalogProvider;
  readonly onSelect: (instrument: Instrument) => void;
  readonly onCancel: () => void;
}
```

### 2.2 Validation Schema (`src/modules/instruments/schema.ts`)
```typescript
import { z } from "zod";

import { instrumentSchema } from "@/src/shared/contracts";

export { instrumentSchema };

export const instrumentCatalogSchema = z.array(instrumentSchema);
```

### 2.3 Constants (`src/modules/instruments/constants.ts`)
```typescript
import type { WindowKind } from "@/src/shared/contracts";

import type { Instrument } from "./types";

export const DEFAULT_INSTRUMENTS: readonly Instrument[] = [
  { symbol: "ES", name: "E-mini S&P 500" },
  { symbol: "NQ", name: "E-mini Nasdaq-100" },
  { symbol: "YM", name: "E-mini Dow Jones" },
  { symbol: "RTY", name: "E-mini Russell 2000" },
  { symbol: "CL", name: "Crude Oil" },
  { symbol: "GC", name: "Gold" },
  { symbol: "6E", name: "Euro FX" },
  { symbol: "ZB", name: "U.S. Treasury Bond" },
  { symbol: "MES", name: "Micro E-mini S&P 500" },
  { symbol: "MNQ", name: "Micro E-mini Nasdaq-100" },
] as const;

export const DEFAULT_WINDOW_KIND_LABELS: Readonly<Record<WindowKind, string>> = {
  chart: "Chart",
  orderBook: "Level II",
  timeAndSales: "T & S",
} as const;
```

### 2.4 Re-exports (`src/modules/instruments/index.ts`)
```typescript
export type {
  Instrument,
  InstrumentCatalogProvider,
  InstrumentSearchDialogProps,
  WindowKind,
} from "./types";

export { instrumentSchema, instrumentCatalogSchema } from "./schema";
export { DEFAULT_INSTRUMENTS, DEFAULT_WINDOW_KIND_LABELS } from "./constants";
export { demoInstrumentCatalog } from "./model/demo-instrument-catalog";
export { InstrumentSearchDialog } from "./ui/instrument-search-dialog";
```

---

## 3. Core Logic & State Management

### 3.1 Demo Catalog Model (`src/modules/instruments/model/demo-instrument-catalog.ts`)
- Реализует интерфейс `InstrumentCatalogProvider`.
- Метод `search(query: string): Promise<Instrument[]>`:
  - Нормализует входящую строку: `const normalized = query.trim().toLowerCase()`.
  - При пустой строке возвращает полную защитную копию списка `DEFAULT_INSTRUMENTS`.
  - При наличии непустого запроса фильтрует инструменты, у которых `symbol` или `name` содержат `normalized` (без учёта регистра).
  - Возвращает иммутабельные копии объектов: `.map((item) => ({ ...item }))`.

### 3.2 Dialog Search & Race Condition Management
- Состояние поиска внутри компонента `InstrumentSearchDialog`:
  - `query`: текущее значение поля ввода (`string`, по умолчанию `""`).
  - `deferredQuery`: отложенное значение поискового запроса через `useDeferredValue(query)` для неблокирующего ввода с высоким FPS.
  - `selectedIndex`: индекс выбранного стрелками клавиатуры элемента (`number`, по умолчанию `0` при наличии результатов, иначе `-1`).
  - `attempt`: счётчик повторных попыток для триггера перезагрузки при ошибке (`number`, по умолчанию `0`).
  - `search`: дискриминированное объединение:
    `{ status: "loading" } | { status: "ready"; results: Instrument[] } | { status: "error" }`.
- Предотвращение состояния гонки (Race Condition):
  - Асинхронный эффект загрузки каталога использует флаг активности текущего запроса (`let current = true; ... return () => { current = false; };`).
  - Если медленный предыдущий запрос завершается позже быстрого последующего запроса, его результат отбрасывается, предотвращая отображение устаревших данных.

---

## 4. UI Presentation & Styling

### 4.1 Component Decomposition & Modern Web Standards
- `src/modules/instruments/ui/instrument-search-dialog.tsx`:
  - **Нативный контейнер**: `<dialog ref={dialogRef} closedby="any" aria-labelledby={titleId} onCancel={onCancel} onClick={handleBackdropClick}>`.
  - **Нативный Light-Dismiss**: атрибут `closedby="any"` для современных браузеров и клик по бэкдропу через `dialog.getBoundingClientRect()` для браузеров без поддержки `closedby`.
  - **Заголовок**: вычисляется как `title ?? (kind ? `${DEFAULT_WINDOW_KIND_LABELS[kind]} — Select instrument` : "Select instrument")`.
  - **Кнопка закрытия**: `<button type="button" onClick={onCancel} aria-label="Close">Close</button>` в шапке окна.
  - **Семантический поиск**: контейнер `<search>` с полем `<input ref={inputRef} type="search" role="combobox" aria-autocomplete="list" aria-controls={listboxId} aria-activedescendant={activeId} aria-expanded={isExpanded} aria-label="Search instruments" placeholder="Search instruments" />`.
  - **Область результатов**:
    - При `loading`: элемент с `role="status"`, текстом `Loading...` и спиннером с классом `.spinner`.
    - При `error`: сообщение об ошибке с `role="alert"` и кнопка `Retry`.
    - При `ready` и пустом списке: сообщение с `role="status"` ("No results").
    - При `ready` с найденными элементами: контейнер `<ul id={listboxId} role="listbox">` со списком инструментов `<li role="option" aria-selected={isSelected}>`, содержащими кнопку выбора с `<strong className={styles.symbol}>{item.symbol}</strong>` и `<span className={styles.name}>{item.name}</span>`.

### 4.2 Terminal Focus & Keyboard Navigation (Combobox UX)
- Фокус постоянно удерживается в поле ввода поиска при открытии диалога.
- При нажатии `ArrowDown` индекс `selectedIndex` увеличивается на 1 (с ограничением до последнего элемента).
- При нажатии `ArrowUp` индекс `selectedIndex` уменьшается на 1 (с ограничением до 0).
- При нажатии `Enter`: если выбран валидный элемент (`selectedIndex >= 0 && selectedIndex < results.length`), немедленно вызывается `onSelect(results[selectedIndex])` с предотвращением отправки формы.
- Нажатие `Escape` перехватывается браузером через нативное событие `onCancel`, вызывая `onCancel()`.
- Клик мышью по элементу списка также вызывает `onSelect(item)`.

### 4.3 Visual Tokens & Themes (`DESIGN.md`)
- Файл стилей: `src/modules/instruments/ui/instrument-search-dialog.module.css`.
- Семантические токены:
  - Фон диалога: `background: var(--surface);` с границей `border: 1px solid var(--border);` и скруглением `border-radius: 6px;`.
  - Бэкдроп: `::backdrop { background: rgb(0 0 0 / 45%); }`.
  - Поле ввода и кнопки результатов: `background: var(--surface-raised); border: 1px solid var(--border); color: var(--text-primary);`.
  - Активный/подсвеченный элемент списка (`.active` / `[aria-selected="true"]`): акцентная рамка или индикатор с `var(--brand-gold)` и контрастный фон `var(--surface-raised)`.
  - Фокус элементов: `:focus-visible { outline: 2px solid var(--brand-gold); outline-offset: -2px; }`.
  - Шрифты: общие надписи — `var(--font-ui)`, тикеры инструментов — `var(--font-mono)`.
  - Анимация спиннера: уважает медиа-запрос `@media (prefers-reduced-motion: reduce) { animation: none; }`.

---

## 5. Black-Box Behavioral Test Scenarios

> [!NOTE]
> Тесты располагаются в `src/modules/instruments/tests/instruments.test.tsx` и импортируют сущности строго из `../index`.
> Запрещены тавтологические проверки чистых типов TypeScript. Тестируются валидация схем, логика поиска каталога, реактивность диалога, клавиатурная навигация терминала и доступность UI.

### Scenario 1: Demo Catalog — Empty Query Returns Full Catalog
- **Given:** Сервис `demoInstrumentCatalog`.
- **When:** Вызывается `demoInstrumentCatalog.search("")`.
- **Then:** Возвращается массив из 10 стандартных инструментов (`DEFAULT_INSTRUMENTS`), тикеры содержат `"ES"`, `"NQ"`, `"CL"`, `"GC"`, `"6E"`, `"ZB"` и др.

### Scenario 2: Demo Catalog — Case-Insensitive Substring Match
- **Given:** Сервис `demoInstrumentCatalog`.
- **When:** Выполняется поиск по запросам `"es"`, `"GOLD"`, `"nasdaq"`.
- **Then:** Запрос `"es"` возвращает `ES` и `MES`; `"GOLD"` возвращает `GC`; `"nasdaq"` возвращает `NQ` и `MNQ`.

### Scenario 3: Demo Catalog — Non-Matching Query
- **Given:** Сервис `demoInstrumentCatalog`.
- **When:** Выполняется поиск по неизвестному тикеру `"UNKNOWN_TICKER_XYZ"`.
- **Then:** Возвращается пустой массив `[]`.

### Scenario 4: Instrument Schema Validation
- **Given:** Схема `instrumentSchema` и `instrumentCatalogSchema`.
- **When:** Валидируется валидный объект `{ symbol: "BTC", name: "Bitcoin" }` и невалидные объекты (`{ symbol: "", name: "Test" }`, `{ symbol: "ES" }`).
- **Then:** Валидный объект успешно парсится, невалидные вызывают ошибку `ZodError` с сообщением о недопустимости пустых строк.

### Scenario 5: Dialog Initial Render & Focus
- **Given:** Компонент `InstrumentSearchDialog` смонтирован с `kind="chart"`.
- **When:** Окно открывается.
- **Then:** Находится элемент dialog с доступным именем `"Chart — Select instrument"`, поле поиска внутри `<search>` активно и находится в фокусе, а колбэки `onSelect` и `onCancel` не вызывались.

### Scenario 6: Dialog Custom Title Override
- **Given:** Компонент `InstrumentSearchDialog` смонтирован с кастомным `title="Custom Instrument Selector"`.
- **When:** Окно открывается.
- **Then:** Заголовок окна отображает `"Custom Instrument Selector"`.

### Scenario 7: Dialog Loading State During Catalog Search
- **Given:** Каталог возвращает отложенный `Promise`.
- **When:** Пользователь вводит текст в поле поиска.
- **Then:** Отображается элемент `role="status"` со спиннером и текстом `"Loading..."`, поле ввода остаётся активным и доступным для изменения.

### Scenario 8: Dialog Result Selection by Click
- **Given:** Каталог вернул инструмент `{ symbol: "ES", name: "E-mini S&P 500" }`.
- **When:** Пользователь кликает по кнопке инструмента в списке результатов.
- **Then:** Вызывается колбэк `onSelect` с объектом инструмента, а `onCancel` не вызывается.

### Scenario 9: Terminal Keyboard Navigation (Arrow Down / Up + Enter)
- **Given:** Результаты поиска содержат несколько инструментов (`ES`, `MES`). Поле ввода находится в фокусе.
- **When:** Пользователь нажимает клавишу `ArrowDown`, затем клавишу `Enter`.
- **Then:** Активным становится второй инструмент (`MES`), и по нажатию `Enter` вызывается `onSelect` с объектом `MES`. Поле ввода не теряет фокус.

### Scenario 10: Dialog Empty Results Feedback
- **Given:** Поиск не дал результатов.
- **When:** Каталог возвращает пустой массив.
- **Then:** Отображается сообщение `role="status"` с текстом `"No results"`, поле ввода сохраняет введённый запрос.

### Scenario 11: Dialog Error & Retry Recovery
- **Given:** Каталог завершает запрос с ошибкой `new Error("Network failure")`.
- **When:** Происходит ошибка поиска.
- **Then:** Отображается сообщение `role="alert"` с текстом об ошибке и кнопка `"Retry"`. При клике на `"Retry"` поиск перезапускается с тем же запросом и при успехе отображает результаты.

### Scenario 12: Dialog Discards Out-of-Order Stale Responses
- **Given:** Пользователь последовательно ищет `"ES"`, затем `"NQ"`.
- **When:** Запрос для `"ES"` завершается позже запроса для `"NQ"`.
- **Then:** В списке отображаются результаты для `"NQ"`, а запоздалый результат для `"ES"` игнорируется.

### Scenario 13: Dialog Cancellation via Close Button or Escape
- **Given:** Открытый диалог поиска.
- **When:** Пользователь нажимает клавишу `Escape` или кликает по кнопке `"Close"`.
- **Then:** Вызывается колбэк `onCancel`, а `onSelect` не вызывается.

### Scenario 14: Dialog Light-Dismiss via Backdrop Click
- **Given:** Открытый модальный диалог поиска.
- **When:** Пользователь кликает по подложке (бэкдропу) за пределами прямоугольника диалога.
- **Then:** Вызывается колбэк `onCancel()`.

---

## 6. Wiring & Integration

### 6.1 Composition Point
- **Target File**: `none` (компонент `InstrumentSearchDialog` и `demoInstrumentCatalog` не регистрируются в `src/composition/widgets.ts`, так как являются автономным доменным модулем и модальным окном, потребляемым виджетами и шеллом).

### 6.2 E2E Integration Test Requirement
- **Playwright E2E required**: `false`.
- **Rationale**: Модуль полностью покрывается модульными и компонентными тестами чёрного ящика в `src/modules/instruments/tests/instruments.test.tsx` (включая симуляцию событий `<dialog>`, фокуса, клавиатурных стрелок и асинхронных состояний). Существующие сквозные E2E тесты в `tests/e2e/terminal-window-content.spec.ts` будут проверять работу диалога в составе терминала на Шаге 5.