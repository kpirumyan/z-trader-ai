---
name: indicators-engine
type: module
status: approved
target_path: src/modules/indicators
composition_point: none
e2e_required: false
---

# Specification: indicators-engine

## 1. Purpose & Scope

### 1.1 In-Scope Responsibilities
- Реализация независимого алгоритмического модуля технических индикаторов `src/modules/indicators/` в архитектуре вертикальных доменных срезов ([ADR-0001](../../../docs/adr/0001-modular-architecture.md)).
- Детерминированные чистые математические функции расчёта скользящих средних поверх исторических свечей (`Candle[]`) из `@/src/shared/contracts`:
  - **SMA (Simple Moving Average)**: простое скользящее среднее с поддержкой произвольного периода и источника цены (`close`, `open`, `high`, `low`, `hl2`, `hlc3`, `ohlc4`).
  - **EMA (Exponential Moving Average)**: экспоненциальное скользящее среднее со сглаживающим коэффициентом $\alpha = 2 / (period + 1)$ и корректной инициализацией начального значения первым SMA-окном.
- Формирование типизированных точек временного ряда `IndicatorPoint` (`{ readonly time: number; readonly value: number }`), напрямую готовых к передаче в Canvas-движок Lightweight Charts (`ISeriesApi<"Line">.setData()`) ([ADR-0006](../../../docs/adr/0006-canvas-charting-and-lightweight-charts.md)).
- Каталог метаданных индикаторов (`INDICATOR_DEFINITIONS`): декларативный реестр доступных индикаторов с идентификаторами, названиями, краткими обозначениями, типом наложения (`overlay` поверх основного графика цен vs `pane` в отдельной нижней панели) и параметрами по умолчанию для автогенерации интерфейса меню в виджете графика (`src/modules/chart/`).
- Zod-схемы валидации конфигурационных параметров индикаторов (`smaConfigSchema`, `emaConfigSchema`, `indicatorConfigSchema`) с защитой от некорректных значений (период $\le 0$, дробные периоды, недопустимые источники цены).
- Безопасное детерминированное поведение при граничных условиях: при длине истории меньше периода индикатора (`candles.length < period`) или недопустимом периоде функции возвращают пустой массив `[]` без артефактов и падений.

### 1.2 Non-Goals & Out-of-Scope
- Сложные составные осцилляторы и каналы волатильности (RSI, MACD, Bollinger Bands, ATR, VWAP) — отложены на следующие итерации; модуль закладывает строгие контракты и структуру директорий для их бесшовного добавления.
- Отрисовка графиков, DOM-элементы, React-хуки, React-компоненты и стили (модуль является строго non-visual вычислительным ядром).
- Хранение состояния (Zustand, Redux, local state) — модуль полностью stateless и состоит из чистых функций.
- Управление подписками на WebSocket и стриминг котировок (делегировано `src/modules/market-data` и `src/modules/chart`).
- Хранение пользовательских настроек индикаторов в `safeStorage` (делегировано стору графика и оконному менеджеру `src/modules/workspace`).

### 1.3 Architectural Invariants & Best Practices
- **Модульная изоляция ([ADR-0001](../../../docs/adr/0001-modular-architecture.md))**: Все внешние потребители (виджет графика, тесты) импортируют публичные символы строго из шва `@/src/modules/indicators`. Прямые импорты во внутренние файлы (`model/`, `schema.ts`, `constants.ts`, `types.ts`) запрещены правилами `dependency-cruiser` и ESLint Boundaries.
- **Однонаправленная зависимость от фундаментов ([ADR-0001](../../../docs/adr/0001-modular-architecture.md))**: Модуль зависит исключительно от разделяемых контрактов (`Candle`) из `@/src/shared/contracts` и внешней библиотеки `zod`. Зависимости от `app/`, `src/composition/` или других доменных модулей строго запрещены.
- **Чистая функциональная парадигма**: Функции вычисления являются чистыми и детерминированными:
  - Не модифицируют входные массивы (иммутабельность `readonly Candle[]`).
  - Не создают побочных эффектов (side-effect free).
  - Работают за линейное время $O(N)$ с использованием скользящего окна суммирования.
- **Совместимость с Lightweight Charts ([ADR-0006](../../../docs/adr/0006-canvas-charting-and-lightweight-charts.md))**: Временные метки `time` в `IndicatorPoint` строго соответствуют меткам свечей (Unix timestamp в секундах). Точки возвращаются в строгом хронологическом порядке без пропусков или значений `NaN`/`null`.

---

## 2. Public Contract Perimeter

### 2.1 Types (`src/modules/indicators/types.ts`)

```typescript
import type { Candle } from "@/src/shared/contracts";

export type IndicatorType = "sma" | "ema";

export type IndicatorSourceKey =
  | "close"
  | "open"
  | "high"
  | "low"
  | "hl2"
  | "hlc3"
  | "ohlc4";

export type IndicatorOverlayType = "overlay" | "pane";

export interface IndicatorPoint {
  readonly time: number;
  readonly value: number;
}

export interface SmaConfig {
  readonly period: number;
  readonly source: IndicatorSourceKey;
}

export interface EmaConfig {
  readonly period: number;
  readonly source: IndicatorSourceKey;
}

export type IndicatorConfig = SmaConfig | EmaConfig;

export interface IndicatorDefinition {
  readonly id: IndicatorType;
  readonly name: string;
  readonly shortName: string;
  readonly description: string;
  readonly overlayType: IndicatorOverlayType;
  readonly defaultPeriod: number;
  readonly defaultSource: IndicatorSourceKey;
}

export type IndicatorCalculateFn = (
  candles: readonly Candle[],
  config?: Partial<IndicatorConfig>
) => readonly IndicatorPoint[];
```

### 2.2 Validation Schema (`src/modules/indicators/schema.ts`)

```typescript
import { z } from "zod";

export const indicatorTypeSchema = z.enum(["sma", "ema"]);

export const indicatorSourceKeySchema = z.enum([
  "close",
  "open",
  "high",
  "low",
  "hl2",
  "hlc3",
  "ohlc4",
]);

export const indicatorOverlayTypeSchema = z.enum(["overlay", "pane"]);

export const indicatorPointSchema = z.object({
  time: z.number(),
  value: z.number(),
});

export const smaConfigSchema = z.object({
  period: z.number().int().min(1).default(20),
  source: indicatorSourceKeySchema.default("close"),
});

export const emaConfigSchema = z.object({
  period: z.number().int().min(1).default(20),
  source: indicatorSourceKeySchema.default("close"),
});

export const indicatorConfigSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("sma"),
    period: z.number().int().min(1).default(20),
    source: indicatorSourceKeySchema.default("close"),
  }),
  z.object({
    type: z.literal("ema"),
    period: z.number().int().min(1).default(20),
    source: indicatorSourceKeySchema.default("close"),
  }),
]);
```

### 2.3 Constants (`src/modules/indicators/constants.ts`)

```typescript
import type {
  EmaConfig,
  IndicatorDefinition,
  IndicatorType,
  SmaConfig,
} from "./types";

export const DEFAULT_SMA_CONFIG: Readonly<SmaConfig> = {
  period: 20,
  source: "close",
} as const;

export const DEFAULT_EMA_CONFIG: Readonly<EmaConfig> = {
  period: 20,
  source: "close",
} as const;

export const INDICATOR_DEFINITIONS: readonly IndicatorDefinition[] = [
  {
    id: "sma",
    name: "Simple Moving Average",
    shortName: "SMA",
    description: "Arithmetic mean of prices over a specified rolling window",
    overlayType: "overlay",
    defaultPeriod: 20,
    defaultSource: "close",
  },
  {
    id: "ema",
    name: "Exponential Moving Average",
    shortName: "EMA",
    description: "Exponentially weighted moving average giving higher weight to recent prices",
    overlayType: "overlay",
    defaultPeriod: 20,
    defaultSource: "close",
  },
] as const;

export const AVAILABLE_INDICATOR_TYPES: readonly IndicatorType[] = [
  "sma",
  "ema",
] as const;
```

### 2.4 Re-exports (`src/modules/indicators/index.ts`)

```typescript
export type {
  EmaConfig,
  IndicatorCalculateFn,
  IndicatorConfig,
  IndicatorDefinition,
  IndicatorOverlayType,
  IndicatorPoint,
  IndicatorSourceKey,
  IndicatorType,
  SmaConfig,
} from "./types";

export {
  emaConfigSchema,
  indicatorConfigSchema,
  indicatorOverlayTypeSchema,
  indicatorPointSchema,
  indicatorSourceKeySchema,
  indicatorTypeSchema,
  smaConfigSchema,
} from "./schema";

export {
  AVAILABLE_INDICATOR_TYPES,
  DEFAULT_EMA_CONFIG,
  DEFAULT_SMA_CONFIG,
  INDICATOR_DEFINITIONS,
} from "./constants";

export { calculateSma } from "./model/sma";
export { calculateEma } from "./model/ema";
```

---

## 3. Core Logic & Mathematical Algorithms

### 3.1 Price Source Extraction
- Вспомогательная функция извлечения числовой цены из свечи `extractPrice(candle: Candle, source: IndicatorSourceKey): number`:
  - `"close"`: `candle.close`
  - `"open"`: `candle.open`
  - `"high"`: `candle.high`
  - `"low"`: `candle.low`
  - `"hl2"`: `(candle.high + candle.low) / 2`
  - `"hlc3"`: `(candle.high + candle.low + candle.close) / 3`
  - `"ohlc4"`: `(candle.open + candle.high + candle.low + candle.close) / 4`

### 3.2 Simple Moving Average (SMA) Algorithm (`src/modules/indicators/model/sma.ts`)
- **Сигнатура**: `calculateSma(candles: readonly Candle[], config?: Partial<SmaConfig>): readonly IndicatorPoint[]`
- **Логика работы**:
  1. Нормализация конфигурации: объединение переданных параметров с `DEFAULT_SMA_CONFIG`. Если `period < 1` или `candles.length < period`, возвращается пустой массив `[]`.
  2. Первое окно: вычисляется сумма первых `period` цен (индексы от `0` до `period - 1`). Первое значение SMA формируется на индексе `period - 1` с временной меткой `candles[period - 1].time` и значением `sum / period`.
  3. Скользящее окно $O(N)$: для каждого последующего индекса $i$ от `period` до `candles.length - 1`:
     $$\text{sum} = \text{sum} - \text{price}_{i - \text{period}} + \text{price}_i$$
     $$\text{SMA}_i = \text{sum} / \text{period}$$
     В массив результатов добавляется `{ time: candles[i].time, value: roundTo(SMA_i, 6) }` (или точное значение без округления).
  4. Длина возвращаемого массива строго равна `candles.length - period + 1`.

### 3.3 Exponential Moving Average (EMA) Algorithm (`src/modules/indicators/model/ema.ts`)
- **Сигнатура**: `calculateEma(candles: readonly Candle[], config?: Partial<EmaConfig>): readonly IndicatorPoint[]`
- **Логика работы**:
  1. Нормализация конфигурации: объединение параметров с `DEFAULT_EMA_CONFIG`. Если `period < 1` или `candles.length < period`, возвращается пустой массив `[]`.
  2. Расчёт весового множителя (smoothing multiplier):
     $$k = \frac{2}{\text{period} + 1}$$
  3. Инициализация (Seed SMA): первое значение EMA на индексе `period - 1` рассчитывается как простое среднее первых `period` значений:
     $$\text{EMA}_{\text{period} - 1} = \frac{1}{\text{period}} \sum_{j=0}^{\text{period} - 1} \text{price}_j$$
     Точка `{ time: candles[period - 1].time, value: EMA_{period - 1} }` сохраняется в массив.
  4. Рекурсивное взвешивание $O(N)$: для каждого последующего индекса $i$ от `period` до `candles.length - 1`:
     $$\text{EMA}_i = (\text{price}_i - \text{EMA}_{i - 1}) \times k + \text{EMA}_{i - 1} = \text{price}_i \times k + \text{EMA}_{i - 1} \times (1 - k)$$
     Точка `{ time: candles[i].time, value: EMA_i }` добавляется в массив.
  5. Длина возвращаемого массива строго равна `candles.length - period + 1`.

### 3.4 Side Effects & Lifecycles
- `N/A: Stateless module`. В модуле отсутствуют подписки, таймеры, сетевые вызовы и мутации глобального состояния. Размонтирование и очистка не требуются.

---

## 4. UI Presentation & Styling

`N/A: Non-visual target`. Модуль `indicators-engine` не содержит визуальных компонентов, CSS-модулей или разметки. Визуализация линий индикаторов и меню выбора реализуются в `src/modules/chart/` в рамках Шага 4.

---

## 5. Black-Box Behavioral Test Scenarios

> [!NOTE]
> Все тесты импортируют функционал исключительно через публичный шов `@/src/modules/indicators` (или `../index`), подтверждая отсутствие несанкционированных прямых зависимостей.
> Применяются инварианты Anti-Tautology: тесты проверяют математическую точность расчётов, краевые случаи, обработку различных источников цен и соответствие временных меток.

### Scenario 1: SMA standard mathematical calculation
- **Given:** Массив из 5 свечей с метками времени `1000..5000` и ценами закрытия `[10, 20, 30, 40, 50]`.
- **When:** Вызывается `calculateSma(candles, { period: 3, source: "close" })`.
- **Then:**
  - Возвращается ровно 3 точки (`5 - 3 + 1 = 3`).
  - Первая точка имеет `time: 3000` и `value: 20` (`(10 + 20 + 30) / 3`).
  - Вторая точка имеет `time: 4000` и `value: 30` (`(20 + 30 + 40) / 3`).
  - Третья точка имеет `time: 5000` и `value: 40` (`(30 + 40 + 50) / 3`).

### Scenario 2: SMA edge cases & boundary conditions
- **Given:** Различные граничные наборы данных:
  - Пустой массив свечей `[]`.
  - Массив из 3 свечей при запрошенном периоде `period: 5`.
  - Период `period: 0` или `period: -1`.
- **When:** Вызывается `calculateSma` для каждого случая.
- **Then:**
  - Во всех случаях возвращается пустой массив `[]` без выброса исключений и без артефактов `NaN`.

### Scenario 3: SMA with custom price sources
- **Given:** Массив свечей со специфическими значениями `open`, `high`, `low`, `close` (например, `high: 110, low: 90` дает `hl2: 100`).
- **When:** Вызывается `calculateSma(candles, { period: 2, source: "hl2" })`.
- **Then:** Значения скользящей средней вычисляются строго по среднему арифметическому `(high + low) / 2`, а не по цене `close`.

### Scenario 4: EMA standard mathematical calculation and seed initialization
- **Given:** Массив из 4 свечей с метками времени `100..400` и ценами закрытия `[2, 4, 6, 8]`.
- **When:** Вызывается `calculateEma(candles, { period: 3, source: "close" })`.
- **Then:**
  - Множитель $k = 2 / (3 + 1) = 0.5$.
  - Первое значение на индексе 2 (`time: 300`) равно начальному SMA: `(2 + 4 + 6) / 3 = 4`.
  - Второе значение на индексе 3 (`time: 400`) вычисляется как: `8 * 0.5 + 4 * (1 - 0.5) = 4 + 2 = 6`.
  - Длина возвращаемого массива равна 2.

### Scenario 5: EMA boundary conditions
- **Given:** Массив свечей длиной меньше периода (`candles.length < period`) или недопустимый период (`period <= 0`).
- **When:** Вызывается `calculateEma`.
- **Then:** Возвращается пустой массив `[]`.

### Scenario 6: Indicator definitions catalog integrity
- **Given:** Константа `INDICATOR_DEFINITIONS` из публичного шва.
- **When:** Инспектируется состав реестра определений.
- **Then:**
  - Содержит описания для обоих индикаторов `"sma"` и `"ema"`.
  - Для каждого индикатора указаны валидные `id`, `name`, `shortName`, `description`.
  - `overlayType` для обоих равен `"overlay"`.
  - `defaultPeriod` является положительным целым числом (`20`).
  - `defaultSource` равен `"close"`.

### Scenario 7: Schema validation for configurations
- **Given:** Zod-схемы `smaConfigSchema`, `emaConfigSchema` и `indicatorConfigSchema`.
- **When:** Валидируются различные входные объекты конфигураций:
  - Пустой объект `{}`: успешно парсится с применением дефолтных значений (`period: 20, source: "close"`).
  - Валидный объект `{ period: 50, source: "open" }`: успешно парсится с сохранением переданных параметров.
  - Невалидный объект `{ period: -5 }` или `{ period: 0 }`: выбрасывает ошибку валидации Zod.
  - Невалидный источник цены `{ source: "invalid" }`: выбрасывает ошибку валидации Zod.

---

## 6. Wiring & Integration

### 6.1 Composition Point
- **Целевая точка**: `none`.
- Алгоритмический модуль не требует регистрации в провайдерах или реестре виджетов `src/composition/widgets.ts`.
- Модули графиков (`src/modules/chart/model/chart-store.ts` или кастомные хуки) импортируют функции вычисления и константы напрямую из `@/src/modules/indicators`.

### 6.2 E2E Integration Test Requirement
- **Playwright E2E required:** `false`.
- Модуль является вычислительным ядром без UI-элементов и сетевых взаимодействий. Полнота и надежность на 100% гарантируются модульными тестами Vitest (`src/modules/indicators/tests/indicators.test.ts`).
