---
name: widget-order-book
type: module
status: approved
target_path: src/modules/order-book
composition_point: src/composition/widgets.ts
e2e_required: true
---

# Specification: widget-order-book

## 1. Purpose & Scope

### 1.1 In-Scope Responsibilities
- Реализация вертикального доменного модуля биржевого стакана заявок (Order Book / Level 2 DOM Ladder) в директории `src/modules/order-book/` в соответствии с архитектурой вертикальных срезов ([ADR-0001](../../../docs/adr/0001-modular-architecture.md)).
- Отображение двустороннего сплит-стакана заявок (DOM):
  - **Asks (продажи)**: верхняя секция стакана с цветовым кодированием `--market-sell`, упорядоченная по возрастанию цены снизу вверх (наименьший ask находится ближе к спреду).
  - **Плашка спреда (Spread Row)**: центральная строка с текущими `Best Bid`, `Best Ask`, абсолютным спредом (`spread = bestAsk - bestBid`) и относительным спредом в процентах (`spreadPct`).
  - **Bids (покупки)**: нижняя секция стакана с цветовым кодированием `--market-buy`, упорядоченная по убыванию цены сверху вниз (наивысший bid находится ближе к спреду).
- Визуализация глубины рынка (Depth Bars):
  - Расчёт кумулятивного объёма (Cumulative Volume) для каждого уровня от спреда вглубь стакана.
  - Отрисовка горизонтальной полосы глубины на фоне каждой строки с шириной, пропорциональной максимальному кумулятивному объёму видимых уровней.
- Управление состоянием через Zustand-стор модуля (`useOrderBookStore`):
  - Мульти-оконная изоляция: поддержка одновременного открытия нескольких независимых окон стаканов с ключом `windowId` (`windows: Record<string, OrderBookWindowState>`).
  - Селектор лимита глубины (10, 20, 50 уровней) с динамической перенарезкой видимых уровней.
- Интеграция с сервисом рыночных данных ([ADR-0005](../../../docs/adr/0005-market-data-streaming-and-transport-separation.md)):
  - Подписка на поток снапшотов стакана через `marketStreamService.subscribeOrderBook(symbol, onSnapshot, onError)`.
  - Автоматическая корректная отписка при смене тикера или закрытии окна (предотвращение утечек памяти).
- Интерактивность:
  - Выбор котировки: клик по строке стакана передаёт цену в опциональный колбэк `onSelectPrice(price)` (для интеграции с будущим модулем ввода торговых ордеров).
  - Hover-подсветка строки и курсор-pointer.
- Экспорт дескриптора виджета `orderBookWidgetDefinition` для точки сборки `src/composition/widgets.ts`.

### 1.2 Non-Goals & Out-of-Scope
- Модуль ввода и исполнения ордеров (Order Entry / Buy & Sell ticket) — выделен в отдельный торговый модуль.
- Агрегация тиков цен по пользовательскому шагу (Price Tick Grouping / Bucketing, например группировка по $0.5, $1.0) — отложено на последующие версии; в текущей версии шаг определяется поставщиком потока данных.
- Сохранение пользовательских настроек каждого окна в `safeStorage` — раскладка и параметры окон управляются модулем `workspace` в Шаге 5.
- Прямое межмодульное взаимодействие с графиком или лентой сделок в обход composition root.

### 1.3 Architectural Invariants
- **Модульная изоляция ([ADR-0001](../../../docs/adr/0001-modular-architecture.md))**: Внешние потребители импортируют публичные символы строго из `@/src/modules/order-book`. Глубокие импорты во внутренние директории (`model/`, `ui/`, `schema.ts`, `constants.ts`, `types.ts`) запрещены.
- **Изоляция виджетов**: Виджет стакана не зависит от других виджетов (`chart`, `time-and-sales`) и не зависит от `workspace`.
- **Канонические контракты**: Модуль потребляет стандартные сущности (`OrderBookSnapshot`, `OrderBookLevel`, `WidgetProps`, `WidgetDefinition`, `WindowKind`) из `@/src/shared/contracts`.
- **Потоковая подписка вне React ([ADR-0005](../../../docs/adr/0005-market-data-streaming-and-transport-separation.md))**: Подписка на котировки стакана управляется через сервис `marketStreamService` с гарантированной отпиской в `closeWindow`.
- **Стилизация по дизайн-токенам ([ADR-0003](../../../docs/adr/0003-css-architecture.md), [DESIGN.md](../../../DESIGN.md))**:
  - Компоненты используют CSS-модули (`*.module.css`) с семантическими классами (`.root`, `.header`, `.ladder`, `.row`, `.spreadRow`, `.depthBar`).
  - Числовые значения (цены, объемы, спред) строго оформляются шрифтом `--font-mono` с табличным выравниванием для предотвращения дрожания интерфейса при обновлении котировок.
  - Цветовая палитра строго соответствует токенам (`--surface`, `--surface-raised`, `--border`, `--market-buy`, `--market-sell`, `--text-primary`, `--text-secondary`, `--brand-gold`).

---

## 2. Public Contract Perimeter

### 2.1 Types (`src/modules/order-book/types.ts`)

```typescript
import type {
  OrderBookLevel,
  OrderBookSnapshot,
  OrderSide,
  WidgetDefinition,
  WidgetProps,
} from "@/src/shared/contracts";

export type OrderBookDepthLimit = 10 | 20 | 50;

export interface OrderBookRow extends OrderBookLevel {
  readonly side: OrderSide;
  readonly cumulativeSize: number;
  readonly depthPercent: number;
}

export interface OrderBookWindowState {
  readonly windowId: string;
  readonly symbol: string;
  readonly depthLimit: OrderBookDepthLimit;
  readonly bids: readonly OrderBookRow[];
  readonly asks: readonly OrderBookRow[];
  readonly bestBid: number | null;
  readonly bestAsk: number | null;
  readonly spread: number | null;
  readonly spreadPct: number | null;
  readonly maxCumulativeSize: number;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly lastUpdated: number | null;
}

export interface OrderBookStoreState {
  readonly windows: Readonly<Record<string, OrderBookWindowState>>;
}

export interface OrderBookStoreActions {
  readonly initWindow: (
    windowId: string,
    symbol: string,
    depthLimit?: OrderBookDepthLimit
  ) => void;
  readonly updateSnapshot: (windowId: string, snapshot: OrderBookSnapshot) => void;
  readonly setDepthLimit: (windowId: string, limit: OrderBookDepthLimit) => void;
  readonly setError: (windowId: string, error: string) => void;
  readonly closeWindow: (windowId: string) => void;
}

export type OrderBookStore = OrderBookStoreState & OrderBookStoreActions;

export interface OrderBookWidgetProps extends WidgetProps {
  readonly onSelectPrice?: (price: number) => void;
}
```

### 2.2 Validation Schema (`src/modules/order-book/schema.ts`)

```typescript
import { z } from "zod";
import { orderSideSchema } from "@/src/shared/contracts";

export const orderBookDepthLimitSchema = z.union([
  z.literal(10),
  z.literal(20),
  z.literal(50),
]);

export const orderBookRowSchema = z.object({
  price: z.number().positive(),
  size: z.number().nonnegative(),
  side: orderSideSchema,
  cumulativeSize: z.number().nonnegative(),
  depthPercent: z.number().min(0).max(100),
});
```

### 2.3 Constants (`src/modules/order-book/constants.ts`)

```typescript
import type { OrderBookDepthLimit } from "./types";

export const DEFAULT_DEPTH_LIMIT: OrderBookDepthLimit = 20;

export const DEPTH_LIMIT_OPTIONS: readonly OrderBookDepthLimit[] = [10, 20, 50] as const;

export const ORDER_BOOK_WIDGET_KIND = "orderBook" as const;

export const ORDER_BOOK_WIDGET_TITLE = "Order Book" as const;
```

### 2.4 Re-exports (`src/modules/order-book/index.ts`)

```typescript
export type {
  OrderBookDepthLimit,
  OrderBookRow,
  OrderBookStore,
  OrderBookStoreActions,
  OrderBookStoreState,
  OrderBookWidgetProps,
  OrderBookWindowState,
} from "./types";

export {
  orderBookDepthLimitSchema,
  orderBookRowSchema,
} from "./schema";

export {
  DEFAULT_DEPTH_LIMIT,
  DEPTH_LIMIT_OPTIONS,
  ORDER_BOOK_WIDGET_KIND,
  ORDER_BOOK_WIDGET_TITLE,
} from "./constants";

export { useOrderBookStore } from "./model/order-book-store";

export { OrderBookWidget } from "./ui/order-book-widget";

export { orderBookWidgetDefinition } from "./ui/order-book-widget-definition";
```

---

## 3. Core Logic & State Management

### 3.1 State Shape & Processing Calculations
- **Zustand-стор модуля (`useOrderBookStore`)**:
  - Хранит состояние всех окон стакана в словаре `windows: Record<string, OrderBookWindowState>`.
  - При поступлении `OrderBookSnapshot`:
    1. Исходные `bids` и `asks` обрезаются до выбранного `depthLimit`.
    2. Для `asks`: сортируются по возрастанию цены, вычисляется накопительный объём от лучшего аска (минимальной цены) вверх:
       $$cumSize_i = \sum_{k=0}^{i} size_k$$
    3. Для `bids`: сортируются по убыванию цены, вычисляется накопительный объём от лучшего бида (максимальной цены) вниз:
       $$cumSize_j = \sum_{k=0}^{j} size_k$$
    4. Вычисляется общий максимум кумулятивного объёма среди видимых уровней:
       $$maxCumulativeSize = \max(cumSize_{asks}^{last}, cumSize_{bids}^{last})$$
    5. Для каждой строки рассчитывается процент заполнения шкалы глубины:
       $$depthPercent = \frac{cumulativeSize}{maxCumulativeSize} \times 100\%$$
    6. Вычисляются `bestBid` (цена первой строки bids), `bestAsk` (цена первой строки asks), абсолютный спред $bestAsk - bestBid$ и относительный спред:
       $$spreadPct = \frac{bestAsk - bestBid}{(bestAsk + bestBid) / 2} \times 100\%$$
- **Динамическая смена лимита глубины (`setDepthLimit`)**:
  - При переключении пользователем (10, 20, 50) текущие исходные снапшоты повторно нарезаются и пересчитываются с новым лимитом.

### 3.2 Side Effects & Lifecycles
- **Подписка на поток котировок**:
  - Экшен `initWindow(windowId, symbol, depthLimit)` регистрирует окно в сторе со статусом `isLoading: true`.
  - Открывает подписку `marketStreamService.subscribeOrderBook(symbol, onSnapshot, onError)`.
  - Сохраняет функцию отписки `unsubscribe` в замыкании реестра подписок модуля.
- **Очистка ресурсов (Memory Leak Prevention)**:
  - При закрытии окна виджета вызывается `closeWindow(windowId)`.
  - `closeWindow` выполняет вызов `unsubscribe()` для тикера и удаляет срез окна из объекта `windows`.

---

## 4. UI Presentation & Styling

### 4.1 Component Decomposition
- `OrderBookWidget` (`src/modules/order-book/ui/order-book-widget.tsx`):
  - Корневой компонент виджета, принимающий `OrderBookWidgetProps`.
  - Вызывает хук жизненного цикла инициализации и очистки окна в `useOrderBookStore`.
- `OrderBookHeader` (`src/modules/order-book/ui/order-book-header.tsx`):
  - Верхняя панель: название инструмента, кнопка смены инструмента (`onChangeInstrument`), селектор глубины стакана (10, 20, 50).
- `OrderBookLadder` (`src/modules/order-book/ui/order-book-ladder.tsx`):
  - Табличная сетка с 3 столбцами: `Price`, `Size`, `Total` (кумулятивный объем).
  - Секция `Asks` (красные уровни, отображаются вверху).
  - Секция `SpreadRow` (разделительная строка посередине с лучшими ценами и спредом).
  - Секция `Bids` (зеленые уровни, отображаются внизу).
- `OrderBookRowComponent` (`src/modules/order-book/ui/order-book-row.tsx`):
  - Отдельная строка уровня стакана.
  - Отрисовывает абсолютный полупрозрачный фоновый бар глубины с шириной `style={{ width: `${depthPercent}%` }}`.
  - Обрабатывает `onClick={() => onSelectPrice?.(price)}`.

### 4.2 Visual Tokens & Themes (`DESIGN.md`, `tokens.css`)
- Фон и контейнер: `var(--surface)`, граница: `var(--border)`.
- Сетка и заголовки таблицы: `var(--text-secondary)`, шрифт `var(--font-ui)`.
- Числовые столбцы (Price, Size, Total): моноширинный шрифт `var(--font-mono)`, табличное выравнивание чисел по правому краю (`tabular-nums`).
- Продажи (Asks):
  - Текст цены: `var(--market-sell)`.
  - Фоновый бар глубины: полупрозрачная заливка на базе `var(--market-sell)` (с прозрачностью 12–15%).
- Покупки (Bids):
  - Текст цены: `var(--market-buy)`.
  - Фоновый бар глубины: полупрозрачная заливка на базе `var(--market-buy)` (с прозрачностью 12–15%).
- Плашка спреда: `var(--surface-raised)`, тонкие границы `var(--border)`, акцент лучшей цены: `var(--text-primary)`, относительный спред: `var(--text-secondary)`.
- Поддержка темной и светлой тем ([DESIGN.md](../../../DESIGN.md)): адаптивная работа через CSS-переменные без хардкода hex-цветов в стилях.

### 4.3 Component States
- **Loading State**: Отображается нейтральный скелетон или индикатор «Connecting to order book feed...», пока не получен первый снапшот.
- **Empty State**: Если массив котировок пуст, отображается сообщение «No depth data available».
- **Error State**: При сбое подписки стрима выводится понятное сообщение об ошибке с кнопкой повтора подписки.
- **Active / Hover State**: При наведении на строку подсвечивается строка (`var(--surface-raised)`) и курсор меняется на `pointer`.

---

## 5. Black-Box Behavioral Test Scenarios

> [!NOTE]
> Тесты импортируют функционал строго из публичного шва `@/src/modules/order-book` (или `../index`).
> Специфицированы сквозные поведенческие сценарии в формате Given-When-Then с проверкой чистой бизнес-логики, расчёта глубины, спреда и UI-интерактивности.

### Scenario 1: Window Initialization and Stream Subscription
- **Given:** Исходное пустое состояние хранилища `useOrderBookStore` и мок `marketStreamService`.
- **When:** Вызывается экшен `initWindow("win-ob-1", "AAPL", 20)`.
- **Then:** В `windows` создаётся запись для `"win-ob-1"` с `symbol: "AAPL"`, `depthLimit: 20`, `isLoading: true`, и вызывается метод `marketStreamService.subscribeOrderBook("AAPL", ...)`.

### Scenario 2: Snapshot Ingestion, Depth Aggregation, and Spread Calculation
- **Given:** Инициализированное окно `"win-ob-1"` с тикером `"AAPL"` и `depthLimit: 20`.
- **When:** Поступает снапшот `OrderBookSnapshot`:
  - `bids: [{ price: 100.0, size: 10 }, { price: 99.5, size: 20 }]`
  - `asks: [{ price: 100.5, size: 15 }, { price: 101.0, size: 25 }]`
- **Then:**
  - `bestBid` равен `100.0`, `bestAsk` равен `100.5`.
  - Абсолютный спред `spread` равен `0.5`, `spreadPct` корректно рассчитан.
  - Кумулятивные объёмы:
    - Bids: уровень 1 = `10`, уровень 2 = `30`.
    - Asks: уровень 1 = `15`, уровень 2 = `40`.
  - `maxCumulativeSize` равен `40`.
  - `depthPercent` для Asks: 1-й уровень = $15/40 = 37.5\%$, 2-й уровень = $40/40 = 100\%$.
  - `depthPercent` для Bids: 1-й уровень = $10/40 = 25\%$, 2-й уровень = $30/40 = 75\%$.
  - Флаг `isLoading` переключается в `false`.

### Scenario 3: Dynamic Depth Limit Reslicing
- **Given:** Окно с 25 уровнями заявок в bids и asks, настроенное на `depthLimit: 20`.
- **When:** Вызывается экшен `setDepthLimit("win-ob-1", 10)`.
- **Then:** Видимые массивы `bids` и `asks` усекаются ровно до 10 уровней, а `maxCumulativeSize` и `depthPercent` строк автоматически пересчитываются по топ-10 уровням.

### Scenario 4: Stream Error Handling
- **Given:** Активное окно стакана с подпиской на котировки.
- **When:** Колбэк ошибки стрима передаёт объект `Error("Connection lost")`.
- **Then:** Поле `error` в состоянии окна принимает значение `"Connection lost"`, а флаг `isLoading` сбрасывается в `false`.

### Scenario 5: Window Teardown and Unsubscribe Cleanup
- **Given:** Активное окно `"win-ob-1"` с открытой подпиской на стрим.
- **When:** Вызывается экшен `closeWindow("win-ob-1")`.
- **Then:** Вызывается функция `unsubscribe()` для тикера и срез `"win-ob-1"` полностью удаляется из словаря `windows`.

### Scenario 6: Visual Rendering and Price Selection Interaction
- **Given:** Смонтированный компонент `OrderBookWidget` с `windowId: "win-ob-1"`, инструментом `{ symbol: "AAPL", name: "Apple Inc." }` и переданным шпионом `onSelectPrice`.
- **When:** Пользователь кликает по строке с ценой `100.5`.
- **Then:** Вызывается колбэк `onSelectPrice` с аргументом `100.5`.

### Scenario 7: Empty and Loading Presentation States
- **Given:** Новое окно до получения первого снапшота котировок (`isLoading: true`).
- **When:** Компонент рендерится в DOM.
- **Then:** Отображается состояние загрузки без аварийных сбоев, ошибок отрисовки и значений `NaN`.

---

## 6. Wiring & Integration

### 6.1 Composition Point
- **Целевой файл интеграции**: `src/composition/widgets.ts` (будет подключен в Шаге 5: `composition-root`).
- **Регистрация дескриптора виджета**:
  ```typescript
  import { orderBookWidgetDefinition } from "@/src/modules/order-book";

  export const WIDGET_REGISTRY = {
    // ...
    [orderBookWidgetDefinition.kind]: orderBookWidgetDefinition,
  } as const;
  ```

### 6.2 E2E Integration Test Requirement
- **Playwright E2E**: `true`.
- **Сценарий (`tests/e2e/order-book.spec.ts`)**:
  - Открытие окна стакана заявок с тикером по умолчанию.
  - Проверка появления таблицы стакана с секциями Asks, Bids и плашкой спреда.
  - Проверка прихода потоковых котировок (наличие цен и полос глубины).
  - Переключение глубины стакана через селектор (10 / 20 / 50) и проверка изменения количества отображаемых строк.
  - Клик по цене строки стакана и проверка вызова обработчика выбора цены.
