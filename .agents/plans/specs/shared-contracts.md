---
name: shared-contracts
type: shared
status: draft
target_path: src/shared/contracts
composition_point: none
e2e_required: false
---

# Спецификация: shared-contracts

## 1. Назначение и границы (Purpose & Scope)

### 1.1 В зоне ответственности (In-Scope)
- Формирование фундаментального доменно-нейтрального слоя в `src/shared/contracts/` и `src/shared/lib/`, как определено в Шаге 1 плана [modular-architecture_plan.md](../modular-architecture_plan.md).
- Определение базовых интерфейсов плагинов расширения: `WidgetDefinition` и `WidgetProps` для регистрации виджетов в многооконном пространстве `workspace`.
- Определение базовых моделей финансовых инструментов: интерфейс `Instrument`, рантайм-схема `instrumentSchema` (Zod 4) и `windowKindSchema`.
- Определение таксономии окон: `WindowKind`, `WINDOW_KINDS` и `WINDOW_KIND_LABELS`.
- Создание утилиты объединения динамических CSS-классов `cn` на базе `clsx` в `src/shared/lib/cn.ts` согласно [ADR-0003](../../../docs/adr/0003-css-architecture.md).
- Предоставление тестов чёрного ящика в `src/shared/contracts/tests/` и `src/shared/lib/tests/`.

### 1.2 Вне зоны ответственности (Non-Goals & Out-of-Scope)
- Контракты расчета индикаторов (`IndicatorDefinition`) и потоковых данных (`MarketDataProvider`) — отложены до Шага 3 (`market-data` и `indicators`).
- Геометрия менеджера окон и схема сохранения состояния — отложены до Шага 5 (`workspace`).
- Токены тем (`tokens.css`), хук `useTheme` и переключатель `ThemeToggle` — выделены в отдельную задачу слоя темы в Шаге 1.
- Устойчивые обёртки хранилища (`safeStorage`) и баннер восстановления — выделены в отдельную задачу хранилища в Шаге 1.
- Конкретные UI-реализации виджетов (Chart, OrderBook, TimeAndSales).

### 1.3 Архитектурные инварианты (Architectural Invariants)
- **Правила слоёв и границ ([ADR-0001](../../../docs/adr/0001-modular-architecture.md), [ADR-0002](../../../docs/adr/0002-boundary-enforcement-and-quarantine.md))**:
  - Слой `src/shared/*` строго однонаправлен: НОЛЬ импортов из `src/modules/*`, `src/composition/*` или `app/*`.
  - Потребители импортируют строго через публичные точки входа `@/src/shared/contracts` и `@/src/shared/lib` (глубокие импорты запрещены).
  - Код в `src/**` никогда не импортирует из `app/**`.
- **Изоляция чистых типов (Pure Types Isolation)**:
  - `types.ts` содержит только чистые TypeScript-типы и интерфейсы. Рантайм-переменные, схемы и функции в `types.ts` запрещены.
- **Архитектура стилей ([ADR-0003](../../../docs/adr/0003-css-architecture.md))**:
  - Динамическое объединение классов компонентов должно использовать `cn()` из `@/src/shared/lib` вместо строковой интерполяции.

---

## 2. Контрактный периметр (Public Contract Perimeter)

### 2.1 Типы (`src/shared/contracts/types.ts`)
```typescript
import type { ComponentType } from "react";

export type WindowKind = "chart" | "orderBook" | "timeAndSales";

export interface Instrument {
  readonly symbol: string;
  readonly name: string;
}

export interface WidgetProps {
  readonly windowId: string;
  readonly instrument: Instrument;
  readonly onChangeInstrument?: () => void;
  readonly isFocused?: boolean;
}

export interface WidgetDefinition {
  readonly kind: WindowKind;
  readonly title: string;
  readonly component: ComponentType<WidgetProps>;
}
```

### 2.2 Схема валидации (`src/shared/contracts/schema.ts`)
```typescript
import { z } from "zod";

export const windowKindSchema = z.enum(["chart", "orderBook", "timeAndSales"]);

export const instrumentSchema = z.object({
  symbol: z.string().trim().min(1, "Symbol is required"),
  name: z.string().trim().min(1, "Name is required"),
});

export type InstrumentSchemaInput = z.input<typeof instrumentSchema>;
export type InstrumentSchemaOutput = z.output<typeof instrumentSchema>;
```

### 2.3 Константы (`src/shared/contracts/constants.ts`)
```typescript
import type { WindowKind } from "./types";

export const WINDOW_KINDS: readonly WindowKind[] = [
  "chart",
  "orderBook",
  "timeAndSales",
] as const;

export const WINDOW_KIND_LABELS: Readonly<Record<WindowKind, string>> = {
  chart: "Chart",
  orderBook: "Level II",
  timeAndSales: "T & S",
} as const;
```

### 2.4 Публичные реэкспорты (`src/shared/contracts/index.ts`)
```typescript
export type { Instrument, WidgetDefinition, WidgetProps, WindowKind } from "./types";
export {
  instrumentSchema,
  windowKindSchema,
  type InstrumentSchemaInput,
  type InstrumentSchemaOutput,
} from "./schema";
export { WINDOW_KINDS, WINDOW_KIND_LABELS } from "./constants";
```

### 2.5 Утилита объединения классов (`src/shared/lib/cn.ts` и `src/shared/lib/index.ts`)
```typescript
// src/shared/lib/cn.ts
import { clsx, type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}

export type { ClassValue };

// src/shared/lib/index.ts
export { cn, type ClassValue } from "./cn";
```

---

## 3. Базовая логика и управление состоянием (Core Logic & State Management)

### 3.1 Состояние и операции (State Shape & Actions)
- Бессерверные фундаментальные контракты и чистая утилитная функция без собственного стейта.
- `cn(...inputs)` оборачивает `clsx`, предотвращая утечку ложных строковых литералов (например, `"false"` или `"undefined"`) в DOM-атрибуты.
- `instrumentSchema` и `windowKindSchema` обеспечивают рантайм-валидацию входных данных на Zod 4.

### 3.2 Сайд-эффекты и жизненные циклы (Side Effects & Lifecycles)
- Отсутствуют. Все контракты и утилиты являются чистыми, детерминированными и не содержат подписок.

---

## 4. Пользовательский интерфейс и стили (UI Presentation & Styling)

`N/A: Non-visual target` (Доменно-нейтральные контракты, схемы валидации и утилитарная библиотека).

---

## 5. Сценарии тестирования чёрного ящика (Black-Box Behavioral Test Scenarios)

### Сценарий: Схема инструмента валидирует корректный финансовый инструмент
- **Given:** Валидный объект `{ symbol: "ES", name: "E-mini S&P 500" }`.
- **When:** Вызывается `instrumentSchema.safeParse(input)`.
- **Then:** Результат успешен (`success: true`) и возвращает нормализованные данные.

### Сценарий: Схема инструмента отклоняет невалидный или неполный объект
- **Given:** Невалидные входные данные: `{ symbol: "", name: "Valid" }`, `{ symbol: "ES", name: "" }`, `{ symbol: 123 }` или пустой объект `{}`.
- **When:** Вызывается `instrumentSchema.safeParse(input)`.
- **Then:** Валидация завершается ошибкой (`success: false`) с информативным сообщением Zod.

### Сценарий: Схема инструмента обрезает начальные и конечные пробелы
- **Given:** Входной объект с пробелами `{ symbol: "  NQ  ", name: "  E-mini Nasdaq-100  " }`.
- **When:** Вызывается `instrumentSchema.parse(input)`.
- **Then:** Возвращается объект с очищенными полями: `{ symbol: "NQ", name: "E-mini Nasdaq-100" }`.

### Сценарий: Схема типов окон валидирует канонические идентификаторы
- **Given:** Строки `"chart"`, `"orderBook"` и `"timeAndSales"`.
- **When:** Для каждой строки вызывается `windowKindSchema.safeParse(input)`.
- **Then:** Для всех трёх вызовов возвращается `success: true`.

### Сценарий: Схема типов окон отклоняет неизвестные идентификаторы
- **Given:** Недопустимый тип окна, например `"depthLadder"` или `"scanner"`.
- **When:** Вызывается `windowKindSchema.safeParse(input)`.
- **Then:** Валидация завершается ошибкой (`success: false`).

### Сценарий: Константы таксономии окон поддерживают исчерпывающее соответствие
- **Given:** `WINDOW_KINDS` и `WINDOW_KIND_LABELS`.
- **When:** Сравниваются ключи `WINDOW_KIND_LABELS` со списком `WINDOW_KINDS`.
- **Then:** Для каждого типа в `WINDOW_KINDS` существует точный заголовок в `WINDOW_KIND_LABELS`.

### Сценарий: Утилита классов объединяет простые строки
- **Given:** Строки классов `"foo"`, `"bar"` и `"baz"`.
- **When:** Вызывается `cn("foo", "bar", "baz")`.
- **Then:** Возвращается `"foo bar baz"`.

### Сценарий: Утилита классов фильтрует falsy и условные значения
- **Given:** Набор значений `["btn", false && "btn-active", null, undefined, 0, "", true && "btn-primary"]`.
- **When:** Вызывается `cn(...)`.
- **Then:** Возвращается `"btn btn-primary"` без утечки `"false"`, `"null"` или `"undefined"`.

### Сценарий: Утилита классов объединяет объекты и вложенные массивы
- **Given:** Объект `{ active: true, disabled: false }` и вложенный массив `["extra", ["nested"]]`.
- **When:** Вызывается `cn(...)`.
- **Then:** Возвращается `"active extra nested"`.

### Сценарий: Структурное соответствие контракту WidgetDefinition
- **Given:** Мок React-компонента, принимающий `WidgetProps`.
- **When:** Создается объект `WidgetDefinition` с полями `kind: "chart"`, `title: "Chart"` и компонентом.
- **Then:** Объект полностью удовлетворяет интерфейсу `WidgetDefinition` без ошибок компиляции TypeScript.

---

## 6. Интеграция и сборка (Wiring & Integration)

### 6.1 Точка подключения (Composition Point)
- **Целевой файл:** `none` (Базовые интерфейсы и утилиты импортируются напрямую модулями и реестрами).

### 6.2 Необходимость E2E-тестов (E2E Integration Test Requirement)
- **Playwright E2E:** `false` (Исключительно юнит-тесты и схемы валидации в Vitest).
