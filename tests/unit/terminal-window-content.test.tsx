import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Chart } from "@/app/components/chart";
import { OrderBook } from "@/app/components/order-book";
import { TimeAndSales } from "@/app/components/time-and-sales";

afterEach(cleanup);

function visibleDataRows(headers: string[]) {
  const table = screen.queryByRole("table") ?? screen.getByRole("grid");

  for (const name of headers) {
    expect(within(table).getByRole("columnheader", { name })).toBeDefined();
  }

  const rows = within(table)
    .getAllByRole("row")
    .filter(
      (row) =>
        within(row).queryAllByRole("cell").length > 0 ||
        within(row).queryAllByRole("gridcell").length > 0,
    );

  expect(rows.length).toBeGreaterThanOrEqual(5);

  return rows.map((row) => {
    const cells = within(row).queryAllByRole("cell");
    const values = (cells.length ? cells : within(row).getAllByRole("gridcell")).map(
      (cell) => cell.textContent?.trim() ?? "",
    );

    expect(values).toHaveLength(headers.length);

    return values;
  });
}

function numberIn(text: string) {
  expect(text.trim()).not.toBe("");

  const value = Number(text.replaceAll(",", ""));

  expect(Number.isFinite(value)).toBe(true);

  return value;
}

describe("terminal demo content", () => {
  it("Chart identifies the selected instrument and updates its accessible graphic when the symbol changes", () => {
    const { rerender } = render(<Chart symbol="ES" />);

    expect(screen.getByRole("img", { name: "Candlestick chart for ES" })).toBeDefined();
    expect(screen.getByText("Demo data", { exact: true })).toBeDefined();

    rerender(<Chart symbol="NQ" />);
    expect(screen.getByRole("img", { name: "Candlestick chart for NQ" })).toBeDefined();
    expect(screen.queryByRole("img", { name: "Candlestick chart for ES" })).toBeNull();
    expect(screen.getByText("Demo data", { exact: true })).toBeDefined();
  });

  it.each(["ES", "NQ"])(
    "Level II renders numeric bid/ask depth for %s rather than an empty frame",
    (symbol) => {
      const { container } = render(<OrderBook symbol={symbol} />);

      expect(container.textContent).toContain(symbol);
      expect(screen.getByText("Demo data", { exact: true })).toBeDefined();

      const rows = visibleDataRows(["Bid size", "Price", "Ask size"]);

      for (const [bid, price, ask] of rows) {
        expect(numberIn(bid)).toBeGreaterThanOrEqual(0);
        expect(numberIn(price)).toBeGreaterThan(0);
        expect(numberIn(ask)).toBeGreaterThanOrEqual(0);
      }

      expect(new Set(rows.map((row) => numberIn(row[1]))).size).toBeGreaterThan(1);
      expect(rows.some(([bid]) => numberIn(bid) > 0)).toBe(true);
      expect(rows.some(([, , ask]) => numberIn(ask) > 0)).toBe(true);
    },
  );

  it.each(["GC", "CL"])(
    "T & S renders timestamped trades with price, size and both sides for %s",
    (symbol) => {
      const { container } = render(<TimeAndSales symbol={symbol} />);

      expect(container.textContent).toContain(symbol);
      expect(screen.getByText("Demo data", { exact: true })).toBeDefined();

      const rows = visibleDataRows(["Time", "Price", "Size", "Side"]);

      for (const [time, price, size, side] of rows) {
        expect(time).not.toBe("");
        expect(numberIn(price)).toBeGreaterThan(0);
        expect(numberIn(size)).toBeGreaterThan(0);
        expect(["Buy", "Sell"]).toContain(side);
      }

      expect(new Set(rows.map((row) => row[3]))).toEqual(new Set(["Buy", "Sell"]));
    },
  );
});
