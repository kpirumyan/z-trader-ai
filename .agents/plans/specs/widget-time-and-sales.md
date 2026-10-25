---
name: widget-time-and-sales
type: module
status: approved
target_path: src/modules/time-and-sales
composition_point: src/composition/widgets.ts
e2e_required: true
---

# Specification: widget-time-and-sales

## 1. Purpose & Scope

### 1.1 In-Scope Responsibilities
- Реализация вертикального доменного модуля ленты совершенных сделок (Time & Sales / Tape) в директории `src/modules/time-and-sales/` в соответствии с архитектурой модульных срезов ([ADR-0001](../../../docs/adr/0001-modular-architecture.md)).
- Отображение хронологической таблицы исполненных сделок в реальном времени:
  - **Порядок добавления**: свежие сделки добавляются в начало списка (`Top-of-Tape`), чтобы последние изменения были мгновенно видны без необходимости прокрутки.
  - **Столбцы таблицы**: `Time` (время в формате `HH:mm:ss`), `Price` (цена исполнения), `Size` (количество лотов / объем) и `Side` (направление сделки: Buy / Sell).
- Управление буфером сделок и фильтрацией через Zustand-стор модуля (`useTimeAndSalesStore`):
  - **Мульти-оконная изоляция**: поддержка одновременного открытия нескольких независимых окон Time & Sales с ключом `windowId` (`windows: Record<string, TimeAndSalesWindowState>`).
  - **FIFO-буфер с настраиваемым лимитом**: селектор емкости буфера (50, 100, 250 сделок, по умолчанию 100). При превышении емкости старые сделки вытесняются с конца списка для предотвращения утечек памяти и сохранения высокой частоты кадров (60 FPS).
  - **Диапазонная фильтрация объема (`sizeFilter`)**: поддержка порогов `minSize` и опционального `maxSize` (`minSize <= size <= (maxSize ?? Infinity)`).
  - **Панель пресетов фильтра**: быстрые фильтры (`All`, `Small (<10)`, `Medium (10–49)`, `Large (≥50)`) и ручной ввод произвольного диапазона `[min, max]`.
- Визуализация и цветовое кодирование:
  - Цветовая дифференциация по дизайн-токенам ([ADR-0003](../../../docs/adr/0003-css-architecture.md), [DESIGN.md](../../../DESIGN.md)): зеленый `--market-buy` для покупок, красный `--market-sell` для продаж.
  - Моноширинный шрифт `--font-mono` с табличным выравниванием чисел (`tabular-nums`) для столбцов времени, цен и объемов.
  - Визуальный акцент для сделок повышенного объема (`size >= LARGE_TRADE_THRESHOLD`, по умолчанию 20) — полупрозрачная фоновая плашка или контрастный бейдж.
- Интеграция с сервисом рыночных данных ([ADR-0005](../../../docs/adr/0005-market-data-streaming-and-transport-separation.md)):
  - Подписка на поток сделок через `marketStreamService.subscribeTrades(symbol, onTrade, onError)`.
  - Автоматическая корректная отписка при смене тикера или размонтировании/закрытии окна (`closeWindow`).
- Экспорт дескриптора виджета `timeAndSalesWidgetDefinition` для точки сборки `src/composition/widgets.ts`.

### 1.2 Non-Goals & Out-of-Scope
- Модуль ввода и исполнения ордеров (Order Entry / Buy & Sell ticket) — выделен в отдельный торговый модуль.
- Звуковые оповещения (Audio Alerts) при крупных сделках — отложено на последующие версии терминала.
- Экспорт истории сделок в CSV/Excel — не входит в базовую функциональность терминала.
- Кнопка фиксации / паузы автопрокрутки (Freeze / Pause Tape) — исключена из текущей спецификации по решению разработчика.
- Сохранение пользовательских настроек каждого окна в `safeStorage` — раскладка и параметры окон управляются модулем `workspace` в Шаге 5.
- Прямое межмодульное взаимодействие со стаканом заявок или графиком в обход composition root.

### 1.3 Architectural Invariants
- **Модульная изоляция ([ADR-0001](../../../docs/adr/0001-modular-architecture.md))**: Внешние потребители импортируют публичные символы строго из `@/src/modules/time-and-sales`. Глубокие импорты во внутренние директории (`model/`, `ui/`, `schema.ts`, `constants.ts`, `types.ts`) запрещены.
- **Изоляция виджетов**: Виджет Time & Sales не зависит от других виджетов (`chart`, `order-book`) и не зависит от `workspace`.
- **Канонические контракты**: Модуль потребляет стандартные сущности (`Trade`, `WidgetProps`, `WidgetDefinition`, `WindowKind`, `OrderSide`) из `@/src/shared/contracts`.
- **Потоковая подписка вне React ([ADR-0005](../../../docs/adr/0005-market-data-streaming-and-transport-separation.md))**: Подписка на котировки сделок управляется через сервис `marketStreamService` с гарантированной отпиской в `closeWindow`.
- **Стилизация по дизайн-токенам ([ADR-0003](../../../docs/adr/0003-css-architecture.md), [DESIGN.md](../../../DESIGN.md))**:
  - Компоненты используют CSS-модули (`*.module.css`) с семантическими классами (`.root`, `.header`, `.table`, `.row`, `.cell`, `.time`, `.price`, `.size`, `.side`, `.largeSizeBadge`, `.filterPopover`).
  - Числовые значения (время, цены, объемы) оформляются шрифтом `--font-mono` с выравниванием по правому краю для предотвращения визуального дрожания интерфейса при обновлении ленты.
  - Цветовая палитра строго соответствует токенам (`--surface`, `--surface-raised`, `--border`, `--market-buy`, `--market-sell`, `--text-primary`, `--text-secondary`, `--brand-gold`).

---

## 2. Public Contract Perimeter

### 2.1 Types (`src/modules/time-and-sales/types.ts`)

```typescript
import type {
  OrderSide,
  Trade,
  WidgetDefinition,
  WidgetProps,
} from "@/src/shared/contracts";

export type TradeBufferLimit = 50 | 100 | 250;

export interface TradeSizeFilter {
  readonly minSize: number;
  readonly maxSize: number | null;
}

export interface TimeAndSalesRow extends Trade {
  readonly formattedTime: string;
  readonly formattedPrice: string;
  readonly isLarge: boolean;
}

export interface TimeAndSalesWindowState {
  readonly windowId: string;
  readonly symbol: string;
  readonly bufferLimit: TradeBufferLimit;
  readonly sizeFilter: TradeSizeFilter;
  readonly trades: readonly Trade[];
  readonly visibleRows: readonly TimeAndSalesRow[];
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly lastUpdated: number | null;
}

export interface TimeAndSalesStoreState {
  readonly windows: Readonly<Record<string, TimeAndSalesWindowState>>;
}

export interface TimeAndSalesStoreActions {
  readonly initWindow: (
    windowId: string,
    symbol: string,
    bufferLimit?: TradeBufferLimit,
    sizeFilter?: Partial<TradeSizeFilter>
  ) => void;
  readonly addTrade: (windowId: string, trade: Trade) => void;
  readonly setBufferLimit: (windowId: string, limit: TradeBufferLimit) => void;
  readonly setSizeFilter: (
    windowId: string,
    filter: Partial<TradeSizeFilter>
  ) => void;
  readonly resetSizeFilter: (windowId: string) => void;
  readonly setError: (windowId: string, error: string | null) => void;
  readonly closeWindow: (windowId: string) => void;
}

export type TimeAndSalesStore = TimeAndSalesStoreState & TimeAndSalesStoreActions;

export type TimeAndSalesWidgetProps = WidgetProps;
```

### 2.2 Validation Schema (`src/modules/time-and-sales/schema.ts`)

```typescript
import { z } from "zod";

export const tradeBufferLimitSchema = z.union([
  z.literal(50),
  z.literal(100),
  z.literal(250),
]);

export const tradeSizeFilterSchema = z
  .object({
    minSize: z.number().nonnegative(),
    maxSize: z.number().positive().nullable(),
  })
  .refine(
    (f) => f.maxSize === null || f.maxSize >= f.minSize,
    {
      message: "maxSize must be greater than or equal to minSize",
    }
  );
```

### 2.3 Constants (`src/modules/time-and-sales/constants.ts`)

```typescript
import type { TradeBufferLimit, TradeSizeFilter } from "./types";

export const TIME_AND_SALES_WIDGET_KIND = "timeAndSales" as const;
export const TIME_AND_SALES_WIDGET_TITLE = "Time & Sales" as const;

export const DEFAULT_TRADE_BUFFER_LIMIT: TradeBufferLimit = 100;
export const TRADE_BUFFER_LIMIT_OPTIONS: readonly TradeBufferLimit[] = [
  50, 100, 250,
] as const;

export const DEFAULT_TRADE_SIZE_FILTER: TradeSizeFilter = {
  minSize: 0,
  maxSize: null,
};

export const LARGE_TRADE_THRESHOLD = 20;

export interface FilterPresetOption {
  readonly label: string;
  readonly filter: TradeSizeFilter;
}

export const SIZE_FILTER_PRESETS: readonly FilterPresetOption[] = [
  { label: "All", filter: { minSize: 0, maxSize: null } },
  { label: "Small (<10)", filter: { minSize: 0, maxSize: 9 } },
  { label: "Medium (10–49)", filter: { minSize: 10, maxSize: 49 } },
  { label: "Large (≥50)", filter: { minSize: 50, maxSize: null } },
] as const;
```

### 2.4 Re-exports (`src/modules/time-and-sales/index.ts`)

```typescript
export type {
  FilterPresetOption,
  TimeAndSalesRow,
  TimeAndSalesStore,
  TimeAndSalesStoreActions,
  TimeAndSalesStoreState,
  TimeAndSalesWidgetProps,
  TimeAndSalesWindowState,
  TradeBufferLimit,
  TradeSizeFilter,
} from "./types";

export {
  tradeBufferLimitSchema,
  tradeSizeFilterSchema,
} from "./schema";

export {
  DEFAULT_TRADE_BUFFER_LIMIT,
  DEFAULT_TRADE_SIZE_FILTER,
  LARGE_TRADE_THRESHOLD,
  SIZE_FILTER_PRESETS,
  TIME_AND_SALES_WIDGET_KIND,
  TIME_AND_SALES_WIDGET_TITLE,
  TRADE_BUFFER_LIMIT_OPTIONS,
} from "./constants";

export { useTimeAndSalesStore } from "./model/time-and-sales-store";

export { TimeAndSalesWidget } from "./ui/time-and-sales-widget";

export { timeAndSalesWidgetDefinition } from "./ui/time-and-sales-widget-definition";
```

---

## 3. Core Logic & State Management

### 3.1 State Shape & FIFO Ring Buffer Calculations
- **Zustand-стор модуля (`useTimeAndSalesStore`)**:
  - Хранит состояние всех окон ленты сделок в словаре `windows: Record<string, TimeAndSalesWindowState>`.
  - При поступлении нового тика `trade: Trade` через `addTrade(windowId, trade)`:
    1. Новый тик вставляется в начало массива сырых сделок: `nextTrades = [trade, ...currentTrades].slice(0, bufferLimit)`.
    2. Вычисляется `visibleRows` путем фильтрации по текущему `sizeFilter`:
       - Условие видимости: `trade.size >= minSize && (maxSize === null || trade.size <= maxSize)`.
       - Преобразование в `TimeAndSalesRow`:
         - `formattedTime`: форматирование миллисекундного timestamp в строку `HH:mm:ss` (с лидирующими нулями).
         - `formattedPrice`: форматирование цены `trade.price.toFixed(2)`.
         - `isLarge`: `trade.size >= LARGE_TRADE_THRESHOLD`.
    3. Обновляется `lastUpdated = trade.time` и снимается флаг `isLoading: false`.
- **Динамическая смена лимита буфера (`setBufferLimit`)**:
  - При переключении лимита (50, 100, 250) массив `trades` обрезается до нового лимита, а `visibleRows` синхронно пересчитываются.
- **Динамическая смена фильтра объема (`setSizeFilter` / `resetSizeFilter`)**:
  - Обновляет значения `minSize` и `maxSize`.
  - Мгновенно перефильтровывает текущий массив `trades` в `visibleRows` без перезагрузки стрима котировок.

### 3.2 Side Effects & Lifecycles
- **Подписка на поток сделок**:
  - Хук/экшен `initWindow(windowId, symbol, bufferLimit, sizeFilter)` регистрирует окно в сторе со статусом `isLoading: true`.
  - Открывает подписку `marketStreamService.subscribeTrades(symbol, onTrade, onError)`.
  - Регистрирует функцию отписки `unsubscribe` в реестре активных подписок модуля.
- **Очистка ресурсов (Memory Leak Prevention)**:
  - При размонтировании компонента виджета или вызове `closeWindow(windowId)`:
    1. Выполняется вызов `unsubscribe()` для стрима сделок данного тикера.
    2. Окно удаляется из словаря `windows` стора.

---

## 4. UI Presentation & Styling

### 4.1 Component Decomposition
- `TimeAndSalesWidget` (`src/modules/time-and-sales/ui/time-and-sales-widget.tsx`):
  - Корневой компонент виджета, принимающий `TimeAndSalesWidgetProps`.
  - Инициализирует и очищает окно в сторе через `useEffect`.
  - Отображает `TimeAndSalesHeader` и `TimeAndSalesTable` либо состояния загрузки/ошибки/пустого списка.
- `TimeAndSalesHeader` (`src/modules/time-and-sales/ui/time-and-sales-header.tsx`):
  - Верхняя панель управления:
    - Тикер и название инструмента с кнопкой смены инструмента (`onChangeInstrument`).
    - Селектор емкости буфера (50 / 100 / 250 сделок).
    - Кнопка вызова фильтра объема (`FilterPopover`) с бейджем активного фильтра.
- `TimeAndSalesFilterPopover` (`src/modules/time-and-sales/ui/time-and-sales-filter-popover.tsx`):
  - Выпадающая панель настройки фильтра объема:
    - Кнопки пресетов (`All`, `Small (<10)`, `Medium (10–49)`, `Large (≥50)`).
    - Числовые поля ввода `Min Size` и `Max Size`.
    - Кнопка сброса фильтра к значениям по умолчанию (`Reset`).
- `TimeAndSalesTable` (`src/modules/time-and-sales/ui/time-and-sales-table.tsx`):
  - Таблица ленты сделок с 4 фиксированными столбцами: `Time`, `Price`, `Size`, `Side`.
  - Заголовок таблицы `thead` с семантическими заголовками и выравниванием.
  - Контейнер `tbody` со скроллом и строками `TimeAndSalesRowComponent`.
- `TimeAndSalesRowComponent` (`src/modules/time-and-sales/ui/time-and-sales-row.tsx`):
  - Отдельная строка сделки.
  - Текст цены и стороны окрашивается токенами `--market-buy` или `--market-sell`.
  - При `isLarge: true` строка или ячейка размера помечается акцентной плашкой (полупрозрачная заливка).

### 4.2 Visual Tokens & Themes (`DESIGN.md`, `tokens.css`)
- Контейнер и фон: `var(--surface)`, границы разделения: `var(--border)`.
- Заголовки таблицы и вторичные метки: `var(--text-secondary)`, шрифт `var(--font-ui)`.
- Числовые столбцы (`Time`, `Price`, `Size`): моноширинный шрифт `var(--font-mono)`, табличное выравнивание чисел `tabular-nums`, выравнивание по правому краю.
- Направление покупки (`buy`):
  - Цвет текста цены и стороны: `var(--market-buy)`.
  - Фоновый акцент крупного тика: полупрозрачная плашка на базе `--market-buy` (12–15% opacity).
- Направление продажи (`sell`):
  - Цвет текста цены и стороны: `var(--market-sell)`.
  - Фоновый акцент крупного тика: полупрозрачная плашка на базе `--market-sell` (12–15% opacity).
- Панель фильтра: `var(--surface-raised)`, границы `var(--border)`, активный фильтр/пресет: рамка или маркер `var(--brand-gold)`.
- Поддержка темной и светлой тем ([DESIGN.md](../../../DESIGN.md)): адаптивная работа через CSS-переменные без хардкода hex-значений.

### 4.3 Component States
- **Loading State**: Пока не поступила ни одна сделка, отображается аккуратный индикатор «Waiting for trades stream...».
- **Empty Filter State**: Если поступившие сделки отфильтрованы по текущему диапазону объема, отображается сообщение «No trades matching filter (min: X, max: Y)».
- **Error State**: При сбое подписки выводится понятное сообщение об ошибке с кнопкой повтора подключения.
- **Active / Hover State**: При наведении курсора строка слегка подсвечивается фоном `var(--surface-raised)`.

---

## 5. Black-Box Behavioral Test Scenarios

### 5.1 Store & Pure Logic Tests (`src/modules/time-and-sales/tests/time-and-sales-store.test.ts`)
- **Сценарий 1 (Инициализация и дефолтные значения)**:
  - *Given*: Незарегистрированный `windowId = "win-1"`.
  - *When*: Вызывается `initWindow("win-1", "AAPL")`.
  - *Then*: Создается запись в `windows["win-1"]` с `bufferLimit = 100`, пустыми массивами `trades` и `visibleRows`, `isLoading = true`, фильтром `{ minSize: 0, maxSize: null }`.
- **Сценарий 2 (Поступление сделок и FIFO-вытеснение Top-of-Tape)**:
  - *Given*: Окно с `bufferLimit = 3`.
  - *When*: Последовательно добавляются 4 сделки: T1, T2, T3, T4.
  - *Then*: В `trades` находятся ровно 3 сделки в порядке `[T4, T3, T2]`. Старейшая сделка T1 вытеснена из буфера.
- **Сценарий 3 (Диапазонная фильтрация по размеру)**:
  - *Given*: Окно с накопленными сделками: T1 (size 5), T2 (size 15), T3 (size 50), T4 (size 120).
  - *When*: Вызывается `setSizeFilter("win-1", { minSize: 10, maxSize: 50 })`.
  - *Then*: В `visibleRows` попадают только T2 (15) и T3 (50). T1 (<10) и T4 (>50) отфильтрованы.
- **Сценарий 4 (Динамическое изменение лимита буфера)**:
  - *Given*: Окно с 100 сделками в буфере.
  - *When*: Вызывается `setBufferLimit("win-1", 50)`.
  - *Then*: Массив `trades` и `visibleRows` синхронно усекаются до 50 новейших сделок.
- **Сценарий 5 (Изоляция нескольких окон)**:
  - *Given*: Открыты два окна `win-1` (символ `AAPL`, фильтр `minSize = 50`) и `win-2` (символ `AAPL`, фильтр `minSize = 0`).
  - *When*: В оба окна поступает один и тот же тик с `size = 10`.
  - *Then*: В `win-1` в `visibleRows` пусто, а в `win-2` тик успешно отображается. Мультиоконная изоляция соблюдена.
- **Сценарий 6 (Очистка окна и предотвращение утечек памяти)**:
  - *Given*: Окно `win-1` с активной подпиской.
  - *When*: Вызывается `closeWindow("win-1")`.
  - *Then*: Запись `windows["win-1"]` полностью удаляется из состояния стора.

### 5.2 UI Component & Accessibility Tests (`src/modules/time-and-sales/tests/time-and-sales-widget.test.tsx`)
- **Сценарий 1 (Рендеринг таблицы и колонок)**:
  - *Given*: Инициализированный виджет с 3 сделками.
  - *When*: Виджет отрисовывается в DOM.
  - *Then*: Присутствует элемент `table`, заголовки `Time`, `Price`, `Size`, `Side`, и 3 строки данных.
- **Сценарий 2 (Цветовое кодирование Buy/Sell)**:
  - *Given*: Сделка с `side = "buy"` и сделка с `side = "sell"`.
  - *When*: Строки рендерятся в таблице.
  - *Then*: Ячейка покупки содержит CSS-класс покупки с цветом `var(--market-buy)`, а ячейка продажи — с цветом `var(--market-sell)`.
- **Сценарий 3 (Подсветка крупного объема)**:
  - *Given*: Сделка с объемом 50 лотов (`>= LARGE_TRADE_THRESHOLD`).
  - *When*: Строка рендерится.
  - *Then*: Применяется модификатор крупного тика (акцентный бейдж или подсветка строки).
- **Сценарий 4 (Интерактивная панель фильтрации)**:
  - *Given*: Нажата кнопка вызова фильтра.
  - *When*: Пользователь выбирает пресет «Large (≥50)».
  - *Then*: Стор обновляется со значениями `{ minSize: 50, maxSize: null }`, и мелкие сделки скрываются из таблицы.
- **Сценарий 5 (Кнопка смены инструмента)**:
  - *Given*: Передан колбэк `onChangeInstrument`.
  - *When*: Пользователь нажимает кнопку тикера в шапке.
  - *Then*: Вызывается колбэк `onChangeInstrument()`.

### 5.3 E2E Integration Scenarios (`tests/e2e/time-and-sales.spec.ts`)
- **Сценарий 1 (Потоковое наполнение ленты)**:
  - *Given*: Открыто окно Time & Sales для инструмента `BTC/USD`.
  - *When*: Сервис рыночных данных генерирует поток тиков.
  - *Then*: В таблице появляются новые строки вверху, счетчик обновлений инкрементируется, дрожания интерфейса нет.
- **Сценарий 2 (Проверка фильтрации на живом потоке)**:
  - *Given*: Живой поток сделок разного объема.
  - *When*: Пользователь выставляет фильтр `minSize = 25`.
  - *Then*: В видимой таблице остаются только тики с объемом >= 25.
