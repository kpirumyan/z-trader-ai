import { describe, expect, it } from "vitest";

import {
  AVAILABLE_INDICATOR_TYPES,
  calculateEma,
  calculateSma,
  DEFAULT_EMA_CONFIG,
  DEFAULT_SMA_CONFIG,
  emaConfigSchema,
  INDICATOR_DEFINITIONS,
  indicatorConfigSchema,
  indicatorOverlayTypeSchema,
  indicatorPointSchema,
  indicatorSourceKeySchema,
  indicatorTypeSchema,
  smaConfigSchema,
  type IndicatorCalculateFn,
  type IndicatorSourceKey,
} from "@/src/modules/indicators";

import type { Candle } from "@/src/shared/contracts";

function createCandle(
  time: number,
  close: number,
  overrides?: Partial<Omit<Candle, "time" | "close">>,
): Candle {
  return {
    time,
    open: overrides?.open ?? close,
    high: overrides?.high ?? close,
    low: overrides?.low ?? close,
    close,
    volume: overrides?.volume ?? 100,
  };
}

describe("indicators: calculateSma", () => {
  it("calculates SMA correctly with standard rolling window and close price source (Scenario 1)", () => {
    const candles: readonly Candle[] = [
      createCandle(1000, 10),
      createCandle(2000, 20),
      createCandle(3000, 30),
      createCandle(4000, 40),
      createCandle(5000, 50),
    ];

    const result = calculateSma(candles, { period: 3, source: "close" });

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ time: 3000, value: 20 });
    expect(result[1]).toEqual({ time: 4000, value: 30 });
    expect(result[2]).toEqual({ time: 5000, value: 40 });
  });

  it("applies default configuration (period 20, source close) when config is omitted", () => {
    const candles: readonly Candle[] = Array.from({ length: 21 }, (_, index) =>
      createCandle(1000 + index * 1000, index + 1),
    );

    const result = calculateSma(candles);

    expect(result).toHaveLength(2);
    // First SMA point: sum of 1..20 = 210, 210 / 20 = 10.5
    expect(result[0]).toEqual({ time: 20000, value: 10.5 });
    // Second SMA point: sum of 2..21 = 230, 230 / 20 = 11.5
    expect(result[1]).toEqual({ time: 21000, value: 11.5 });
  });

  it("returns an empty array when candles array is empty (Scenario 2)", () => {
    expect(calculateSma([])).toEqual([]);
    expect(calculateSma([], { period: 5, source: "close" })).toEqual([]);
  });

  it("returns an empty array when candles length is strictly less than period (Scenario 2)", () => {
    const candles: readonly Candle[] = [
      createCandle(1000, 10),
      createCandle(2000, 20),
      createCandle(3000, 30),
    ];

    expect(calculateSma(candles, { period: 5, source: "close" })).toEqual([]);
  });

  it("calculates a single point when candle count exactly equals the period", () => {
    const candles: readonly Candle[] = [
      createCandle(1000, 10),
      createCandle(2000, 20),
      createCandle(3000, 30),
    ];

    const result = calculateSma(candles, { period: 3, source: "close" });

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ time: 3000, value: 20 });
  });

  it("returns an empty array when period is non-positive or zero (Scenario 2)", () => {
    const candles: readonly Candle[] = [
      createCandle(1000, 10),
      createCandle(2000, 20),
      createCandle(3000, 30),
    ];

    expect(calculateSma(candles, { period: 0 })).toEqual([]);
    expect(calculateSma(candles, { period: -1 })).toEqual([]);
    expect(calculateSma(candles, { period: -10 })).toEqual([]);
  });

  it("does not mutate the input candles array or individual candle objects", () => {
    const candles: readonly Candle[] = Object.freeze([
      Object.freeze(createCandle(1000, 10)),
      Object.freeze(createCandle(2000, 20)),
      Object.freeze(createCandle(3000, 30)),
    ]);

    expect(() => calculateSma(candles, { period: 2 })).not.toThrow();
  });

  it("extracts prices correctly for all supported price sources (Scenario 3)", () => {
    const candles: readonly Candle[] = [
      createCandle(1000, 20, { open: 10, high: 30, low: 10 }),
      createCandle(2000, 40, { open: 20, high: 50, low: 30 }),
    ];

    const sources: readonly {
      readonly source: IndicatorSourceKey;
      readonly expectedValue: number;
    }[] = [
      { source: "open", expectedValue: (10 + 20) / 2 },
      { source: "high", expectedValue: (30 + 50) / 2 },
      { source: "low", expectedValue: (10 + 30) / 2 },
      { source: "close", expectedValue: (20 + 40) / 2 },
      {
        source: "hl2",
        expectedValue: 30,
      },
      {
        source: "hlc3",
        expectedValue: 30,
      },
      {
        source: "ohlc4",
        expectedValue: 26.25,
      },
    ];

    for (const { source, expectedValue } of sources) {
      const result = calculateSma(candles, { period: 2, source });

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ time: 2000, value: expectedValue });
    }
  });
});

describe("indicators: calculateEma", () => {
  it("calculates EMA correctly with seed SMA and recursive exponential weighting (Scenario 4)", () => {
    const candles: readonly Candle[] = [
      createCandle(100, 2),
      createCandle(200, 4),
      createCandle(300, 6),
      createCandle(400, 8),
    ];

    const result = calculateEma(candles, { period: 3, source: "close" });

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ time: 300, value: 4 });
    expect(result[1]).toEqual({ time: 400, value: 6 });
  });

  it("propagates exponential smoothing across subsequent candles", () => {
    const candles: readonly Candle[] = [
      createCandle(100, 2),
      createCandle(200, 4),
      createCandle(300, 6),
      createCandle(400, 8),
      createCandle(500, 10),
    ];

    const result = calculateEma(candles, { period: 3, source: "close" });

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ time: 300, value: 4 });
    expect(result[1]).toEqual({ time: 400, value: 6 });
    expect(result[2]).toEqual({ time: 500, value: 8 });
  });

  it("applies default configuration (period 20, source close) when config is omitted", () => {
    const candles: readonly Candle[] = Array.from({ length: 21 }, (_, index) =>
      createCandle(1000 + index * 1000, 10),
    );

    const result = calculateEma(candles);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ time: 20000, value: 10 });
    expect(result[1]).toEqual({ time: 21000, value: 10 });
  });

  it("returns an empty array when candles array is empty (Scenario 5)", () => {
    expect(calculateEma([])).toEqual([]);
    expect(calculateEma([], { period: 5, source: "close" })).toEqual([]);
  });

  it("returns an empty array when candles length is strictly less than period (Scenario 5)", () => {
    const candles: readonly Candle[] = [createCandle(100, 2), createCandle(200, 4)];

    expect(calculateEma(candles, { period: 3, source: "close" })).toEqual([]);
  });

  it("calculates a single seed point when candle count exactly equals the period", () => {
    const candles: readonly Candle[] = [
      createCandle(100, 2),
      createCandle(200, 4),
      createCandle(300, 6),
    ];

    const result = calculateEma(candles, { period: 3, source: "close" });

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ time: 300, value: 4 });
  });

  it("returns an empty array when period is non-positive or zero (Scenario 5)", () => {
    const candles: readonly Candle[] = [
      createCandle(100, 2),
      createCandle(200, 4),
      createCandle(300, 6),
    ];

    expect(calculateEma(candles, { period: 0 })).toEqual([]);
    expect(calculateEma(candles, { period: -1 })).toEqual([]);
    expect(calculateEma(candles, { period: -20 })).toEqual([]);
  });

  it("does not mutate the input candles array or individual candle objects", () => {
    const candles: readonly Candle[] = Object.freeze([
      Object.freeze(createCandle(100, 2)),
      Object.freeze(createCandle(200, 4)),
      Object.freeze(createCandle(300, 6)),
    ]);

    expect(() => calculateEma(candles, { period: 2 })).not.toThrow();
  });

  it("supports custom price sources for EMA calculation", () => {
    const candles: readonly Candle[] = [
      createCandle(100, 10, { high: 12, low: 8 }),
      createCandle(200, 20, { high: 24, low: 16 }),
      createCandle(300, 30, { high: 36, low: 24 }),
    ];

    const result = calculateEma(candles, { period: 2, source: "hl2" });

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ time: 200, value: 15 });
    expect(result[1]).toEqual({ time: 300, value: 25 });
  });
});

describe("indicators: constants and catalog integrity (Scenario 6)", () => {
  it("provides available indicator types matching supported indicators", () => {
    expect(AVAILABLE_INDICATOR_TYPES).toEqual(["sma", "ema"]);
  });

  it("contains complete and valid definitions for each supported indicator", () => {
    expect(INDICATOR_DEFINITIONS).toHaveLength(2);

    const smaDef = INDICATOR_DEFINITIONS.find((def) => def.id === "sma");

    expect(smaDef).toBeDefined();

    expect(smaDef).toEqual({
      id: "sma",
      name: "Simple Moving Average",
      shortName: "SMA",
      description: "Arithmetic mean of prices over a specified rolling window",
      overlayType: "overlay",
      defaultPeriod: 20,
      defaultSource: "close",
    });

    const emaDef = INDICATOR_DEFINITIONS.find((def) => def.id === "ema");

    expect(emaDef).toBeDefined();

    expect(emaDef).toEqual({
      id: "ema",
      name: "Exponential Moving Average",
      shortName: "EMA",
      description: "Exponentially weighted moving average giving higher weight to recent prices",
      overlayType: "overlay",
      defaultPeriod: 20,
      defaultSource: "close",
    });
  });

  it("exports valid default configuration constants", () => {
    expect(DEFAULT_SMA_CONFIG).toEqual({ period: 20, source: "close" });
    expect(DEFAULT_EMA_CONFIG).toEqual({ period: 20, source: "close" });
  });
});

describe("indicators: schema validation (Scenario 7)", () => {
  describe("smaConfigSchema", () => {
    it("parses empty object and applies default period and source", () => {
      const parsed = smaConfigSchema.parse({});

      expect(parsed).toEqual({ period: 20, source: "close" });
    });

    it("parses valid custom configuration", () => {
      const parsed = smaConfigSchema.parse({ period: 50, source: "open" });

      expect(parsed).toEqual({ period: 50, source: "open" });
    });

    it("rejects non-positive or non-integer periods", () => {
      expect(smaConfigSchema.safeParse({ period: 0 }).success).toBe(false);
      expect(smaConfigSchema.safeParse({ period: -5 }).success).toBe(false);
      expect(smaConfigSchema.safeParse({ period: 10.5 }).success).toBe(false);
    });

    it("rejects invalid price sources", () => {
      expect(smaConfigSchema.safeParse({ source: "volume" }).success).toBe(false);
      expect(smaConfigSchema.safeParse({ source: "invalid" }).success).toBe(false);
    });
  });

  describe("emaConfigSchema", () => {
    it("parses empty object and applies default period and source", () => {
      const parsed = emaConfigSchema.parse({});

      expect(parsed).toEqual({ period: 20, source: "close" });
    });

    it("parses valid custom configuration", () => {
      const parsed = emaConfigSchema.parse({ period: 12, source: "hlc3" });

      expect(parsed).toEqual({ period: 12, source: "hlc3" });
    });

    it("rejects non-positive or non-integer periods", () => {
      expect(emaConfigSchema.safeParse({ period: 0 }).success).toBe(false);
      expect(emaConfigSchema.safeParse({ period: -1 }).success).toBe(false);
      expect(emaConfigSchema.safeParse({ period: 5.75 }).success).toBe(false);
    });

    it("rejects invalid price sources", () => {
      expect(emaConfigSchema.safeParse({ source: "unknown" }).success).toBe(false);
    });
  });

  describe("indicatorConfigSchema", () => {
    it("parses discriminated union configs for sma and ema with defaults", () => {
      const smaParsed = indicatorConfigSchema.parse({ type: "sma" });

      expect(smaParsed).toEqual({ type: "sma", period: 20, source: "close" });

      const emaParsed = indicatorConfigSchema.parse({
        type: "ema",
        period: 14,
        source: "high",
      });

      expect(emaParsed).toEqual({ type: "ema", period: 14, source: "high" });
    });

    it("rejects invalid discriminator type or invalid parameters", () => {
      expect(indicatorConfigSchema.safeParse({ type: "rsi" }).success).toBe(false);
      expect(indicatorConfigSchema.safeParse({ type: "sma", period: 0 }).success).toBe(false);
      expect(indicatorConfigSchema.safeParse({ type: "ema", period: -1 }).success).toBe(false);
    });
  });

  describe("indicatorTypeSchema", () => {
    it("accepts valid indicator types and rejects others", () => {
      expect(indicatorTypeSchema.safeParse("sma").success).toBe(true);
      expect(indicatorTypeSchema.safeParse("ema").success).toBe(true);
      expect(indicatorTypeSchema.safeParse("macd").success).toBe(false);
      expect(indicatorTypeSchema.safeParse("").success).toBe(false);
    });
  });

  describe("indicatorSourceKeySchema", () => {
    it("accepts all 7 supported price source keys", () => {
      const validKeys: readonly IndicatorSourceKey[] = [
        "close",
        "open",
        "high",
        "low",
        "hl2",
        "hlc3",
        "ohlc4",
      ];

      for (const key of validKeys) {
        expect(indicatorSourceKeySchema.safeParse(key).success).toBe(true);
      }

      expect(indicatorSourceKeySchema.safeParse("volume").success).toBe(false);
      expect(indicatorSourceKeySchema.safeParse("vwap").success).toBe(false);
    });
  });

  describe("indicatorOverlayTypeSchema", () => {
    it("accepts 'overlay' and 'pane' and rejects unknown types", () => {
      expect(indicatorOverlayTypeSchema.safeParse("overlay").success).toBe(true);
      expect(indicatorOverlayTypeSchema.safeParse("pane").success).toBe(true);
      expect(indicatorOverlayTypeSchema.safeParse("window").success).toBe(false);
    });
  });

  describe("indicatorPointSchema", () => {
    it("validates well-formed IndicatorPoint objects", () => {
      expect(indicatorPointSchema.safeParse({ time: 1700000000, value: 42.5 }).success).toBe(true);
      expect(indicatorPointSchema.safeParse({ time: "invalid", value: 42.5 }).success).toBe(false);

      expect(indicatorPointSchema.safeParse({ time: 1700000000, value: "invalid" }).success).toBe(
        false,
      );

      expect(indicatorPointSchema.safeParse({}).success).toBe(false);
    });
  });
});

describe("indicators: function type contracts", () => {
  it("conforms calculateSma and calculateEma to the IndicatorCalculateFn interface", () => {
    const smaFn: IndicatorCalculateFn = calculateSma;
    const emaFn: IndicatorCalculateFn = calculateEma;

    const candles: readonly Candle[] = [createCandle(1000, 10)];

    expect(typeof smaFn).toBe("function");
    expect(typeof emaFn).toBe("function");
    expect(smaFn(candles)).toEqual([]);
    expect(emaFn(candles)).toEqual([]);
  });
});
