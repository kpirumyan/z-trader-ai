import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { InstrumentSearchDialog } from "@/app/components/instrument-search-dialog";
import { demoInstrumentCatalog } from "@/app/instruments/instrument-catalog";
import type { Instrument, InstrumentCatalogProvider } from "@/app/types/instrument";

const es: Instrument = { symbol: "ES", name: "E-mini S&P 500" };
const nq: Instrument = { symbol: "NQ", name: "E-mini Nasdaq 100" };

// jsdom has no modal dialog methods or Escape default action. Model the platform,
// without choosing a search-specific focus target or invoking component callbacks.
const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
const openDialogs = new Set<HTMLDialogElement>();
const previousFocus = new WeakMap<HTMLDialogElement, HTMLElement>();

function nativeDialogEscape(event: KeyboardEvent) {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  const dialog = [...openDialogs].at(-1);
  if (!dialog?.open || !dialog.isConnected) return;
  const cancel = new Event("cancel", { cancelable: true });
  if (dialog.dispatchEvent(cancel)) dialog.close();
}

beforeAll(() => {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      writable: true,
      value(this: HTMLDialogElement) {
        if (this.open) return;
        if (document.activeElement instanceof HTMLElement) previousFocus.set(this, document.activeElement);
        this.open = true;
        openDialogs.add(this);
        const autofocus = this.hasAttribute("autofocus") ? this : this.querySelector<HTMLElement>("[autofocus]");
        const target = autofocus ?? this.querySelector<HTMLElement>(
          'button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ) ?? this;
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
        if (returnValue !== undefined) this.returnValue = returnValue;
        const previous = previousFocus.get(this);
        if (previous?.isConnected) previous.focus();
        this.dispatchEvent(new Event("close"));
      },
    },
  });
  document.addEventListener("keydown", nativeDialogEscape);
});

afterAll(() => {
  document.removeEventListener("keydown", nativeDialogEscape);
  if (originalShowModal) Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShowModal);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function mountSearch(catalog: InstrumentCatalogProvider, kind: "chart" | "orderBook" | "timeAndSales" = "chart") {
  const onSelect = vi.fn();
  const onCancel = vi.fn();
  render(<InstrumentSearchDialog kind={kind} catalog={catalog} onSelect={onSelect} onCancel={onCancel} />);
  const dialog = screen.getByRole("dialog");
  const input = within(dialog).getByRole("searchbox", { name: "Search instruments" }) as HTMLInputElement;
  return { dialog, input, onSelect, onCancel };
}

afterEach(() => {
  cleanup();
  openDialogs.clear();
  vi.restoreAllMocks();
});

describe("demoInstrumentCatalog public search contract", () => {
  it("returns the ten demo instruments for an empty query", async () => {
    const instruments = await demoInstrumentCatalog.search("");
    expect(instruments.map(({ symbol }) => symbol).sort()).toEqual([
      "6E", "CL", "ES", "GC", "MES", "MNQ", "NQ", "RTY", "YM", "ZB",
    ].sort());
    expect(instruments.every(({ name }) => name.trim().length > 0)).toBe(true);
  });

  it("matches symbol and name without regard to case, and returns no unrelated instruments", async () => {
    const all = await demoInstrumentCatalog.search("");
    for (const query of ["eS", "nQ", all.find(({ symbol }) => symbol === "GC")!.name.toUpperCase()]) {
      const expected = all.filter(({ symbol, name }) =>
        symbol.toLowerCase().includes(query.toLowerCase()) || name.toLowerCase().includes(query.toLowerCase()),
      );
      expect(expected.length).toBeGreaterThan(0);
      const actual = await demoInstrumentCatalog.search(query);
      expect(actual.map(({ symbol }) => symbol).sort()).toEqual(expected.map(({ symbol }) => symbol).sort());
    }
    expect(await demoInstrumentCatalog.search("no-such-instrument-xyz")).toEqual([]);
  });
});

describe("InstrumentSearchDialog", () => {
  it.each([
    ["chart", "Chart"],
    ["orderBook", "Level II"],
    ["timeAndSales", "T & S"],
  ] as const)("opens %s with an empty focused search and no selection", (kind, label) => {
    const { dialog, input, onSelect } = mountSearch({ search: async () => [] }, kind);
    expect(screen.getByRole("dialog", { name: new RegExp(label) })).toBe(dialog);
    expect(input.value).toBe("");
    expect(document.activeElement).toBe(input);
    expect(within(dialog).queryByRole("button", { name: /^Open$/ })).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("keeps search available while loading, announces it, then selects a result immediately by click", async () => {
    const pending = deferred<Instrument[]>();
    const search = vi.fn((query: string) => query === "ES" ? pending.promise : Promise.resolve([]));
    const { dialog, input, onSelect, onCancel } = mountSearch({ search });

    fireEvent.change(input, { target: { value: "ES" } });
    await waitFor(() => expect(search).toHaveBeenCalledWith("ES"));
    expect(within(dialog).getByRole("status").textContent).toContain("Loading...");
    expect(within(dialog).getByRole("searchbox", { name: "Search instruments" })).toBe(input);
    expect(input.disabled).toBe(false);
    expect(input.value).toBe("ES");
    expect(dialog.querySelector('.search-spinner[aria-hidden="true"]')).not.toBeNull();
    expect(within(dialog).getByRole("button", { name: /^Close$/ })).toBeTruthy();
    expect(onSelect).not.toHaveBeenCalled();

    await act(async () => { pending.resolve([es]); });
    const result = await within(dialog).findByRole("button", { name: /(?=.*\bES\b)(?=.*E-mini S&P 500)/ });
    expect(within(dialog).queryByText("Loading...", { exact: true })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: /^Open$/ })).toBeNull();
    fireEvent.click(result);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(es);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("announces No results, retains the query and permits another search", async () => {
    const search = vi.fn(async (query: string) => query === "NQ" ? [nq] : []);
    const { dialog, input, onSelect, onCancel } = mountSearch({ search });
    fireEvent.change(input, { target: { value: "missing" } });
    await waitFor(() => expect(search).toHaveBeenCalledWith("missing"));
    await waitFor(() => expect(within(dialog).getByRole("status").textContent).toContain("No results"));
    expect(input.value).toBe("missing");
    expect(document.activeElement).toBe(input);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "NQ" } });
    expect(await within(dialog).findByRole("button", { name: /(?=.*\bNQ\b)(?=.*E-mini Nasdaq 100)/ })).toBeTruthy();
    expect(within(dialog).queryByText("No results", { exact: true })).toBeNull();
  });

  it("announces failure without closing, then Retry resubmits the preserved query and recovers", async () => {
    const failed = deferred<Instrument[]>();
    const retry = deferred<Instrument[]>();
    let attempts = 0;
    const search = vi.fn((query: string) => {
      if (query !== "ES") return Promise.resolve([]);
      attempts += 1;
      return attempts === 1 ? failed.promise : retry.promise;
    });
    const { dialog, input, onSelect, onCancel } = mountSearch({ search });
    fireEvent.change(input, { target: { value: "ES" } });
    await waitFor(() => expect(search).toHaveBeenCalledWith("ES"));
    await act(async () => { failed.reject(new Error("Catalog unavailable")); });
    const error = await within(dialog).findByRole("alert");
    expect(error.textContent?.trim().length).toBeGreaterThan(0);
    expect(input.value).toBe("ES");
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(input.disabled).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: /^Retry$/ }));
    await waitFor(() => expect(search.mock.calls.filter(([query]) => query === "ES")).toHaveLength(2));
    expect(input.value).toBe("ES");
    expect(within(dialog).getByRole("status").textContent).toContain("Loading...");
    await act(async () => { retry.resolve([es]); });
    expect(await within(dialog).findByRole("button", { name: /(?=.*\bES\b)(?=.*E-mini S&P 500)/ })).toBeTruthy();
    expect(within(dialog).queryByRole("alert")).toBeNull();
    expect(input.value).toBe("ES");
  });

  it("keeps the latest query results when an older search finishes later", async () => {
    const oldRequest = deferred<Instrument[]>();
    const latestRequest = deferred<Instrument[]>();
    const search = vi.fn((query: string) => {
      if (query === "ES") return oldRequest.promise;
      if (query === "NQ") return latestRequest.promise;
      return Promise.resolve([]);
    });
    const { dialog, input, onSelect } = mountSearch({ search });
    fireEvent.change(input, { target: { value: "ES" } });
    await waitFor(() => expect(search).toHaveBeenCalledWith("ES"));
    fireEvent.change(input, { target: { value: "NQ" } });
    await waitFor(() => expect(search).toHaveBeenCalledWith("NQ"));
    await act(async () => { latestRequest.resolve([nq]); });
    expect(await within(dialog).findByRole("button", { name: /(?=.*\bNQ\b)(?=.*E-mini Nasdaq 100)/ })).toBeTruthy();
    await act(async () => { oldRequest.resolve([es]); });
    expect(input.value).toBe("NQ");
    expect(within(dialog).getByRole("button", { name: /(?=.*\bNQ\b)(?=.*E-mini Nasdaq 100)/ })).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: /(?=.*\bES\b)(?=.*E-mini S&P 500)/ })).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it.each(["Escape", "Close"] as const)("cancels via %s without selecting during a pending search", async (closing) => {
    const pending = deferred<Instrument[]>();
    const search = vi.fn((query: string) => query === "ES" ? pending.promise : Promise.resolve([]));
    const { dialog, input, onSelect, onCancel } = mountSearch({ search });
    fireEvent.change(input, { target: { value: "ES" } });
    await waitFor(() => expect(search).toHaveBeenCalledWith("ES"));
    if (closing === "Escape") fireEvent.keyDown(input, { key: "Escape" });
    else fireEvent.click(within(dialog).getByRole("button", { name: /^Close$/ }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
