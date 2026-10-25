---
name: widget-chart
type: module
status: approved
target_path: src/modules/chart
composition_point: src/composition/widgets.ts
e2e_required: true
---

# Specification: widget-chart

## 1. Purpose & Scope

### 1.1 In-Scope Responsibilities
- Реализация вертикального доменного модуля графика `src/modules/chart/` в архитектуре вертикальных срезов ([ADR-0001](../../../docs/adr/0001-modular-architecture.md)).
- Интеграция высокопроизводительного Canvas-движка **Lightweight Charts (v5)** от TradingView ([ADR-0006](../../../docs/adr/0006-canvas-charting-and-lightweight-charts.md)) для аппаратного рендеринга свечных данных и объемов со стабильными 60 FPS.
- Отображение основных серий данных:
  - Свечной график (Candlestick Series): цены открытия, максимума, минимума и закрытия (OHLC) с разделением растущих (Up / Buy) и падающих (Down / Sell) свечей.
  - Гистограмма торгового объема (Histogram Series): объем торгов в нижней части холста с цветовым кодированием по направлению свечи.
- Интерактивный тулбар управления графиком:
  - Переключение таймфреймов (`1m`, `5m`, `15m`, `1h`, `1d`) с активной индикацией выбранного таймфрейма.
  - Выбор визуального стиля отображения (`candlestick`, `bars`, `line`).
  - Переключение оверлеев и индикаторов (`volume`, расширяемый слот под `sma`/`ema`).
- Информационная панель (Legend / Tooltip): вывод текущих котировок (O, H, L, C, V, дата/время) при наведении перекрестия (crosshair) или для последней свечи.
- Интеграция с потоком рыночных данных ([ADR-0005](../../../docs/adr/0005-market-data-streaming-and-transport-separation.md)):
  - Загрузка начальной истории свечей для отображаемого инструмента и таймфрейма.
  - Подписка на инкрементальные обновления свечей через `defaultMarketStream.subscribeCandles(...)` с автоматической отпиской при смене инструмента, таймфрейма или размонтировании.
- Мульти-оконная изоляция: поддержка одновременного открытия нескольких независимых окон графиков с индивидуальными настройками через Zustand-стор с ключом `windowId`.
- Синхронизация с системой дизайн-токенов ([DESIGN.md](../../../DESIGN.md), [ADR-0003](../../../docs/adr/0003-css-architecture.md)):
  - Реактивная смена цветовой палитры холста (Dark / Light) через `useTheme()` без перезагрузки инстанса графика и потери масштаба.
  - Адаптивный ресайз через `ResizeObserver` при изменении размеров окна терминала.
- Экспорт стандартного дескриптора виджета `chartWidgetDefinition` для точки сборки `src/composition/widgets.ts`.

### 1.2 Non-Goals & Out-of-Scope
- Сложные графические инструменты рисования на холсте (трендовые линии, уровни Фибоначчи, фигуры) — отложено на последующие версии.
- Тяжелые математические расчеты осцилляторов и кастомных индикаторов (выделены в задачу `indicators-engine` Шага 3; в текущей задаче закладывается архитектурный слот и переключатели).
- Прямой ввод торговых ордеров с графика (Buy/Sell клики на ценовой шкале) — относится к торговому модулю (Order Entry).
- Персистентность пользовательских индикаторов в `safeStorage` (раскладка окон управляется модулем `workspace` в Шаге 5).

### 1.3 Architectural Invariants & Best Practices
- **Модульная изоляция ([ADR-0001](../../../docs/adr/0001-modular-architecture.md))**: Все внешние потребители импортируют публичные символы исключительно из `@/src/modules/chart`. Глубокие импорты во внутренние директории (`model/`, `ui/`, `schema.ts`, `constants.ts`, `types.ts`) запрещены.
- **Изоляция виджетов**: Виджет графика не имеет прямых зависимостей от других виджетов (`order-book`, `time-and-sales`) и не зависит от `workspace`.
- **Канонические контракты**: Модуль графика потребляет общие контракты (`WidgetProps`, `WidgetDefinition`, `Candle`, `Timeframe`) из `@/src/shared/contracts`.
- **Canvas-жизненный цикл вне React ([ADR-0006](../../../docs/adr/0006-canvas-charting-and-lightweight-charts.md))**: Экземпляр `IChartApi` создается через `useRef` и управляется императивно. Потоковые обновления котировок передаются методами `series.update()` и `series.setData()` без вызова ре-рендеров React Virtual DOM.
- **Очистка ресурсов (Memory Leak Prevention)**: При размонтировании компонента или смене инструмента/таймфрейма гарантированно вызываются `chart.remove()`, `resizeObserver.disconnect()` и колбэк отписки `unsubscribe()`.
- **Стилизация по дизайн-токенам ([ADR-0003](../../../docs/adr/0003-css-architecture.md), [DESIGN.md](../../../DESIGN.md))**:
  - UI-компоненты используют CSS-модули (`*.module.css`) с лаконичными семантическими селекторами (`.root`, `.toolbar`, `.canvasContainer`).
  - Цвета графика берутся из палитры `CHART_PALETTES`, строго соответствующей дизайн-токенам (`--surface`, `--grid`, `--text-secondary`, `--market-buy`, `--market-sell`, `--brand-gold`).

---

## 2. Public Contract Perimeter

### 2.1 Types (`src/modules/chart/types.ts`)

```typescript
import type { Candle, Timeframe, WidgetDefinition, WidgetProps } from "@/src/shared/contracts";

export type ChartType = "candlestick" | "bars" | "line";

export type ChartIndicatorType = "volume" | "sma" | "ema";

export interface ChartConfig {
  readonly timeframe: Timeframe;
  readonly chartType: ChartType;
  readonly indicators: readonly ChartIndicatorType[];
}

export interface ChartThemeColors {
  readonly background: string;
  readonly textColor: string;
  readonly gridColor: string;
  readonly borderColor: string;
  readonly upColor: string;
  readonly downColor: string;
  readonly volumeUpColor: string;
  readonly volumeDownColor: string;
}

export interface ChartWindowState {
  readonly windowId: string;
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly chartType: ChartType;
  readonly indicators: readonly ChartIndicatorType[];
  readonly candles: readonly Candle[];
  readonly hoveredCandle: Candle | null;
  readonly isLoading: boolean;
  readonly error: string | null;
}

export interface ChartStoreState {
  readonly windows: Readonly<Record<string, ChartWindowState>>;
}

export interface ChartStoreActions {
  readonly initWindow: (windowId: string, symbol: string, initialConfig?: Partial<ChartConfig>) => void;
  readonly setTimeframe: (windowId: string, timeframe: Timeframe) => void;
  readonly setChartType: (windowId: string, chartType: ChartType) => void;
  readonly toggleIndicator: (windowId: string, indicator: ChartIndicatorType) => void;
  readonly setCandles: (windowId: string, candles: readonly Candle[]) => void;
  readonly appendOrUpdateCandle: (windowId: string, candle: Candle) => void;
  readonly setHoveredCandle: (windowId: string, candle: Candle | null) => void;
  readonly setLoading: (windowId: string, isLoading: boolean) => void;
  readonly setError: (windowId: string, error: string | null) => void;
  readonly cleanupWindow: (windowId: string) => void;
}

export type ChartStore = ChartStoreState & ChartStoreActions;

export type ChartWidgetProps = WidgetProps;

export type ChartWidgetDefinition = WidgetDefinition;
```

### 2.2 Validation Schema (`src/modules/chart/schema.ts`)

```typescript
import { z } from "zod";
import { timeframeSchema } from "@/src/shared/contracts";

export const chartTypeSchema = z.enum(["candlestick", "bars", "line"]);

export const chartIndicatorTypeSchema = z.enum(["volume", "sma", "ema"]);

export const chartConfigSchema = z.object({
  timeframe: timeframeSchema,
  chartType: chartTypeSchema,
  indicators: z.array(chartIndicatorTypeSchema),
});
```

### 2.3 Constants (`src/modules/chart/constants.ts`)

```typescript
import type { Theme } from "@/src/shared/theme";
import type { ChartConfig, ChartIndicatorType, ChartThemeColors, ChartType } from "./types";

export const AVAILABLE_CHART_TYPES: readonly ChartType[] = [
  "candlestick",
  "bars",
  "line",
] as const;

export const AVAILABLE_INDICATORS: readonly ChartIndicatorType[] = [
  "volume",
  "sma",
  "ema",
] as const;

export const DEFAULT_CHART_CONFIG: ChartConfig = {
  timeframe: "1m",
  chartType: "candlestick",
  indicators: ["volume"],
} as const;

export const DEFAULT_INITIAL_CANDLE_COUNT = 80;

export const CHART_PALETTES: Record<Theme, ChartThemeColors> = {
  dark: {
    background: "#1a1a1a", // var(--surface)
    textColor: "#bdbdbd", // var(--text-secondary)
    gridColor: "#2b2b2b", // var(--grid)
    borderColor: "#393939", // var(--border)
    upColor: "#61d6ab", // var(--market-buy)
    downColor: "#ff8797", // var(--market-sell)
    volumeUpColor: "rgba(97, 214, 171, 0.35)",
    volumeDownColor: "rgba(255, 135, 151, 0.35)",
  },
  light: {
    background: "#f7f7f7", // var(--surface)
    textColor: "#555555", // var(--text-secondary)
    gridColor: "#e9e9e9", // var(--grid)
    borderColor: "#d8d8d8", // var(--border)
    upColor: "#146c51", // var(--market-buy)
    downColor: "#b33142", // var(--market-sell)
    volumeUpColor: "rgba(20, 108, 81, 0.35)",
    volumeDownColor: "rgba(179, 49, 66, 0.35)",
  },
} as const;
```

### 2.4 Re-exports (`src/modules/chart/index.ts`)

```typescript
// Public seam: ONLY re-exports, no inline implementations
export type {
  ChartConfig,
  ChartIndicatorType,
  ChartStore,
  ChartThemeColors,
  ChartType,
  ChartWidgetDefinition,
  ChartWidgetProps,
  ChartWindowState,
} from "./types";

export { chartConfigSchema, chartIndicatorTypeSchema, chartTypeSchema } from "./schema";

export {
  AVAILABLE_CHART_TYPES,
  AVAILABLE_INDICATORS,
  CHART_PALETTES,
  DEFAULT_CHART_CONFIG,
  DEFAULT_INITIAL_CANDLE_COUNT,
} from "./constants";

export { ChartWidget, chartWidgetDefinition } from "./ui/chart-widget";
```

---

## 3. Core Logic & State Management

### 3.1 State Shape & Actions (`src/modules/chart/model/chart-store.ts`)
- Реализация Zustand-стора `useChartStore` с хранилищем окон по `windowId`:
  - `initWindow(windowId, symbol, config)`: регистрирует начальное состояние окна (таймфрейм `1m`, свечной тип, индикатор `volume`). Если окно уже зарегистрировано с другим символом — очищает свечи и обновляет символ.
  - `setTimeframe(windowId, timeframe)`: обновляет таймфрейм и переводит окно в состояние загрузки для получения новой истории.
  - `setChartType(windowId, chartType)`: переключает режим отображения серий на холсте.
  - `toggleIndicator(windowId, indicator)`: включает или выключает отображение индикатора в списке `indicators`.
  - `setCandles(windowId, candles)`: сохраняет массив исторических свечей и сбрасывает флаг `isLoading`.
  - `appendOrUpdateCandle(windowId, candle)`:
    - Проверяет последнюю свечу в истории: если `candle.time === last.time`, заменяет последнюю свечу (инкрементальное обновление текущей формирующейся свечи).
    - Если `candle.time > last.time`, добавляет новую свечу в конец массива.
    - Игнорирует устаревшие свечи (`candle.time < last.time`).
  - `setHoveredCandle(windowId, candle)`: обновляет свечу под курсором для отображения в легенде (при уходе курсора устанавливается `null`).
  - `setLoading(windowId, isLoading)` / `setError(windowId, error)`: состояние загрузки и ошибок.
  - `cleanupWindow(windowId)`: удаляет запись окна из стора при размонтировании для предотвращения утечек памяти.

### 3.2 Side Effects & Lifecycles (`src/modules/chart/model/use-chart.ts`)
- Хук `useChart({ windowId, symbol, containerRef })`:
  1. **Инициализация Canvas**:
     - Создает экземпляр `createChart(containerRef.current, chartOptions)` с размерами контейнера и палитрой текущей темы.
     - Добавляет `CandlestickSeries` с цветами `upColor` и `downColor`.
     - Добавляет `HistogramSeries` для объемов с привязкой к шкале цен или отдельной области.
  2. **Синхронизация темы**:
     - Получает текущую тему через `useTheme()`.
     - При смене темы вызывает `chart.applyOptions(...)` с соответствующей палитрой из `CHART_PALETTES`.
  3. **Подписка на поток котировок**:
     - Загружает начальную историю свечей (через вспомогательный генератор истории `generateInitialCandles` или сервис данных).
     - Вызывает `defaultMarketStream.subscribeCandles(symbol, handleIncomingCandle, { timeframe })`.
     - При получении свечи вызывает `series.update(...)` и обновляет стор.
  4. **Отслеживание размеров окна (ResizeObserver)**:
     - Создает `ResizeObserver` на `containerRef.current`, обновляя `chart.applyOptions({ width, height })`.
  5. **Обработка событий курсора (Crosshair Move)**:
     - Подписывается на `chart.subscribeCrosshairMove((param) => ...)`, извлекая данные свечи под курсором и передавая их в `setHoveredCandle`.
  6. **Очистка (Cleanup)**:
     - При размонтировании или смене зависимостей вызывает `unsubscribe()`, `resizeObserver.disconnect()`, `chart.remove()` и `cleanupWindow(windowId)`.

---

## 4. UI Presentation & Styling

### 4.1 Component Decomposition
```text
src/modules/chart/ui/
├── chart-widget.tsx           # Корневой контейнер виджета, реализующий WidgetProps
├── chart-widget.module.css    # Flex-раскладка виджета (высота 100%, переполнение hidden)
├── chart-toolbar.tsx          # Верхний тулбар: кнопки таймфреймов, стили графика, индикаторы
├── chart-toolbar.module.css   # Стили тулбара с токенами --surface-raised и --brand-gold
├── chart-legend.tsx           # Панель легенды котировок (O, H, L, C, V, % изменения)
├── chart-legend.module.css    # Полупрозрачный оверлей со шрифтом JetBrains Mono
├── chart-canvas.tsx           # Обертка HTMLDivElement под холст Lightweight Charts
└── chart-canvas.module.css    # Относительное позиционирование, 100% ширина и высота
```

### 4.2 Visual Tokens & Themes (`DESIGN.md`)
- Контейнер виджета: фон `var(--surface)`, рамка `var(--border)`.
- Тулбар управления: фон `var(--surface)`, нижняя граница `1px solid var(--border)`.
  - Кнопки таймфреймов: компактная высота 24px, шрифт `var(--font-ui)`, 12px.
  - Активная кнопка таймфрейма: акцентная рамка или цвет `var(--brand-gold)` с контрастным текстом, без тяжелых заливок ([DESIGN.md](../../../DESIGN.md)).
  - Кнопки индикаторов: нейтральный цвет `var(--text-secondary)`, активный цвет `var(--text-primary)`.
- Легенда: абсолютное позиционирование в верхнем левом углу холста, шрифт `var(--font-mono)`, 11-12px.
  - Положительное изменение (растущая свеча): цвет `var(--market-buy)`.
  - Отрицательное изменение (падающая свеча): цвет `var(--market-sell)`.
- Холст графика:
  - Сетка: `var(--grid)`.
  - Текст шкалы цен и времени: `var(--text-secondary)`.
  - Бычья свеча: заливка и фитиль `var(--market-buy)`.
  - Медвежья свеча: заливка и фитиль `var(--market-sell)`.

### 4.3 Component States
- **Loading State**: при первичной загрузке истории отображается центрированный ненавязчивый индикатор "Loading chart data..." с цветом `var(--text-secondary)` без блокировки интерфейса.
- **Empty / Missing Data**: если по символу отсутствуют котировки, отображается состояние "No market data available for [SYMBOL]".
- **Error State**: при сбое соединения отображается информационное сообщение об ошибке с возможностью повтора.
- **Active / Focused State**: при клике на окно графика рамка окна терминала подсвечивается тонкой акцентной линией `var(--brand-gold)`.

---

## 5. Black-Box Behavioral Test Scenarios

> [!NOTE]
> Тесты импортируют функционал исключительно из публичного шва `@/src/modules/chart` (или `../index`).
> Применяются инварианты Anti-Tautology: фокус на бизнес-логике переключения состояний, расчетах данных, подписках и обработке границ.

### Scenario 1: Initial Mount & Default Configuration
- **Given:** Инициализируется виджет графика `ChartWidget` с `windowId="win-1"` и инструментом `{ symbol: "AAPL", name: "Apple Inc." }`.
- **When:** Виджет монтируется в DOM.
- **Then:**
  - В DOM отображается тулбар с таймфреймами, кнопка `1m` активна по умолчанию.
  - В DOM присутствует контейнер холста графика.
  - В сторе создается состояние окна `win-1` с символом `"AAPL"`, таймфреймом `"1m"` и включенным индикатором `"volume"`.

### Scenario 2: Timeframe Switching & Stream Resubscription
- **Given:** Смонтирован виджет графика `win-1` на таймфрейме `1m`.
- **When:** Пользователь кликает по кнопке таймфрейма `5m` в тулбаре.
- **Then:**
  - Активной становится кнопка `5m`.
  - В сторе таймфрейм окна обновляется на `"5m"`.
  - Предыдущая подписка отменяется, и вызывается новая подписка на свечи с параметром `{ timeframe: "5m" }`.

### Scenario 3: Real-Time Candle Stream Append & In-Bar Update
- **Given:** Окно графика имеет последнюю историческую свечу с `time: 1700000000, close: 150`.
- **When:**
  1. Поступает обновление свечи с тем же временем `time: 1700000000, close: 151`.
  2. Следом поступает новая свеча с `time: 1700000060, close: 152`.
- **Then:**
  1. Количество свечей не увеличивается; последняя свеча обновляется новым значением закрытия `151`.
  2. Количество свечей увеличивается на 1; новая свеча добавляется в конец массива.

### Scenario 4: Dynamic Theme Switching
- **Given:** Виджет графика отрендерен в темной теме (`theme = "dark"`).
- **When:** Тема терминала переключается на светлую (`theme = "light"`).
- **Then:**
  - Вызывается метод обновления настроек графика `applyOptions` с цветами светлой темы из `CHART_PALETTES.light` (`background: "#f7f7f7"`, `upColor: "#146c51"`).
  - Инстанс холста не пересоздается заново, сохраняя текущий сдвиг и масштаб.

### Scenario 5: Multi-Window State Isolation
- **Given:** Открыты два окна графиков: `win-1` с символом `"AAPL"` и `win-2` с символом `"BTC/USD"`.
- **When:** В окне `win-1` пользователь переключает таймфрейм на `"1h"`.
- **Then:**
  - Окно `win-1` имеет таймфрейм `"1h"`.
  - Окно `win-2` сохраняет свой исходный таймфрейм `"1m"`.

### Scenario 6: Teardown & Resource Cleanup on Unmount
- **Given:** Смонтирован виджет графика с активной подпиской на свечи и наблюдателем `ResizeObserver`.
- **When:** Компонент виджета размонтируется (окно закрыто).
- **Then:**
  - Вызывается отписка от сервиса рыночных данных.
  - Вызывается `disconnect()` у `ResizeObserver`.
  - Вызывается метод `remove()` у инстанса графика Lightweight Charts.
  - Запись окна `win-1` удаляется из стора `chart-store`.

---

## 6. Wiring & Integration

### 6.1 Composition Point
- **Целевой файл**: `src/composition/widgets.ts`.
- **Регистрация**:
  ```typescript
  import { chartWidgetDefinition } from "@/src/modules/chart";
  import type { WidgetDefinition } from "@/src/shared/contracts";

  export const WIDGET_REGISTRY: readonly WidgetDefinition[] = [
    chartWidgetDefinition,
    // orderBookWidgetDefinition,
    // timeAndSalesWidgetDefinition,
  ];
  ```

### 6.2 E2E Integration Test Requirement
- **Playwright E2E**: `true`.
- **Тестовый файл**: `tests/e2e/widget-chart.spec.ts`.
- **Сценарий E2E**:
  - Открытие тестовой страницы с виджетом `ChartWidget`.
  - Проверка наличия отрисованного элемента `<canvas>` внутри контейнера графика.
  - Клик по кнопкам таймфрейма (`5m`, `1h`) и проверка смены активного класса.
  - Проверка переключения темы оформления и адаптивности канваса при изменении размеров экрана.
