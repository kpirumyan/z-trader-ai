---
name: nrd-csv-parser
type: module
status: draft
target_path: src/modules/market-data
composition_point: none
e2e_required: false
---

# Specification: nrd-csv-parser

## 1. Purpose & Scope

- **Goal**: Provide a high-throughput, zero-Zod-overhead procedural parser that translates NinjaTrader 8 semicolon-delimited `L1;` (trades, quotes, daily stats) and `L2;` (order book depth) CSV lines into strongly typed discriminated union records (`NrdL1Record | NrdL2Record`).
- **Boundaries**:
  - In-scope: Single-line parsing (`parseNrdLine`), batch parsing (`parseNrdLines`), timestamp conversion from `YYYYMMDDhhmmss` + `100ns` offset to exact UTC Unix milliseconds, locale-safe decimal normalization (both `,` and `.`), enum-to-semantic string mapping, and fail-safe malformed line handling.
  - Out-of-scope: File system streaming or disk discovery (delegated to `nrd-file-reader`), trade classification or candle/book aggregation (delegated to `nrd-state-reconstructor`), and UI presentation or WebSocket streaming.
- **Applicable ADRs**:
  - [ADR-0007](../../docs/adr/0007-ninjatrader-cme-market-data.md): CME Futures Market Data via NinjaTrader 8 (Workflow A: Offline Local Files).
- **Allowed Dependencies**:
  - Shared contracts: `@/src/shared/contracts` (standard market types).
  - Runtime validation: `zod` (for public contract boundary schemas in `schema.ts`).
  - No external parser libraries or heavy runtime dependencies.

---

## 2. Public Contract Perimeter

### 2.1 Types (`src/modules/market-data/types.ts`)

```typescript
export type NrdRecordType = "L1" | "L2";

export type NrdL1MarketDataType =
  | "ask"
  | "bid"
  | "last"
  | "dailyHigh"
  | "dailyLow"
  | "dailyVolume"
  | "lastClose"
  | "opening"
  | "openInterest"
  | "settlement"
  | "unknown";

export type NrdL2Operation = "add" | "update" | "remove";

export interface NrdL1Record {
  readonly recordType: "L1";
  readonly marketDataType: NrdL1MarketDataType;
  readonly rawMarketDataType: number;
  readonly time: number; // Unix timestamp in milliseconds (UTC)
  readonly offset100ns: number; // Raw 100-nanosecond offset within second
  readonly price: number;
  readonly volume: number;
}

export interface NrdL2Record {
  readonly recordType: "L2";
  readonly marketDataType: "ask" | "bid";
  readonly rawMarketDataType: number;
  readonly time: number; // Unix timestamp in milliseconds (UTC)
  readonly offset100ns: number; // Raw 100-nanosecond offset within second
  readonly operation: NrdL2Operation;
  readonly rawOperation: number;
  readonly position: number; // 0-indexed ladder depth tier
  readonly marketMaker: string;
  readonly price: number;
  readonly volume: number;
}

export type NrdRecord = NrdL1Record | NrdL2Record;

export interface NrdParseError {
  readonly line: string;
  readonly reason: string;
  readonly lineNumber?: number;
}

export interface NrdParseOptions {
  readonly onError?: (error: NrdParseError) => void;
  readonly lineNumber?: number;
}

export interface NrdBatchOptions extends NrdParseOptions {
  readonly collectErrors?: boolean;
}

export interface NrdBatchParseResult {
  readonly records: readonly NrdRecord[];
  readonly errors: readonly NrdParseError[];
}
```

### 2.2 Validation Schema (`src/modules/market-data/schema.ts`)

```typescript
import { z } from "zod";

export const nrdRecordTypeSchema = z.enum(["L1", "L2"]);

export const nrdL1MarketDataTypeSchema = z.enum([
  "ask",
  "bid",
  "last",
  "dailyHigh",
  "dailyLow",
  "dailyVolume",
  "lastClose",
  "opening",
  "openInterest",
  "settlement",
  "unknown",
]);

export const nrdL2OperationSchema = z.enum(["add", "update", "remove"]);

export const nrdL1RecordSchema = z.object({
  recordType: z.literal("L1"),
  marketDataType: nrdL1MarketDataTypeSchema,
  rawMarketDataType: z.number().int().nonnegative(),
  time: z.number().int().nonnegative(),
  offset100ns: z.number().int().nonnegative(),
  price: z.number().finite(),
  volume: z.number().finite().nonnegative(),
});

export const nrdL2RecordSchema = z.object({
  recordType: z.literal("L2"),
  marketDataType: z.enum(["ask", "bid"]),
  rawMarketDataType: z.number().int().nonnegative(),
  time: z.number().int().nonnegative(),
  offset100ns: z.number().int().nonnegative(),
  operation: nrdL2OperationSchema,
  rawOperation: z.number().int().nonnegative(),
  position: z.number().int().nonnegative(),
  marketMaker: z.string(),
  price: z.number().finite(),
  volume: z.number().finite().nonnegative(),
});

export const nrdRecordSchema = z.discriminatedUnion("recordType", [
  nrdL1RecordSchema,
  nrdL2RecordSchema,
]);
```

### 2.3 Constants (`src/modules/market-data/constants.ts`)

```typescript
import type { NrdL1MarketDataType, NrdL2Operation } from "./types";

export const NRD_DELIMITER = ";";

export const NRD_L1_FIELD_COUNT = 6;
export const NRD_L2_FIELD_COUNT = 9;

export const NRD_TICKS_PER_MILLISECOND = 10000; // 10,000 * 100ns = 1ms

export const NRD_L1_MARKET_DATA_TYPE_MAP: Readonly<Record<number, NrdL1MarketDataType>> = {
  0: "ask",
  1: "bid",
  2: "last",
  3: "dailyHigh",
  4: "dailyLow",
  5: "dailyVolume",
  6: "lastClose",
  7: "opening",
  8: "openInterest",
  9: "settlement",
  10: "unknown",
} as const;

export const NRD_L2_OPERATION_MAP: Readonly<Record<number, NrdL2Operation>> = {
  0: "add",
  1: "update",
  2: "remove",
} as const;
```

### 2.4 Public Seam & Exports (`src/modules/market-data/index.ts`)

```typescript
export type {
  NrdBatchOptions,
  NrdBatchParseResult,
  NrdL1MarketDataType,
  NrdL1Record,
  NrdL2Operation,
  NrdL2Record,
  NrdParseError,
  NrdParseOptions,
  NrdRecord,
  NrdRecordType,
} from "./types";

export {
  NRD_DELIMITER,
  NRD_L1_FIELD_COUNT,
  NRD_L1_MARKET_DATA_TYPE_MAP,
  NRD_L2_FIELD_COUNT,
  NRD_L2_OPERATION_MAP,
  NRD_TICKS_PER_MILLISECOND,
} from "./constants";

export {
  nrdL1MarketDataTypeSchema,
  nrdL1RecordSchema,
  nrdL2OperationSchema,
  nrdL2RecordSchema,
  nrdRecordSchema,
  nrdRecordTypeSchema,
} from "./schema";

export declare function parseNrdLine(
  line: string,
  options?: NrdParseOptions,
): NrdRecord | null;

export declare function parseNrdLines(
  text: string,
  options: NrdBatchOptions & { collectErrors: true },
): NrdBatchParseResult;

export declare function parseNrdLines(
  text: string,
  options?: NrdBatchOptions,
): readonly NrdRecord[];
```

---

## 3. Core Logic & Implementation Invariants

### 3.1 Field Splitting & High-Throughput Tokenization
- The parser splits rows using `NRD_DELIMITER` (`;`).
- Empty rows, whitespace-only rows, or comment rows (beginning with `#` or `//`) are safely skipped, returning `null`.
- Field counts must match `NRD_L1_FIELD_COUNT` (6) for `L1` or `NRD_L2_FIELD_COUNT` (9) for `L2`. Any row with an unexpected field count triggers `onError` (if provided) and returns `null`.

### 3.2 Timestamp Conversion & Ordering Preservation
- The timestamp string is expected in `YYYYMMDDhhmmss` format (exactly 14 characters).
- Parsed components:
  - Year: `parseInt(raw.slice(0, 4), 10)`
  - Month: `parseInt(raw.slice(4, 6), 10) - 1` (0-indexed for `Date.UTC`)
  - Day: `parseInt(raw.slice(6, 8), 10)`
  - Hour: `parseInt(raw.slice(8, 10), 10)`
  - Minute: `parseInt(raw.slice(10, 12), 10)`
  - Second: `parseInt(raw.slice(12, 14), 10)`
- UTC base milliseconds: `Date.UTC(year, month, day, hour, minute, second)`.
- Offset calculation: `Math.floor(offset100ns / NRD_TICKS_PER_MILLISECOND)`.
- Final `time`: `baseMs + offsetMs`.
- The raw `offset100ns` integer is retained on the record so downstream reconstructors can sort intra-millisecond updates deterministically.

### 3.3 Locale-Safe Decimal Normalization
- Price and volume strings may feature `,` (European/Russian Windows locale) or `.` (US locale), and may have trailing dots (e.g. `1.`).
- Conversion normalizes `,` to `.`, trims whitespace, and parses via `Number()`.
- Rows with `NaN` or non-finite values are rejected as malformed.

### 3.4 Error Handling & Fault Isolation
- When a row fails validation, an `NrdParseError` object is created with `{ line, reason, lineNumber }`.
- In `parseNrdLine`, the error is passed to `options?.onError` and `null` is returned without throwing unhandled exceptions.
- In `parseNrdLines`, invalid rows are skipped by default. If `collectErrors: true` is set, errors are accumulated into the `errors` array of `NrdBatchParseResult`.

---

## 4. UI Presentation & Styling

`N/A: Non-visual target` (Domain parsing utility located in `src/modules/market-data`).

---

## 5. Black-Box Behavioral Test Scenarios

### SC-01: Parse standard L1 trade row (`marketDataType: 2`)
- **Given:** Raw CSV line `"L1;2;20210120050050;2300000;1855.8;2"`.
- **When:** Caller invokes `parseNrdLine(line)`.
- **Then:** Returns `NrdL1Record` with `recordType: "L1"`, `marketDataType: "last"`, `rawMarketDataType: 2`, `time: 1611118850230`, `offset100ns: 2300000`, `price: 1855.8`, `volume: 2`.

### SC-02: Parse standard L1 quote rows (`0` Ask and `1` Bid)
- **Given:** Raw CSV line `"L1;0;20210120050050;1000000;1856.0;5"`.
- **When:** Caller invokes `parseNrdLine(line)`.
- **Then:** Returns `NrdL1Record` with `marketDataType: "ask"`, `price: 1856.0`, `volume: 5`.
- **Given:** Raw CSV line `"L1;1;20210120050050;1000000;1855.75;10"`.
- **When:** Caller invokes `parseNrdLine(line)`.
- **Then:** Returns `NrdL1Record` with `marketDataType: "bid"`, `price: 1855.75`, `volume: 10`.

### SC-03: Parse L2 order book depth rows (`Add`, `Update`, `Remove`)
- **Given:** Raw CSV line `"L2;0;20210120050000;70000;0;0;;1855.5;1"`.
- **When:** Caller invokes `parseNrdLine(line)`.
- **Then:** Returns `NrdL2Record` with `recordType: "L2"`, `marketDataType: "ask"`, `operation: "add"`, `position: 0`, `marketMaker: ""`, `price: 1855.5`, `volume: 1`, `time: 1611118800007`.
- **Given:** Raw CSV line `"L2;1;20210120050000;80000;1;2;MM01;1854.25;8"`.
- **When:** Caller invokes `parseNrdLine(line)`.
- **Then:** Returns `NrdL2Record` with `marketDataType: "bid"`, `operation: "update"`, `position: 2`, `marketMaker: "MM01"`, `price: 1854.25`, `volume: 8`.
- **Given:** Raw CSV line `"L2;0;20210120050000;90000;2;1;;1855.75;0"`.
- **When:** Caller invokes `parseNrdLine(line)`.
- **Then:** Returns `NrdL2Record` with `operation: "remove"`, `position: 1`, `price: 1855.75`, `volume: 0`.

### SC-04: Parse European comma decimals and trailing dot formatting
- **Given:** Raw CSV line `"L1;2;20210120050050;0;1855,75;10."`.
- **When:** Caller invokes `parseNrdLine(line)`.
- **Then:** Returns `NrdL1Record` with `price: 1855.75` and `volume: 10`.

### SC-05: Reject malformed row with insufficient semicolon columns
- **Given:** Incomplete row `"L1;2;20210120050050;1855.8"`.
- **When:** Caller invokes `parseNrdLine(line)`.
- **Then:** Returns `null`.

### SC-06: Reject row with invalid or truncated timestamp
- **Given:** Corrupt row `"L1;2;202101;2300000;1855.8;2"`.
- **When:** Caller invokes `parseNrdLine(line)`.
- **Then:** Returns `null`.

### SC-07: Reject row with non-numeric price or volume
- **Given:** Invalid numeric row `"L1;2;20210120050050;2300000;INVALID_PRICE;2"`.
- **When:** Caller invokes `parseNrdLine(line)`.
- **Then:** Returns `null`.

### SC-08: Execute optional onError callback on malformed row
- **Given:** Malformed line `"INVALID_RECORD_FORMAT"` and an `onError` spy function passed in `options`.
- **When:** Caller invokes `parseNrdLine(line, { onError, lineNumber: 42 })`.
- **Then:** Returns `null` and invokes `onError` with `NrdParseError` having `lineNumber: 42`, `line: "INVALID_RECORD_FORMAT"`, and a descriptive `reason`.

### SC-09: Batch parse multiline text skipping comments and blank lines
- **Given:** Multiline string containing a comment line (`"# NinjaTrader Export"`), empty lines, an L1 trade, and an L2 depth update.
- **When:** Caller invokes `parseNrdLines(text)`.
- **Then:** Returns an array of exactly 2 `NrdRecord` items (1 L1 and 1 L2) in sequential order.

### SC-10: Batch parse with collectErrors capturing records and errors
- **Given:** Multiline string containing 2 valid records and 1 corrupt row.
- **When:** Caller invokes `parseNrdLines(text, { collectErrors: true })`.
- **Then:** Returns `NrdBatchParseResult` with `records.length === 2` and `errors.length === 1`.
