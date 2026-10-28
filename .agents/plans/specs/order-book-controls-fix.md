---
name: order-book-controls-fix
type: fix
status: approved
target_path: src/modules/order-book
composition_point: none
e2e_required: false
---

# Specification: order-book-controls-fix

## 1. Purpose & Scope

### 1.1 In-Scope Responsibilities
- Устранение дефекта кнопок переключения глубины стакана (10 / 20 / 50) в окне Level 2 (Order Book):
  - Расширение глубины генерации снимков биржевого стакана в `DemoMarketDataFeed` (модуль `market-data`) с фиксированных 10 уровней до константы `DEMO_ORDER_BOOK_DEPTH = 50` уровней bids и asks.
  - Обеспечение динамического отображения 10, 20 или 50 уровней котировок при переключении кнопок в `OrderBookHeader` как при получении новых снимков, так и при фильтрации текущего кешированного снимка в `OrderBookStore`.
- Устранение дублирующей кнопки смены инструмента:
  - Удаление кнопки «Change» (`.changeButton`) из тулбара `OrderBookHeader`, так как каждое окно терминала (`TerminalWindow`) уже содержит штатную иконку поиска инструмента в заголовке окна.
  - Очистка связанных стилей `.changeButton` в `order-book-header.module.css` и удаление `onChangeInstrument` из локального интерфейса `OrderBookHeaderProps`.
  - Удаление передачи `onChangeInstrument` в `OrderBookHeader` из `OrderBookWidget`.
- Сохранение стандартного вертикального скроллинга стакана (`overflow-y: auto`) без принудительного центрирования спреда.
- Актуализация регрессионных черноящичных тестов:
  - Проверка отсутствия кнопки «Change» в `OrderBookHeader`.
  - Проверка переключения глубины стакана (10, 20, 50 уровней) на снимках с 50 уровнями котировок.
  - Проверка генерации 50 уровней bids и asks в `DemoMarketDataFeed`.

### 1.2 Non-Goals & Out-of-Scope
- Изменение контракта `OrderBookSnapshot` в `@/src/shared/contracts` (формат уровней `OrderBookLevel` остается неизменным).
- Изменение глобального интерфейса `WidgetProps` (свойство `onChangeInstrument` остается опциональным свойством общего контракта виджетов).
- Изменение механики расчетов спреда и совокупного объема в `processOrderBookSnapshot`.
- Добавление автоскролла или центрирования спреда (выбран стандартный скролл-контейнер).

### 1.3 Architectural Invariants & Best Practices
- **Модульная изоляция ([ADR-0001](../../../docs/adr/0001-modular-architecture.md))**:
  - Модуль `order-book` потребляет рыночные данные строго через публичный интерфейс `@/src/modules/market-data` (`marketStreamService.subscribeOrderBook`).
  - Модуль `market-data` инкапсулирует эмуляцию данных в `DemoMarketDataFeed`.
  - Отсутствуют перекрестные импорты между внутренними файлами модулей.
- **Политика изолированных контрактов ([ADR-0002](../../../docs/adr/0002-boundary-enforcement-and-quarantine.md))**:
  - Публичные интерфейсы экспортируются исключительно через входные швы `index.ts`.
- **CSS-архитектура и дизайн-токены ([ADR-0003](../../../docs/adr/0003-css-architecture.md), [DESIGN.md](../../../DESIGN.md))**:
  - Кнопки переключения глубины используют `var(--surface-raised)`, `var(--brand-gold)`, `var(--on-gold)` и `var(--text-secondary)`.
  - Селекторы кнопок сохраняют доступность (`aria-pressed`, `role="group"`).
- **Анти-Тавтология в тестах**: Черноящичные тесты проверяют реальный рендеринг строк стакана при переключении глубины и отсутствие кнопки «Change», избегая дублирования тестов TypeScript компилятора.

---

## 2. Public Contract Perimeter

### 2.1 Types (`src/modules/order-book/types.ts`)

```typescript
import type {
  OrderBookLevel,
  OrderBookSnapshot,
  OrderSide,
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
  readonly initWindow: (windowId: string, symbol: string, depthLimit?: OrderBookDepthLimit) => void;
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

export const orderBookDepthLimitSchema = z.union([
  z.literal(10),
  z.literal(20),
  z.literal(50),
]);

export const orderBookRowSchema = z.object({
  price: z.number().positive(),
  size: z.number().nonnegative(),
  side: z.enum(["buy", "sell"]),
  cumulativeSize: z.number().nonnegative(),
  depthPercent: z.number().min(0).max(100),
});
```

### 2.3 Constants (`src/modules/order-book/constants.ts` & `src/modules/market-data/constants.ts`)

#### `src/modules/order-book/constants.ts`
```typescript
import type { OrderBookDepthLimit } from "./types";

export const DEFAULT_DEPTH_LIMIT: OrderBookDepthLimit = 20;

export const DEPTH_LIMIT_OPTIONS: readonly OrderBookDepthLimit[] = [10, 20, 50] as const;

export const ORDER_BOOK_WIDGET_KIND = "orderBook" as const;

export const ORDER_BOOK_WIDGET_TITLE = "Order Book" as const;
```

#### `src/modules/market-data/constants.ts`
```typescript
import type { Timeframe } from "@/src/shared/contracts";

export const DEFAULT_TIMEFRAME: Timeframe = "1m";

export const TIMEFRAMES: readonly Timeframe[] = ["1m", "5m", "15m", "1h", "1d"] as const;

export const DEMO_FEED_INTERVALS = {
  tickerMs: 500,
  tradeMs: 300,
  orderBookMs: 400,
  candleMs: 1000,
} as const;

export const DEMO_INITIAL_PRICES: Readonly<Record<string, number>> = {
  ES: 5000.0,
  NQ: 18000.0,
  AAPL: 175.5,
  MSFT: 420.0,
  NVDA: 880.0,
  DEFAULT: 100.0,
} as const;

export const DEMO_ORDER_BOOK_DEPTH = 50;
```

### 2.4 Re-exports (`src/modules/order-book/index.ts` & `src/modules/market-data/index.ts`)

#### `src/modules/order-book/index.ts`
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

export { orderBookDepthLimitSchema, orderBookRowSchema } from "./schema";

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

#### `src/modules/market-data/index.ts`
```typescript
export type {
  CandleSubscriptionOptions,
  DemoMarketDataFeedOptions,
  ErrorHandler,
  FeedStatus,
  MarketDataFeed,
  MarketDataMessage,
  MarketStreamService,
  MarketTopic,
  MessageHandler,
  StatusHandler,
  SubscriptionOptions,
  Unsubscribe,
} from "./types";

export { marketChannelSchema, marketTopicSchema } from "./schema";

export {
  DEFAULT_TIMEFRAME,
  DEMO_FEED_INTERVALS,
  DEMO_INITIAL_PRICES,
  DEMO_ORDER_BOOK_DEPTH,
  TIMEFRAMES,
} from "./constants";

export { DemoMarketDataFeed, createDemoMarketDataFeed } from "./model/demo-market-data-feed";

export {
  MarketDataStreamServiceImpl,
  createMarketStreamService,
  marketStreamService,
} from "./model/market-stream";
```

---

## 3. Core Logic & State Management

### 3.1 Demo Market Data Feed Depth Expansion (`src/modules/market-data/model/demo-market-data-feed.ts`)
- В методе `generateOrderBook(topic: MarketTopic)` цикл генерации уровней стакана изменяется с фиксированных `10` итераций на `DEMO_ORDER_BOOK_DEPTH` (50):
  ```typescript
  for (let i = 0; i < DEMO_ORDER_BOOK_DEPTH; i++) {
    const bidPrice = Number((mid * (1 - 0.0003 * (i + 1))).toFixed(2));
    const askPrice = Number((mid * (1 + 0.0003 * (i + 1))).toFixed(2));
    const bidSize = Math.floor(Math.random() * 50) + 1;
    const askSize = Math.floor(Math.random() * 50) + 1;

    bids.push({ price: Math.max(0.01, bidPrice), size: bidSize });
    asks.push({ price: Math.max(0.01, askPrice), size: askSize });
  }
  ```
- Генерируемый снимок содержит 50 уровней bids и 50 уровней asks, отсортированных по удалению от mid-price.

### 3.2 Order Book Store Processing (`src/modules/order-book/model/order-book-store.ts`)
- Существующий метод `processOrderBookSnapshot(snapshot, depthLimit)` выполняет:
  - `snapshot.asks.sort((a, b) => a.price - b.price).slice(0, depthLimit)`
  - `snapshot.bids.sort((a, b) => b.price - a.price).slice(0, depthLimit)`
- При поступлении снимка из 50 уровней:
  - При `depthLimit = 10`: отображается 10 лучших bids и 10 лучших asks.
  - При `depthLimit = 20`: отображается 20 лучших bids и 20 лучших asks.
  - При `depthLimit = 50`: отображается 50 лучших bids и 50 лучших asks.
- Метод `setDepthLimit(windowId, limit)` извлекает кешированный `rawSnapshots.get(windowId)` и немедленно пересчитывает отображаемые строки для нового лимита без ожидания следующего тика.

---

## 4. UI Presentation & Styling

### 4.1 OrderBookHeader (`src/modules/order-book/ui/order-book-header.tsx`)
- Интерфейс `OrderBookHeaderProps`:
  ```typescript
  export interface OrderBookHeaderProps {
    readonly symbol: string;
    readonly name?: string;
    readonly depthLimit: OrderBookDepthLimit;
    readonly onChangeDepthLimit: (limit: OrderBookDepthLimit) => void;
  }
  ```
- В JSX компонента `OrderBookHeader`:
  - В блоке `.instrumentGroup` рендерятся исключительно `span.symbol` и опциональный `span.name`.
  - Удаляется кнопка `<button className={styles.changeButton}>Change</button>`.
  - Блок переключения глубины `.depthSelector` сохраняется в неизменном виде.

### 4.2 Стили тулбара (`src/modules/order-book/ui/order-book-header.module.css`)
- Удаляются неиспользуемые правила `.changeButton` и `.changeButton:hover`.
- Стили `.header`, `.instrumentGroup`, `.symbol`, `.name`, `.depthSelector`, `.depthButton` и `.activeDepth` остаются в строгом соответствии с токенами `DESIGN.md`.

### 4.3 OrderBookWidget (`src/modules/order-book/ui/order-book-widget.tsx`)
- Передача пропа `onChangeInstrument` в `OrderBookHeader` исключается.

---

## 5. Black-Box Behavioral Test Scenarios

### 5.1 Unit Tests: `src/modules/order-book/tests/order-book.test.tsx`

#### Scenario A: OrderBookHeader renders symbol and name without redundant Change button
- **Given**: Смонтирован `OrderBookWidget` с валидным инструментом (`AAPL`).
- **When**: Рендерится тулбар стакана.
- **Then**:
  - Текст символа `AAPL` отображается в документе.
  - Кнопка с доступным именем `/change/i` отсутствует в DOM (`queryByRole("button", { name: /change/i })` возвращает `null`).

#### Scenario B: Switching depth limit dynamically changes row count
- **Given**: `OrderBookWidget` подключен и получил снимок с 50 уровнями bids и 50 уровнями asks. По умолчанию активен лимит 20.
- **When**: Пользователь проверяет количество отображаемых строк в таблице.
- **Then**: В секции Asks отображается 20 строк, в секции Bids — 20 строк.
- **When**: Пользователь кликает по кнопке глубины `10` (`screen.getByRole("button", { name: "10" })`).
- **Then**: В секции Asks отображается ровно 10 строк, в секции Bids — ровно 10 строк. Кнопка `10` имеет `data-active="true"` и `aria-pressed="true"`.
- **When**: Пользователь кликает по кнопке глубины `50` (`screen.getByRole("button", { name: "50" })`).
- **Then**: В секции Asks отображается ровно 50 строк, в секции Bids — ровно 50 строк. Кнопка `50` имеет `data-active="true"` и `aria-pressed="true"`.

### 5.2 Unit Tests: `src/modules/market-data/tests/demo-market-data-feed.test.ts`

#### Scenario C: DemoMarketDataFeed generates 50 levels of bids and asks
- **Given**: Создан экземпляр `DemoMarketDataFeed` и выполнена подписка на топик `{ symbol: "ES", channel: "orderBook" }`.
- **When**: Таймер продвигается на `DEMO_FEED_INTERVALS.orderBookMs`.
- **Then**: В полученном сообщении `snapshot.bids.length` строго равен `50`, а `snapshot.asks.length` строго равен `50`.
