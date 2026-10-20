import { useEffect, useId, useRef, useState } from "react";
import { windowKindLabels } from "../constants/terminal-window";
import type { Instrument, InstrumentCatalogProvider } from "../types/instrument";
import type { WindowKind } from "../types/terminal-window";

type InstrumentSearchDialogProps = {
  kind: WindowKind;
  catalog: InstrumentCatalogProvider;
  onSelect: (instrument: Instrument) => void;
  onCancel: () => void;
};
type SearchState = { status: "loading" } | { status: "ready"; results: Instrument[] } | { status: "error" };

export function InstrumentSearchDialog({ kind, catalog, onSelect, onCancel }: InstrumentSearchDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const [query, setQuery] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState<SearchState>({ status: "loading" });
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    inputRef.current?.focus();
    return () => dialog?.close();
  }, []);
  useEffect(() => {
    let current = true;
    async function load() {
      try {
        const results = await catalog.search(query);
        if (current) setSearch({ status: "ready", results });
      } catch {
        if (current) setSearch({ status: "error" });
      }
    }
    void load();
    return () => { current = false; };
  }, [catalog, query, attempt]);
  return (
    <dialog ref={dialogRef} className="instrument-dialog" aria-modal="true" aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); onCancel(); }}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); onCancel(); }
        if (event.key !== "Tab") return;
        const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), [tabindex="0"]',
        ) ?? []);
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first?.focus();
        }
      }}>
      <header className="instrument-dialog-heading">
        <h2 id={titleId}>{windowKindLabels[kind]} — Select instrument</h2>
        <button type="button" onClick={onCancel}>Close</button>
      </header>
      <input ref={inputRef} type="search" aria-label="Search instruments" placeholder="Search instruments"
        value={query} onChange={(event) => {
          setQuery(event.target.value);
          setSearch({ status: "loading" });
        }} />
      <div className="instrument-search-results">
        {search.status === "loading" ? (
          <div role="status" className="search-loading">
            <span className="search-spinner" aria-hidden="true" />
            <span className="sr-only">Loading...</span>
          </div>
        ) : search.status === "error" ? (
          <div>
            <p role="alert">Unable to load instruments.</p>
            <button type="button" onClick={() => {
              setSearch({ status: "loading" });
              setAttempt((value) => value + 1);
            }}>Retry</button>
          </div>
        ) : search.results.length === 0 ? <p role="status">No results</p> : (
          <ul className="instrument-results">
            {search.results.map((instrument) => (
              <li key={instrument.symbol}>
                <button type="button" onClick={() => onSelect(instrument)}>
                  <strong>{instrument.symbol}</strong>{" "}<span>{instrument.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </dialog>
  );
}
