import { describe, expect, it } from "vitest";
import {
  WINDOW_KINDS,
  WINDOW_KIND_LABELS,
  instrumentSchema,
  windowKindSchema,
  type Instrument,
  type WidgetDefinition,
  type WidgetProps,
  type WindowKind,
} from "@/src/shared/contracts";

describe("shared-contracts: instrumentSchema", () => {
  it("validates and returns normalized data for a valid financial instrument", () => {
    // Given
    const input = { symbol: "ES", name: "E-mini S&P 500" };

    // When
    const result = instrumentSchema.safeParse(input);

    // Then
    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data).toEqual({ symbol: "ES", name: "E-mini S&P 500" });
    }
  });

  it("rejects invalid or incomplete instrument objects", () => {
    // Given: invalid inputs
    const invalidInputs = [
      { symbol: "", name: "Valid" },
      { symbol: "ES", name: "" },
      { symbol: 123 as unknown as string, name: "Invalid Symbol Type" },
      { symbol: "ES", name: 456 as unknown as string },
      {},
      null,
      undefined,
      "ES",
      { symbol: "   ", name: "Valid Name" },
      { symbol: "ES", name: "   " },
    ];

    for (const input of invalidInputs) {
      // When
      const result = instrumentSchema.safeParse(input);

      // Then
      expect(result.success).toBe(false);

      if (!result.success) {
        expect(result.error.issues.length).toBeGreaterThan(0);
      }
    }
  });

  it("trims leading and trailing whitespace from symbol and name", () => {
    // Given
    const input = { symbol: "  NQ  ", name: "  E-mini Nasdaq-100  " };

    // When
    const parsed = instrumentSchema.parse(input);

    // Then
    expect(parsed).toEqual({ symbol: "NQ", name: "E-mini Nasdaq-100" });
  });
});

describe("shared-contracts: windowKindSchema", () => {
  it("validates canonical window identifiers and rejects unknown or invalid values", () => {
    // Given: canonical kinds
    for (const kind of WINDOW_KINDS) {
      // When
      const result = windowKindSchema.safeParse(kind);

      // Then
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data).toBe(kind);
      }
    }

    // Given: invalid kinds
    const invalidKinds = ["depthLadder", "", "CHART", "order_book", 123, null, undefined, {}];

    for (const invalid of invalidKinds) {
      // When
      const result = windowKindSchema.safeParse(invalid);

      // Then
      expect(result.success).toBe(false);
    }
  });
});

describe("shared-contracts: window taxonomy constants", () => {
  it("maintains exhaustive mapping between WINDOW_KINDS and WINDOW_KIND_LABELS", () => {
    // Given
    const kinds = WINDOW_KINDS;
    const labelKeys = Object.keys(WINDOW_KIND_LABELS) as WindowKind[];

    // Then: exact set equivalence
    expect(kinds).toEqual(expect.arrayContaining(["chart", "orderBook", "timeAndSales"]));
    expect(kinds).toHaveLength(3);
    expect(labelKeys.sort()).toEqual([...kinds].sort());

    // Every kind has a non-empty human-readable label
    for (const kind of kinds) {
      const label = WINDOW_KIND_LABELS[kind];

      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }

    expect(WINDOW_KIND_LABELS.chart).toBe("Chart");
    expect(WINDOW_KIND_LABELS.orderBook).toBe("Level II");
    expect(WINDOW_KIND_LABELS.timeAndSales).toBe("T & S");
  });
});

describe("shared-contracts: type contracts compatibility", () => {
  it("allows constructing typed WidgetDefinition and WidgetProps conforming to contract", () => {
    const instrument: Instrument = { symbol: "AAPL", name: "Apple Inc." };

    const widgetProps: WidgetProps = {
      windowId: "win-1",
      instrument,
      isFocused: true,
      onChangeInstrument: () => undefined,
    };

    const widgetDef: WidgetDefinition = {
      kind: "chart",
      title: "Chart",
      component: () => null,
    };

    expect(widgetProps.windowId).toBe("win-1");
    expect(widgetProps.instrument.symbol).toBe("AAPL");
    expect(widgetDef.kind).toBe("chart");
    expect(widgetDef.title).toBe("Chart");
  });
});
