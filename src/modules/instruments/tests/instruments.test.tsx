import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_INSTRUMENTS,
  DEFAULT_WINDOW_KIND_LABELS,
  InstrumentSearchDialog,
  demoInstrumentCatalog,
  instrumentCatalogSchema,
  instrumentSchema,
  type Instrument,
  type InstrumentCatalogProvider,
  type WindowKind,
} from "../index";

const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
const openDialogs = new Set<HTMLDialogElement>();

beforeAll(() => {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      writable: true,
      value(this: HTMLDialogElement) {
        if (this.open) return;
        this.open = true;
        openDialogs.add(this);

        const autofocus = this.hasAttribute("autofocus")
          ? this
          : this.querySelector<HTMLElement>("[autofocus]");
        const target =
          autofocus ??
          this.querySelector<HTMLElement>(
            'input:not([disabled]):not([type="hidden"]), button:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ) ??
          this;

        target.focus();
      },
    },
    close: {
      configurable: true,
      writable: true,
      value(this: HTMLDialogElement, returnValue?: string) {
        if (!this.open) return;
        this.open = false;
        openDialogs.delete(this);

        if (returnValue !== undefined) {
          this.returnValue = returnValue;
        }

        this.dispatchEvent(new Event("close"));
      },
    },
  });
});

afterAll(() => {
  if (originalShowModal) {
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShowModal);
  } else {
    Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  }

  if (originalClose) {
    Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose);
  } else {
    Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  }
});

afterEach(() => {
  cleanup();
  openDialogs.clear();
  vi.restoreAllMocks();
});

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

function renderSearchDialog(options?: {
  catalog?: InstrumentCatalogProvider;
  kind?: WindowKind;
  title?: string;
  onSelect?: (instrument: Instrument) => void;
  onCancel?: () => void;
}) {
  const defaultCatalog: InstrumentCatalogProvider = {
    search: vi.fn(async () => []),
  };

  const catalog = options?.catalog ?? defaultCatalog;
  const onSelect = options?.onSelect ?? vi.fn();
  const onCancel = options?.onCancel ?? vi.fn();

  render(
    <InstrumentSearchDialog
      catalog={catalog}
      kind={options?.kind}
      title={options?.title}
      onSelect={onSelect}
      onCancel={onCancel}
    />,
  );

  const dialog = screen.getByRole("dialog");
  const input = within(dialog).getByRole("combobox", {
    name: "Search instruments",
  }) as HTMLInputElement;

  return { dialog, input, onSelect, onCancel };
}

describe("demoInstrumentCatalog", () => {
  // Scenario 1: Demo Catalog — Empty Query Returns Full Catalog
  it("returns full default instruments list for empty query and preserves immutability", async () => {
    const results = await demoInstrumentCatalog.search("");

    expect(results).toHaveLength(10);

    expect(results.map((i) => i.symbol)).toEqual(
      expect.arrayContaining(["ES", "NQ", "CL", "GC", "6E", "ZB", "YM", "RTY", "MES", "MNQ"]),
    );

    expect(results.every((i) => i.symbol.length > 0 && i.name.length > 0)).toBe(true);

    const whitespaceResults = await demoInstrumentCatalog.search("   ");

    expect(whitespaceResults).toHaveLength(10);

    // Verify defensive copy immutability
    const first = await demoInstrumentCatalog.search("");
    const second = await demoInstrumentCatalog.search("");

    expect(first).not.toBe(second);
    expect(first[0]).not.toBe(second[0]);
    expect(first[0]).toEqual(second[0]);
  });

  // Scenario 2: Demo Catalog — Case-Insensitive Substring Match
  it("matches instruments by symbol or name case-insensitively", async () => {
    const esMatches = await demoInstrumentCatalog.search("es");
    const esSymbols = esMatches.map((i) => i.symbol).sort();

    expect(esSymbols).toEqual(["ES", "MES"].sort());

    const goldMatches = await demoInstrumentCatalog.search("GOLD");

    expect(goldMatches).toHaveLength(1);
    expect(goldMatches[0].symbol).toBe("GC");
    expect(goldMatches[0].name).toBe("Gold");

    const nasdaqMatches = await demoInstrumentCatalog.search("nasdaq");
    const nasdaqSymbols = nasdaqMatches.map((i) => i.symbol).sort();

    expect(nasdaqSymbols).toEqual(["MNQ", "NQ"].sort());
  });

  // Scenario 3: Demo Catalog — Non-Matching Query
  it("returns an empty array when query does not match any ticker or name", async () => {
    const results = await demoInstrumentCatalog.search("UNKNOWN_TICKER_XYZ");

    expect(results).toEqual([]);
  });
});

describe("Instrument Schemas and Constants", () => {
  // Scenario 4: Instrument Schema Validation
  it("validates valid instruments and rejects invalid structures via instrumentSchema and instrumentCatalogSchema", () => {
    const validInstrument: Instrument = { symbol: "BTC", name: "Bitcoin" };
    const validParse = instrumentSchema.safeParse(validInstrument);

    expect(validParse.success).toBe(true);

    if (validParse.success) {
      expect(validParse.data).toEqual(validInstrument);
    }

    const invalidCases = [
      { symbol: "", name: "Test" },
      { symbol: "ES" },
      { symbol: "ES", name: "" },
      { symbol: 123, name: "Number Symbol" },
      null,
      undefined,
      "invalid",
    ];

    for (const invalid of invalidCases) {
      const parsed = instrumentSchema.safeParse(invalid);

      expect(parsed.success).toBe(false);
    }

    const validCatalogParse = instrumentCatalogSchema.safeParse(DEFAULT_INSTRUMENTS);

    expect(validCatalogParse.success).toBe(true);

    const emptyCatalogParse = instrumentCatalogSchema.safeParse([]);

    expect(emptyCatalogParse.success).toBe(true);

    const invalidCatalogParse = instrumentCatalogSchema.safeParse([
      { symbol: "", name: "Invalid" },
    ]);

    expect(invalidCatalogParse.success).toBe(false);
  });

  it("exports expected default constants", () => {
    expect(DEFAULT_INSTRUMENTS.length).toBe(10);
    expect(DEFAULT_WINDOW_KIND_LABELS.chart).toBe("Chart");
    expect(DEFAULT_WINDOW_KIND_LABELS.orderBook).toBe("Level II");
    expect(DEFAULT_WINDOW_KIND_LABELS.timeAndSales).toBe("T & S");
  });
});

describe("InstrumentSearchDialog Component", () => {
  // Scenario 5: Dialog Initial Render & Focus
  it("renders with kind label, focuses search input inside <search>, and leaves callbacks uncalled", () => {
    const onSelect = vi.fn();
    const onCancel = vi.fn();

    const { dialog, input } = renderSearchDialog({
      kind: "chart",
      onSelect,
      onCancel,
    });

    expect(dialog).not.toBeNull();
    expect(screen.getByRole("dialog", { name: "Chart — Select instrument" })).toBe(dialog);

    const searchContainer = dialog.querySelector("search");

    expect(searchContainer).not.toBeNull();
    expect(searchContainer?.contains(input)).toBe(true);

    expect(input.value).toBe("");
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.getAttribute("aria-expanded")).toBe("false");

    expect(onSelect).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  // Scenario 6: Dialog Custom Title Override
  it("renders custom title override when specified, or fallback when neither kind nor title provided", () => {
    const { dialog: customDialog } = renderSearchDialog({
      title: "Custom Instrument Selector",
    });

    expect(screen.getByRole("dialog", { name: "Custom Instrument Selector" })).toBe(customDialog);

    cleanup();

    const { dialog: fallbackDialog } = renderSearchDialog({});

    expect(screen.getByRole("dialog", { name: "Select instrument" })).toBe(fallbackDialog);
  });

  // Scenario 7: Dialog Loading State During Catalog Search
  it("displays loading indicator and spinner while search promise is pending without disabling input", async () => {
    const pending = createDeferred<Instrument[]>();
    const catalog: InstrumentCatalogProvider = {
      search: vi.fn((query: string) => (query === "ES" ? pending.promise : Promise.resolve([]))),
    };

    const { dialog, input, onSelect, onCancel } = renderSearchDialog({ catalog });

    fireEvent.change(input, { target: { value: "ES" } });

    await waitFor(() => expect(catalog.search).toHaveBeenCalledWith("ES"));

    const status = within(dialog).getByRole("status");

    expect(status.textContent).toContain("Loading...");
    expect(dialog.querySelector('[class*="spinner"]')).not.toBeNull();

    expect(input.disabled).toBe(false);
    expect(input.value).toBe("ES");
    expect(onSelect).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();

    await act(async () => {
      pending.resolve([]);
    });
  });

  // Scenario 8: Dialog Result Selection by Click
  it("selects instrument result immediately upon click and invokes onSelect", async () => {
    const esInstrument: Instrument = { symbol: "ES", name: "E-mini S&P 500" };
    const catalog: InstrumentCatalogProvider = {
      search: vi.fn(async (query: string) => (query === "ES" ? [esInstrument] : [])),
    };
    const onSelect = vi.fn();
    const onCancel = vi.fn();

    const { dialog, input } = renderSearchDialog({
      catalog,
      onSelect,
      onCancel,
    });

    fireEvent.change(input, { target: { value: "ES" } });

    const resultButton = await within(dialog).findByRole("button", {
      name: (name) => name.includes("ES") && name.includes("E-mini S&P 500"),
    });

    fireEvent.click(resultButton);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(esInstrument);
    expect(onCancel).not.toHaveBeenCalled();
  });

  // Scenario 9: Terminal Keyboard Navigation (Arrow Down / Up + Enter)
  it("navigates results with ArrowDown/ArrowUp maintaining focus in input and selects on Enter", async () => {
    const esInstrument: Instrument = { symbol: "ES", name: "E-mini S&P 500" };
    const mesInstrument: Instrument = { symbol: "MES", name: "Micro E-mini S&P 500" };

    const catalog: InstrumentCatalogProvider = {
      search: vi.fn(async (query: string) => (query === "ES" ? [esInstrument, mesInstrument] : [])),
    };
    const onSelect = vi.fn();

    const { dialog, input } = renderSearchDialog({
      catalog,
      onSelect,
    });

    fireEvent.change(input, { target: { value: "ES" } });

    const options = await within(dialog).findAllByRole("option");

    expect(options).toHaveLength(2);

    // Initial state: first option selected (selectedIndex: 0)
    expect(options[0].getAttribute("aria-selected")).toBe("true");
    expect(options[1].getAttribute("aria-selected")).toBe("false");

    // Press ArrowDown -> second option selected (selectedIndex: 1)
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(options[0].getAttribute("aria-selected")).toBe("false");
    expect(options[1].getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(input);

    // Press ArrowDown past the end -> clamped at index 1
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(options[1].getAttribute("aria-selected")).toBe("true");

    // Press ArrowUp -> back to first option (selectedIndex: 0)
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(options[0].getAttribute("aria-selected")).toBe("true");
    expect(options[1].getAttribute("aria-selected")).toBe("false");

    // Move to MES and press Enter
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(options[1].getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(mesInstrument);
    expect(document.activeElement).toBe(input);
  });

  // Scenario 10: Dialog Empty Results Feedback
  it("announces No results status when search returns empty array and preserves input query", async () => {
    const catalog: InstrumentCatalogProvider = {
      search: vi.fn(async () => []),
    };

    const { dialog, input, onSelect, onCancel } = renderSearchDialog({ catalog });

    fireEvent.change(input, { target: { value: "NONEXISTENT" } });

    await waitFor(() => {
      const status = within(dialog).getByRole("status");

      expect(status.textContent).toContain("No results");
    });

    expect(input.value).toBe("NONEXISTENT");
    expect(document.activeElement).toBe(input);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  // Scenario 11: Dialog Error & Retry Recovery
  it("renders role=alert on search rejection and allows recovery via Retry button", async () => {
    const failedDeferred = createDeferred<Instrument[]>();
    const retryDeferred = createDeferred<Instrument[]>();
    let searchAttempts = 0;

    const catalog: InstrumentCatalogProvider = {
      search: vi.fn((query: string) => {
        if (query !== "ES") return Promise.resolve([]);
        searchAttempts += 1;

        return searchAttempts === 1 ? failedDeferred.promise : retryDeferred.promise;
      }),
    };

    const esInstrument: Instrument = { symbol: "ES", name: "E-mini S&P 500" };
    const { dialog, input, onSelect, onCancel } = renderSearchDialog({ catalog });

    fireEvent.change(input, { target: { value: "ES" } });
    await waitFor(() => expect(catalog.search).toHaveBeenCalledWith("ES"));

    await act(async () => {
      failedDeferred.reject(new Error("Network failure"));
    });

    const alert = await within(dialog).findByRole("alert");

    expect(alert.textContent).toBeTruthy();
    expect(input.value).toBe("ES");
    expect(input.disabled).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();

    const retryButton = within(dialog).getByRole("button", { name: /^Retry$/ });

    fireEvent.click(retryButton);

    await waitFor(() => expect(searchAttempts).toBe(2));
    expect(within(dialog).getByRole("status").textContent).toContain("Loading...");

    await act(async () => {
      retryDeferred.resolve([esInstrument]);
    });

    const resultButton = await within(dialog).findByRole("button", {
      name: (name) => name.includes("ES") && name.includes("E-mini S&P 500"),
    });

    expect(resultButton).not.toBeNull();
    expect(within(dialog).queryByRole("alert")).toBeNull();
  });

  // Scenario 12: Dialog Discards Out-of-Order Stale Responses
  it("discards late stale responses from earlier queries when newer query has resolved", async () => {
    const oldRequest = createDeferred<Instrument[]>();
    const latestRequest = createDeferred<Instrument[]>();

    const catalog: InstrumentCatalogProvider = {
      search: vi.fn((query: string) => {
        if (query === "ES") return oldRequest.promise;
        if (query === "NQ") return latestRequest.promise;

        return Promise.resolve([]);
      }),
    };

    const esInstrument: Instrument = { symbol: "ES", name: "E-mini S&P 500" };
    const nqInstrument: Instrument = { symbol: "NQ", name: "E-mini Nasdaq-100" };

    const { dialog, input, onSelect } = renderSearchDialog({ catalog });

    fireEvent.change(input, { target: { value: "ES" } });
    await waitFor(() => expect(catalog.search).toHaveBeenCalledWith("ES"));

    fireEvent.change(input, { target: { value: "NQ" } });
    await waitFor(() => expect(catalog.search).toHaveBeenCalledWith("NQ"));

    // Newer request finishes first
    await act(async () => {
      latestRequest.resolve([nqInstrument]);
    });

    expect(
      await within(dialog).findByRole("button", {
        name: (name) => name.includes("NQ") && name.includes("E-mini Nasdaq-100"),
      }),
    ).not.toBeNull();

    // Stale older request finishes later
    await act(async () => {
      oldRequest.resolve([esInstrument]);
    });

    expect(input.value).toBe("NQ");

    expect(
      within(dialog).getByRole("button", {
        name: (name) => name.includes("NQ") && name.includes("E-mini Nasdaq-100"),
      }),
    ).not.toBeNull();

    expect(
      within(dialog).queryByRole("button", {
        name: (name) => name.includes("ES") && name.includes("E-mini S&P 500"),
      }),
    ).toBeNull();

    expect(onSelect).not.toHaveBeenCalled();
  });

  // Scenario 13: Dialog Cancellation via Close Button or Escape
  it("cancels dialog and invokes onCancel via Close button", () => {
    const onSelect = vi.fn();
    const onCancel = vi.fn();

    const { dialog } = renderSearchDialog({ onSelect, onCancel });

    const closeButton = within(dialog).getByRole("button", { name: "Close" });

    fireEvent.click(closeButton);

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("cancels dialog and invokes onCancel via Escape keyboard event", () => {
    const onSelect = vi.fn();
    const onCancel = vi.fn();

    const { dialog } = renderSearchDialog({ onSelect, onCancel });

    fireEvent.keyDown(dialog, { key: "Escape" });

    if (onCancel.mock.calls.length === 0) {
      fireEvent(dialog, new Event("cancel", { cancelable: true }));
    }

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  // Scenario 14: Dialog Light-Dismiss via Backdrop Click
  it("invokes onCancel when clicking backdrop outside dialog bounds and ignores clicks inside", () => {
    const onSelect = vi.fn();
    const onCancel = vi.fn();

    const { dialog } = renderSearchDialog({ onSelect, onCancel });

    vi.spyOn(dialog, "getBoundingClientRect").mockReturnValue({
      top: 100,
      left: 100,
      bottom: 500,
      right: 500,
      width: 400,
      height: 400,
      x: 100,
      y: 100,
      toJSON: () => {},
    });

    // Click inside dialog bounds (e.g. at 200, 200) -> should not cancel
    fireEvent.click(dialog, { clientX: 200, clientY: 200 });
    expect(onCancel).not.toHaveBeenCalled();

    // Click outside dialog bounds (on backdrop, e.g. at 50, 50) -> should cancel
    fireEvent.click(dialog, { clientX: 50, clientY: 50 });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
