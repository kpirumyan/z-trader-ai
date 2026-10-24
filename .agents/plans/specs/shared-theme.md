---
name: shared-theme
type: shared
status: draft
target_path: src/shared/theme
composition_point: none
e2e_required: false
---

# Спецификация: shared-theme

## 1. Назначение и границы (Purpose & Scope)

### 1.1 В зоне ответственности (In-Scope)
- Централизация всех дизайн-токенов терминала из `DESIGN.md` в файле `src/shared/theme/tokens.css` с поддержкой тёмной (по умолчанию) и светлой тем.
- Предоставление хука `useTheme` для переключения темы терминала и синхронизации с `document.documentElement.dataset.theme` и `localStorage`.
- Предоставление доступного компонента кнопки `ThemeToggle` на изолированных CSS Modules (`theme-toggle.module.css`), исключающего мерцание при гидратации (SSR flicker) и лишние ререндеры дерева React.
- Валидация значений темы через схему Zod `themeSchema` (`z.enum(["dark", "light"])`).
- Экспорт констант темы (`DEFAULT_THEME`, `THEME_STORAGE_KEY`, `THEMES`) через публичный контракт `src/shared/theme/index.ts`.
- Размещение unit- и компонентных тестов в `src/shared/theme/tests/theme.test.tsx` с миграцией устаревшего `tests/unit/theme.test.tsx`.
- Подключение `src/shared/theme/tokens.css` в `app/globals.css` и удаление дублирующихся определений переменных цветовой палитры.

### 1.2 Вне зоны ответственности (Non-Goals & Out-of-Scope)
- Изменения оконного менеджера, рамок окон и геометрии раскладки (зона ответственности модуля `workspace`).
- Изменения финансовых виджетов (`chart`, `order-book`, `time-and-sales`).
- Общая абстракция хранилища (выделена в отдельный шаг `src/shared/storage`).

### 1.3 Архитектурные инварианты (Architectural Invariants)
- **Правила слоёв и границ ([ADR-0001](../../../docs/adr/0001-modular-architecture.md), [ADR-0002](../../../docs/adr/0002-boundary-enforcement-and-quarantine.md))**:
  - `src/shared/theme`: принадлежит слою `shared`. Импорты строго внутри `src/shared` (например, `src/shared/lib`). Любые импорты из `src/modules/*`, `src/composition/*` или `app/*` категорически запрещены.
  - Внешние потребители (`app/*` или будущие модули) импортируют функциональность строго через публичный шов `@/src/shared/theme` (глубокие импорты запрещены).
- **Дизайн-токены и изоляция стилей ([ADR-0003](../../../docs/adr/0003-css-architecture.md))**:
  - Файл `tokens.css` является единственным источником истины для всех CSS-переменных палитры и типографики, определённых в `DESIGN.md`.
  - Стили компонентов используют лаконичные семантические классы (`.root`, `.lightOnly`, `.darkOnly`, `.srOnly`) без избыточных BEM-префиксов.
- **Предотвращение мерцания гидратации (Zero Hydration Flicker)**:
  - Иконки для обеих тем рендерятся в HTML одновременно; переключение видимости выполняется декларативно на уровне CSS через селектор `:global(:root[data-theme="light"])`, исключая несовпадение серверного и клиентского рендера и лишние ререндеры React.

---

## 2. Контрактный периметр (Public Contract Perimeter)

### 2.1 Типы (`src/shared/theme/types.ts`)
```typescript
export type Theme = "light" | "dark";

export interface UseThemeResult {
  toggleTheme: () => void;
}
```

### 2.2 Схема валидации (`src/shared/theme/schema.ts`)
```typescript
import { z } from "zod";

export const themeSchema = z.enum(["dark", "light"]);
```

### 2.3 Константы (`src/shared/theme/constants.ts`)
```typescript
import type { Theme } from "./types";

export const DEFAULT_THEME: Theme = "dark";
export const THEME_STORAGE_KEY = "z-trader-theme";
export const THEMES = ["dark", "light"] as const;
```

### 2.4 Реэкспорты (`src/shared/theme/index.ts`)
```typescript
export type { Theme, UseThemeResult } from "./types";
export { themeSchema } from "./schema";
export { DEFAULT_THEME, THEME_STORAGE_KEY, THEMES } from "./constants";
export { useTheme } from "./use-theme";
export { ThemeToggle } from "./theme-toggle";
```

---

## 3. Базовая логика и управление состоянием (Core Logic & State Management)

### 3.1 Состояние и экшены (`src/shared/theme/use-theme.ts`)
```typescript
"use client";

import { THEME_STORAGE_KEY } from "./constants";
import type { Theme, UseThemeResult } from "./types";

function switchTheme(): void {
  const root = document.documentElement;
  const currentTheme = root.dataset.theme;
  const nextTheme: Theme = currentTheme === "dark" ? "light" : "dark";

  root.dataset.theme = nextTheme;

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  } catch {
    // Current session continues without persisting
  }
}

export function useTheme(): UseThemeResult {
  return { toggleTheme: switchTheme };
}
```

### 3.2 Побочные эффекты и жизненный цикл
- Вызов `switchTheme` синхронно изменяет атрибут `dataset.theme` у `document.documentElement`.
- Выбранная тема сохраняется в `localStorage` по ключу `THEME_STORAGE_KEY`.
- Ошибки доступа к `localStorage` (превышение квоты или режим инкогнито/SecurityError) перехватываются без проброса наружу, сохраняя работоспособность темы в текущей сессии в DOM.

---

## 4. UI-представление и стилизация (UI Presentation & Styling)

### 4.1 Декомпозиция компонентов
- **`ThemeToggle` (`src/shared/theme/theme-toggle.tsx`)**:
  - Семантическая кнопка `<button type="button">`.
  - Содержит два вложенных контейнера: `.lightOnly` (иконка луны + текст `"Switch to dark theme"` для скринридеров) и `.darkOnly` (иконка солнца + текст `"Switch to light theme"` для скринридеров).
  - Обе SVG-иконки снабжены атрибутом `aria-hidden="true"`.
  - Никаких всплывающих подсказок (`title` отсутствует) в соответствии с правилами доступности терминала.

### 4.2 Визуальные токены и темы (`DESIGN.md` / `src/shared/theme/tokens.css`)
```css
:root {
  color-scheme: dark;
  --canvas: #0e0e0e;
  --surface: #1a1a1a;
  --surface-raised: #242424;
  --text-primary: #ffffff;
  --text-secondary: #bdbdbd;
  --border: #393939;
  --grid: #2b2b2b;
  --brand-gold: #ffb700;
  --on-gold: #0e0e0e;
  --market-buy: #61d6ab;
  --market-sell: #ff8797;
  --font-ui: var(--font-geist-sans), "Geist", Arial, sans-serif;
  --font-mono: var(--font-jetbrains-mono), "JetBrains Mono", monospace;
}

:root[data-theme="light"] {
  color-scheme: light;
  --canvas: #ffffff;
  --surface: #f7f7f7;
  --surface-raised: #efefef;
  --text-primary: #0e0e0e;
  --text-secondary: #555555;
  --border: #d8d8d8;
  --grid: #e9e9e9;
  --brand-gold: #f5a600;
  --on-gold: #0e0e0e;
  --market-buy: #146c51;
  --market-sell: #b33142;
}
```

### 4.3 Стилизация компонента (`src/shared/theme/theme-toggle.module.css`)
```css
.root {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-left: auto;
  width: 28px;
  height: 26px;
  flex: 0 0 28px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 3px;
  background: transparent;
  line-height: 24px;
  cursor: pointer;
}

.root:hover {
  background: var(--surface-raised);
  border-color: var(--border);
}

.root:focus-visible {
  outline: 2px solid var(--brand-gold);
  outline-offset: 1px;
}

.root svg {
  display: block;
}

.srOnly {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

.lightOnly {
  display: none;
}

:global(:root[data-theme="light"]) .lightOnly {
  display: block;
}

:global(:root[data-theme="light"]) .darkOnly {
  display: none;
}
```

---

## 5. Сценарии тестирования чёрного ящика (Black-Box Behavioral Test Scenarios)

> [!NOTE]
> Тесты импортируют функциональность исключительно через публичный шов (`@/src/shared/theme` или `../index`).

### Сценарий 1: Переключение и сохранение темы хуком `useTheme`
- **Given:** Клиентская сессия, в которой `document.documentElement.dataset.theme` равен `"dark"`.
- **When:** Вызывается метод `toggleTheme()`.
- **Then:** `document.documentElement.dataset.theme` переключается на `"light"`, и значение в `localStorage.getItem("z-trader-theme")` равно `"light"`.
- **When:** Метод `toggleTheme()` вызывается повторно.
- **Then:** `document.documentElement.dataset.theme` возвращается в `"dark"`, и `localStorage.getItem("z-trader-theme")` содержит `"dark"`.

### Сценарий 2: Откат к тёмной теме при повреждённом или отсутствующем значении dataset
- **Given:** Значение `document.documentElement.dataset.theme` отсутствует или содержит непредусмотренную строку (например, `"corrupted"`).
- **When:** Вызывается метод `toggleTheme()`.
- **Then:** Тема сбрасывается в дефолтную `"dark"` (`document.documentElement.dataset.theme === "dark"`), и в `localStorage.getItem("z-trader-theme")` записывается `"dark"`.

### Сценарий 3: Устойчивость `useTheme` к ошибкам и недоступности `localStorage`
- **Given:** Вызов `localStorage.setItem` выбрасывает исключение `DOMException("QuotaExceededError")`, либо геттер `window.localStorage` выбрасывает `DOMException("SecurityError")`.
- **When:** Вызывается метод `toggleTheme()`.
- **Then:** Метод отрабатывает без выбрасывания исключений наружу, а атрибут `document.documentElement.dataset.theme` в DOM успешно переключается.

### Сценарий 4: Рантайм-валидация схемы `themeSchema`
- **Given:** Валидные строковые литералы `"dark"` и `"light"`.
- **When:** Выполняется `themeSchema.safeParse`.
- **Then:** Для обоих значений валидация успешна (`success: true`), а данные соответствуют входным.
- **Given:** Невалидные входные данные (например, `""`, `"blue"`, `123`, `null`).
- **When:** Выполняется `themeSchema.safeParse`.
- **Then:** Валидация отклоняется с ошибкой (`success: false`).

### Сценарий 5: Доступность структуры `ThemeToggle` и сохранение фокуса
- **Given:** Компонент `ThemeToggle` отрендерен в DOM.
- **When:** Проверяются атрибуты и вложенная структура кнопки.
- **Then:** Рендерится кнопка `<button type="button">` без атрибута `title`, содержащая доступные скрытые подписи `"Switch to dark theme"` и `"Switch to light theme"`, а также SVG с `aria-hidden="true"`.
- **When:** На кнопке устанавливается фокус и совершаются последовательные клики.
- **Then:** Фокус документа сохраняется на кнопке (`document.activeElement === button`), а атрибут темы `document.documentElement.dataset.theme` переключается.

### Сценарий 6: Отсутствие мерцания гидратации (zero-hydration-flicker) через CSS Modules
- **Given:** Компонент `ThemeToggle` отрендерен в DOM.
- **When:** Проверяется структура DOM для светлой и тёмной тем.
- **Then:** Оба контейнера иконок присутствуют в DOM одновременно со скоуп-классами модуля (`lightOnly` / `darkOnly`), гарантируя независимость от момента завершения клиентской гидратации React.

---

## 6. Интеграция и сборка (Wiring & Integration)

### 6.1 Точка подключения (Composition Point)
- **Целевой файл:** `none` (Базовые токены и утилита темы импортируются напрямую в `app/globals.css` и компоненты оболочки терминала).

### 6.2 Необходимость E2E-тестов (E2E Integration Test Requirement)
- **Playwright E2E:** `false` (Базовые инварианты изолированно и полно покрываются юнит-тестами в `src/shared/theme/tests/theme.test.tsx`; существующие e2e-тесты `tests/e2e/terminal-shell.spec.ts` валидируют итоговую сборку).
