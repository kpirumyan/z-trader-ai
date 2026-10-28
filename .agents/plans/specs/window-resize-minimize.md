---
name: window-resize-minimize
type: module
status: draft
target_path: src/modules/workspace
composition_point: none
e2e_required: true
---

# Спецификация: window-resize-minimize

## 1. Назначение и границы (Purpose & Scope)

### 1.1 Область ответственности (In-Scope)
- Реализация интерактивного изменения размеров окон (`resizing`) с помощью углового манипулятора (Bottom-Right / SE-ресайз).
- Реализация функциональности минимизации окон (`minimization`) с докованием свернутых окон в нижнюю статусную панель (`StatusBar`).
- Расширение модели данных и хранилища `WorkspaceStore`:
  - Добавление опционального флага `isMinimized?: boolean` в структуру окна `WorkspaceWindow`.
  - Валидация `isMinimized` в `workspaceWindowSchema` (Zod).
  - Реализация экшенов `minimizeWindow(id: string)`, `restoreWindow(id: string)` и `toggleMinimizeWindow(id: string)`.
  - Передача и вызов экшена `resizeWindow(id: string, size: WindowSize)` из компонента окна.
- Интерактивные элементы в UI:
  - Добавление кнопки «Minimize window» в заголовок `TerminalWindow` рядом с кнопками «Change instrument» и «Close window».
  - Размещение углового манипулятора изменения размера (`.resizeHandle`) в правом нижнем углу окна с поддержкой захвата указателя (`setPointerCapture`), расчетом дельты координат и ограничением минимальных размеров (`MIN_WINDOW_WIDTH = 260px`, `MIN_WINDOW_HEIGHT = 180px`).
  - Отображение свернутых окон в виде компактных интерактивных чипов в центральной секции панели `StatusBar` с возможностью восстановления окна в 1 клик и автоматической активацией/фокусировкой.
  - Скрытие содержимого и рамки свернутого окна на холсте `WorkspaceCanvas` (`display: none` или исключение из рендера холста при сохранении параметров в сторе).

### 1.2 Вне рамок (Non-Goals)
- 8-сторонний ресайзинг (N, S, E, W, NW, NE, SW) — выбран угловой SE-ресайзинг для надежности и сохранения геометрии левого верхнего угла.
- Сворачивание окон в плавающие заголовки на холсте (Window Shade mode).
- Изменение версии схемы хранилища (`CURRENT_WORKSPACE_VERSION` остается `1`).
- Изменение математики индикаторов, графиков или рыночных данных.

### 1.3 Архитектурные инварианты (Architectural Invariants)
- **Модульная изоляция ([ADR-0001](../../../docs/adr/0001-modular-architecture.md))**: Все новые публичные интерфейсы и экшены экспортируются строго через публичный шов `src/modules/workspace/index.ts`. Внутренние файлы изолированы.
- **Дизайн-система и токены ([ADR-0003](../../../docs/adr/0003-css-architecture.md), [DESIGN.md](../../../DESIGN.md))**:
  - Высота хедера `TerminalWindow` — 28px, высота `StatusBar` — 24px.
  - Токены: `var(--surface)`, `var(--surface-raised)`, `var(--border)`, `var(--text-primary)`, `var(--text-secondary)`, `var(--brand-gold)`.
  - Интерактивные чипы свернутых окон в статус-баре оформляются в нейтральном стиле с акцентом тикера (`var(--brand-gold)`) и видимым фокус-рингом `:focus-visible`.
  - Манипулятор ресайза использует курсор `se-resize` и ненавязчивый визуальный акцент без тяжелых теней.
- **Интеграция статус-бара ([ADR-0004](../../../docs/adr/0004-resilient-storage-and-terminal-status-bar.md))**: Док свернутых окон размещается в центральной части `StatusBar`, сохраняя телеметрию подключения (слева) и UTC-часы (справа) без изменения общей высоты панели (24px).
- **Анти-Тавтология в тестах**: Тесты проверяют мутации состояния, вызовы экшенов, pointer-события и корректность рендера состояний без тестирования статических типов TypeScript.

---

## 2. Публичный контракт (Public Contract Perimeter)

### 2.1 Типы (`src/modules/workspace/types.ts`)

```typescript
import type { Instrument, WidgetDefinition, WindowKind } from "@/src/shared/contracts";
import type { ReactNode, Ref } from "react";

export interface WindowPosition {
  readonly x: number;
  readonly y: number;
}

export interface WindowSize {
  readonly width: number;
  readonly height: number;
}

export interface WorkspaceWindow {
  readonly id: string;
  readonly kind: WindowKind;
  readonly instrument: Instrument;
  readonly position: WindowPosition;
  readonly size?: WindowSize;
  readonly zIndex: number;
  readonly isMinimized?: boolean;
}

export interface WorkspaceRecord {
  readonly id: string;
  readonly title?: string;
  readonly windows: readonly WorkspaceWindow[];
}

export interface WorkspaceStorageEnvelope {
  readonly version: 1;
  readonly activeWorkspaceId: string;
  readonly workspaces: readonly WorkspaceRecord[];
}

export interface WorkspaceStoreState {
  readonly windows: readonly WorkspaceWindow[];
  readonly activeWindowId: string | null;
  readonly isInitialized: boolean;
}

export interface WorkspaceStoreActions {
  readonly addWindow: (kind: WindowKind, instrument: Instrument) => string;
  readonly closeWindow: (id: string) => void;
  readonly focusWindow: (id: string) => void;
  readonly blurWindow?: () => void;
  readonly moveWindow: (id: string, position: WindowPosition) => void;
  readonly resizeWindow: (id: string, size: WindowSize) => void;
  readonly minimizeWindow: (id: string) => void;
  readonly restoreWindow: (id: string) => void;
  readonly toggleMinimizeWindow: (id: string) => void;
  readonly changeInstrument: (id: string, instrument: Instrument) => void;
  readonly resetWorkspace: () => void;
  readonly loadWorkspace: () => void;
  readonly saveWorkspace: () => void;
}

export type WorkspaceStore = WorkspaceStoreState & WorkspaceStoreActions;

export interface TerminalShellProps {
  readonly widgets?: readonly WidgetDefinition[];
  readonly initialInstrument?: Instrument;
  readonly className?: string;
}

export interface TerminalWindowProps {
  readonly window: WorkspaceWindow;
  readonly widgetDefinition?: WidgetDefinition;
  readonly isFocused: boolean;
  readonly onClose: (id: string) => void;
  readonly onFocus: (id: string) => void;
  readonly onMove: (id: string, position: WindowPosition) => void;
  readonly onResize: (id: string, size: WindowSize) => void;
  readonly onMinimize: (id: string) => void;
  readonly onChangeInstrument: (id: string) => void;
}

export interface TopBarProps {
  readonly isNewOpen: boolean;
  readonly newButtonRef: Ref<HTMLButtonElement>;
  readonly onToggleNew: () => void;
  readonly onClearFocus?: () => void;
  readonly children?: ReactNode;
}

export interface NewMenuPopoverProps {
  readonly widgets: readonly WidgetDefinition[];
  readonly onClose: () => void;
  readonly onSelect: (kind: WindowKind) => void;
}

export interface WorkspaceCanvasProps {
  readonly children?: ReactNode;
  readonly isEmpty?: boolean;
  readonly onClearFocus?: () => void;
}

export interface StatusBarProps {
  readonly status?: "connected" | "connecting" | "disconnected";
  readonly latencyMs?: number;
  readonly serverTime?: string;
  readonly minimizedWindows?: readonly WorkspaceWindow[];
  readonly onRestoreWindow?: (id: string) => void;
  readonly onClearFocus?: () => void;
  readonly children?: ReactNode;
}
```

### 2.2 Схема валидации (`src/modules/workspace/schema.ts`)

```typescript
import { z } from "zod";

export const windowPositionSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
});

export const windowSizeSchema = z.object({
  width: z.number().int().min(200),
  height: z.number().int().min(150),
});

export const workspaceInstrumentSchema = z.object({
  symbol: z.string().min(1),
  name: z.string().min(1),
});

export const workspaceWindowSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["chart", "orderBook", "timeAndSales"]),
  instrument: workspaceInstrumentSchema,
  position: windowPositionSchema,
  size: windowSizeSchema.optional(),
  zIndex: z.number().int().nonnegative(),
  isMinimized: z.boolean().optional(),
});

export const workspaceRecordSchema = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
  windows: z.array(workspaceWindowSchema),
});

export const workspaceStorageSchema = z.object({
  version: z.literal(1),
  activeWorkspaceId: z.string().min(1),
  workspaces: z.array(workspaceRecordSchema).min(1),
});
```

### 2.3 Константы (`src/modules/workspace/constants.ts`)

```typescript
import type { WindowKind } from "@/src/shared/contracts";

export const WORKSPACE_STORAGE_KEY = "z-trader.workspace" as const;
export const CURRENT_WORKSPACE_VERSION = 1 as const;
export const DEFAULT_WORKSPACE_ID = "default" as const;

export const WINDOW_CASCADE_OFFSET = 16 as const;
export const WINDOW_CASCADE_STEP = 32 as const;
export const WINDOW_CASCADE_MAX_SLOTS = 8 as const;

export const DEFAULT_WINDOW_WIDTH = 380 as const;
export const DEFAULT_WINDOW_HEIGHT = 440 as const;
export const MIN_WINDOW_WIDTH = 260 as const;
export const MIN_WINDOW_HEIGHT = 180 as const;

export const DEFAULT_WINDOW_KIND_LABELS: Readonly<Record<WindowKind, string>> = {
  chart: "Chart",
  orderBook: "Level II",
  timeAndSales: "T & S",
} as const;

export const EMPTY_WORKSPACE_TITLE = "Your workspace is empty" as const;
export const EMPTY_WORKSPACE_INSTRUCTION =
  "Use New to open a Chart, Level II, or T & S window." as const;
```

### 2.4 Публичный реэкспорт (`src/modules/workspace/index.ts`)

```typescript
export type {
  NewMenuPopoverProps,
  StatusBarProps,
  TerminalShellProps,
  TerminalWindowProps,
  TopBarProps,
  WindowPosition,
  WindowSize,
  WorkspaceCanvasProps,
  WorkspaceRecord,
  WorkspaceStorageEnvelope,
  WorkspaceStore,
  WorkspaceStoreActions,
  WorkspaceStoreState,
  WorkspaceWindow,
} from "./types";
export {
  CURRENT_WORKSPACE_VERSION,
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_KIND_LABELS,
  DEFAULT_WINDOW_WIDTH,
  DEFAULT_WORKSPACE_ID,
  EMPTY_WORKSPACE_INSTRUCTION,
  EMPTY_WORKSPACE_TITLE,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  WINDOW_CASCADE_MAX_SLOTS,
  WINDOW_CASCADE_OFFSET,
  WINDOW_CASCADE_STEP,
  WORKSPACE_STORAGE_KEY,
} from "./constants";
export {
  windowPositionSchema,
  windowSizeSchema,
  workspaceInstrumentSchema,
  workspaceRecordSchema,
  workspaceStorageSchema,
  workspaceWindowSchema,
} from "./schema";
export { useWorkspaceStore } from "./model/workspace-store";
export { TerminalShell } from "./ui/terminal-shell";
export { TerminalWindow } from "./ui/terminal-window";
export { TopBar } from "./ui/top-bar";
export { NewMenuPopover } from "./ui/new-menu-popover";
export { WorkspaceCanvas } from "./ui/workspace-canvas";
export { StatusBar } from "./ui/status-bar";
```

---

## 3. Логика и управление состоянием (Core Logic & State Management)

### 3.1 Модель состояния и действия хранилища
1. **`resizeWindow(id: string, size: WindowSize)`**:
   - Округляет и ограничивает `width` (не менее `MIN_WINDOW_WIDTH = 260`) и `height` (не менее `MIN_WINDOW_HEIGHT = 180`).
   - Обновляет свойство `size` целевого окна в массиве `windows`.
   - Синхронизирует обновленное состояние в `safeStorage`.
2. **`minimizeWindow(id: string)`**:
   - Устанавливает `isMinimized: true` для целевого окна.
   - Если минимизированное окно было активным (`activeWindowId === id`), переключает фокус на оставшееся видимое незакрытое окно с наивысшим `zIndex`, либо сбрасывает `activeWindowId` в `null`, если видимых окон нет.
   - Сохраняет состояние в `safeStorage`.
3. **`restoreWindow(id: string)`**:
   - Устанавливает `isMinimized: false` для целевого окна.
   - Автоматически вызывает повышение `zIndex` и делает данное окно активным (`activeWindowId: id`).
   - Сохраняет состояние в `safeStorage`.
4. **`toggleMinimizeWindow(id: string)`**:
   - Переключает флаг `isMinimized`: если окно свернуто — восстанавливает его, иначе минимизирует.
5. **Закрытие окна (`closeWindow`)**:
   - Удаляет окно из `windows`, очищает его состояние независимо от того, было ли оно свернуто или развернуто.

### 3.2 Жизненный цикл и хранилище
- Состояние `isMinimized` сохраняется в локальном хранилище браузера (`safeStorage`) в объектах окон.
- При загрузке воркспейса (`loadWorkspace`) свернутые окна корректно восстанавливают свой статус `isMinimized`.
- Активным окном при загрузке выбирается окно с наибольшим `zIndex` среди **не свернутых** окон (если все свернуты, `activeWindowId` остается `null`).

---

## 4. Пользовательский интерфейс и стилизация (UI Presentation & Styling)

### 4.1 Декомпозиция компонентов
- **`TerminalWindow`**:
  - В заголовок добавляется кнопка с `aria-label="Minimize window"` и иконкой дефиса/сворачивания.
  - В правый нижний угол окна монтируется манипулятор `.resizeHandle`.
  - При `pointerdown` на `.resizeHandle`:
    - Предотвращается всплытие и стандартное выделение.
    - Активируется захват указателя `setPointerCapture`.
    - Отслеживается смещение курсора и рассчитывается новый размер:
      `newWidth = Math.max(MIN_WINDOW_WIDTH, startWidth + dx)`
      `newHeight = Math.max(MIN_WINDOW_HEIGHT, startHeight + dy)`
    - Вызывается `onResize(window.id, { width: newWidth, height: newHeight })`.
  - При `pointerup` захват освобождается.
  - Если окно свернуто (`window.isMinimized === true`), оно не отображается на холсте `WorkspaceCanvas` (или скрывается через `display: none`).
- **`StatusBar`**:
  - Центральная область статусной панели отводится под док свернутых окон (`.minimizedDock`).
  - Для каждого окна со статусом `isMinimized: true` рендерится кнопка/чип:
    - Текст: название виджета и тикер (например, «Chart AAPL»).
    - Символ инструмента выделяется акцентным цветом `var(--brand-gold)`.
    - Доступный `aria-label`: `Restore Chart AAPL window`.
    - При клике вызывается `onRestoreWindow(window.id)`.
- **`TerminalShell`**:
  - Передает экшены `resizeWindow`, `minimizeWindow` в `TerminalWindow`.
  - Фильтрует свернутые окна и передает их в `StatusBar` через проп `minimizedWindows` вместе с обработчиком `onRestoreWindow={restoreWindow}`.

### 4.2 Дизайн-токены и тема (`DESIGN.md`)
- Манипулятор ресайза:
  - Размер: 12x12px, позиционирование `bottom: 0; right: 0; position: absolute;`.
  - Визуальный маркер: тонкие диагональные линии или угловой треугольный срез цвета `var(--border)`, при ховере/перетаскивании — `var(--brand-gold)`.
  - Курсор: `se-resize`.
- Чипы свернутых окон в статус-баре:
  - Высота: 18px, скругление 3px, отступы 0 6px, размер шрифта 11px.
  - Фон: `var(--surface-raised)`, граница `1px solid var(--border)`.
  - При наведении: подсветка границы `var(--brand-gold)`.
  - Фокус клавиатуры: `outline: 2px solid var(--brand-gold); outline-offset: 1px;`.

---

## 5. Черноящичные поведенческие сценарии тестирования (Behavioral Test Scenarios)

### 5.1 Модульные тесты хранилища (`src/modules/workspace/tests/workspace-store.test.ts`)
1. **Scenario 1: Minimizing an active window updates state and shifts focus**
   - **Given**: Воркспейс с двумя открытыми окнами (win-1 и win-2), win-2 активно (`activeWindowId === win-2`).
   - **When**: Вызывается `minimizeWindow(win-2)`.
   - **Then**: `win-2.isMinimized` становится `true`. `activeWindowId` автоматически переключается на оставшееся видимое окно win-1.
2. **Scenario 2: Minimizing all windows clears active focus**
   - **Given**: Одно открытое активное окно win-1.
   - **When**: Вызывается `minimizeWindow(win-1)`.
   - **Then**: `win-1.isMinimized` становится `true`, `activeWindowId` становится `null`.
3. **Scenario 3: Restoring a minimized window unminimizes and focuses it**
   - **Given**: Окно win-1 со статусом `isMinimized: true`.
   - **When**: Вызывается `restoreWindow(win-1)`.
   - **Then**: `win-1.isMinimized` становится `false`, `win-1.zIndex` становится максимальным, `activeWindowId` становится равен `win-1`.
4. **Scenario 4: Toggle minimize alternates window state**
   - **Given**: Окно win-1 со статусом `isMinimized: false`.
   - **When**: Вызывается `toggleMinimizeWindow(win-1)`.
   - **Then**: `isMinimized` становится `true`. При повторном вызове `isMinimized` возвращается в `false`.
5. **Scenario 5: Resizing window clamps to minimum dimensions**
   - **Given**: Открытое окно win-1 со стандартным размером 380x440.
   - **When**: Вызывается `resizeWindow(win-1, { width: 100, height: 100 })`.
   - **Then**: Размер окна в сторе устанавливается строго равным `{ width: 260, height: 180 }` (значения `MIN_WINDOW_WIDTH` и `MIN_WINDOW_HEIGHT`).
6. **Scenario 6: Persistence preserves minimized state and dimensions**
   - **Given**: Воркспейс с измененным размером 500x600 и свернутым окном win-1.
   - **When**: Вызывается `saveWorkspace()`, а затем очищается состояние стора и вызывается `loadWorkspace()`.
   - **Then**: Загруженное окно восстанавливает размер `{ width: 500, height: 600 }` и флаг `isMinimized: true`.

### 5.2 Модульные тесты UI-компонентов (`src/modules/workspace/tests/workspace-ui.test.tsx`)
1. **Scenario 7 UI: Minimizing window via header button hides it from canvas and shows in StatusBar dock**
   - **Given**: Отрендеренный `TerminalShell` с окном «Chart AAPL».
   - **When**: Пользователь кликает по кнопке «Minimize window» в заголовке окна.
   - **Then**: Окно «Chart AAPL» исчезает с холста (не рендерится как видимый `region`), а в статус-баре появляется кнопка «Restore Chart AAPL window».
2. **Scenario 8 UI: Clicking minimized dock chip in StatusBar restores and focuses window**
   - **Given**: Свернутое окно «Level II MSFT» отображается в виде чипа в статус-баре.
   - **When**: Пользователь кликает по чипу «Restore Level II MSFT window».
   - **Then**: Окно «Level II MSFT» снова отображается на холсте с атрибутом `data-focused="true"`, а чип удаляется из статус-бара.
3. **Scenario 9 UI: Pointer drag on resize handle updates window dimensions**
   - **Given**: Окно «Chart AAPL» с начальной шириной 380 и высотой 440.
   - **When**: Пользователь инициирует `pointerDown` на манипуляторе `.resizeHandle`, смещает указатель на `+100px` по X и `+50px` по Y, и отпускает указатель.
   - **Then**: Вызывается коллбэк `onResize` с параметрами `{ width: 480, height: 490 }`.

### 5.3 E2E сценарии Playwright (`tests/e2e/terminal-workspace.spec.ts`)
1. **Scenario 10 E2E: Full Resize & Minimize cycle**
   - Открыть приложение, создать окно Chart через меню New.
   - Изменить размер окна перетаскиванием правого нижнего угла; проверить обновленные CSS `width` и `height`.
   - Нажать кнопку Minimize в заголовке; проверить, что окно исчезло из зоны видимости, а в статус-баре появилась плашка с тикером.
   - Кликнуть по плашке в статус-баре; проверить, что окно восстановилось с сохраненными габаритами и активным фокусом.
