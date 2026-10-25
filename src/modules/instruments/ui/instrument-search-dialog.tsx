"use client";

import { useEffect, useDeferredValue, useId, useRef, useState } from "react";

import { DEFAULT_WINDOW_KIND_LABELS } from "../constants";
import styles from "./instrument-search-dialog.module.css";

import type { Instrument, InstrumentSearchDialogProps } from "../types";

type SearchState =
  | { status: "loading" }
  | { status: "ready"; results: Instrument[] }
  | { status: "error"; error?: string };

export function InstrumentSearchDialog({
  kind,
  title,
  catalog,
  onSelect,
  onCancel,
}: InstrumentSearchDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const listboxId = useId();

  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [attempt, setAttempt] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [search, setSearch] = useState<SearchState>({ status: "loading" });

  const dialogTitle =
    title ??
    (kind !== undefined
      ? `${DEFAULT_WINDOW_KIND_LABELS[kind]} \u2014 Select instrument`
      : "Select instrument");

  useEffect(() => {
    const dialog = dialogRef.current;

    if (!dialog) return;

    try {
      if (typeof dialog.showModal === "function") {
        dialog.showModal();
      } else {
        dialog.setAttribute("open", "");
      }
    } catch {
      dialog.setAttribute("open", "");
    }

    inputRef.current?.focus();

    return () => {
      try {
        if (typeof dialog.close === "function") {
          dialog.close();
        } else {
          dialog.removeAttribute("open");
        }
      } catch {
        dialog.removeAttribute("open");
      }
    };
  }, []);

  useEffect(() => {
    let current = true;

    async function load() {
      try {
        const results = await catalog.search(deferredQuery);

        if (!current) return;

        setSearch({ status: "ready", results });
        setSelectedIndex(results.length > 0 ? 0 : -1);
      } catch (error) {
        if (!current) return;

        const message = error instanceof Error ? error.message : "Unable to load instruments.";

        setSearch({ status: "error", error: message });
        setSelectedIndex(-1);
      }
    }

    void load();

    return () => {
      current = false;
    };
  }, [catalog, deferredQuery, attempt]);

  const handleBackdropClick = (event: React.MouseEvent<HTMLDialogElement>) => {
    const dialog = dialogRef.current;

    if (!dialog || event.target !== dialog) return;

    const rect = dialog.getBoundingClientRect();
    const isOutside =
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom;

    if (isOutside) {
      onCancel();
    }
  };

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  };

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();

      return;
    }

    if (search.status !== "ready" || search.results.length === 0) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, search.results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();

      if (selectedIndex >= 0 && selectedIndex < search.results.length) {
        onSelect(search.results[selectedIndex]);
      }
    }
  };

  const isExpanded = search.status === "ready" && search.results.length > 0;
  const activeId =
    isExpanded && selectedIndex >= 0 ? `${listboxId}-option-${selectedIndex}` : undefined;

  return (
    <dialog
      ref={dialogRef}
      {...{ closedby: "any" }}
      aria-modal="true"
      aria-labelledby={titleId}
      className={styles.dialog}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onClick={handleBackdropClick}
      onKeyDown={handleDialogKeyDown}
    >
      <header className={styles.header}>
        <h2 id={titleId} className={styles.title}>
          {dialogTitle}
        </h2>
        <button type="button" onClick={onCancel} aria-label="Close" className={styles.closeButton}>
          Close
        </button>
      </header>

      <search className={styles.searchContainer}>
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-activedescendant={activeId}
          aria-expanded={isExpanded}
          aria-label="Search instruments"
          placeholder="Search instruments"
          value={query}
          autoFocus
          onChange={(event) => {
            setQuery(event.target.value);
            setSearch({ status: "loading" });
          }}
          onKeyDown={handleInputKeyDown}
          className={styles.searchInput}
        />
      </search>

      <div className={styles.resultsContainer}>
        {search.status === "loading" ? (
          <div role="status" className={styles.loading}>
            <span className={`${styles.spinner} spinner`} aria-hidden="true" />
            <span>Loading...</span>
          </div>
        ) : search.status === "error" ? (
          <div className={styles.error}>
            <p role="alert">{search.error ?? "Unable to load instruments."}</p>
            <button
              type="button"
              className={styles.retryButton}
              onClick={() => {
                setSearch({ status: "loading" });
                setAttempt((prev) => prev + 1);
              }}
            >
              Retry
            </button>
          </div>
        ) : search.results.length === 0 ? (
          <p role="status" className={styles.empty}>
            No results
          </p>
        ) : (
          <ul id={listboxId} role="listbox" className={styles.list}>
            {search.results.map((instrument, index) => {
              const isSelected = index === selectedIndex;
              const optionId = `${listboxId}-option-${index}`;

              return (
                <li
                  key={instrument.symbol}
                  id={optionId}
                  role="option"
                  aria-selected={isSelected}
                  className={isSelected ? `${styles.item} ${styles.active}` : styles.item}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <button
                    type="button"
                    tabIndex={-1}
                    className={styles.itemButton}
                    onClick={() => onSelect(instrument)}
                    aria-label={`${instrument.symbol} ${instrument.name}`}
                  >
                    <strong className={styles.symbol}>{instrument.symbol}</strong>{" "}
                    <span className={styles.name}>{instrument.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </dialog>
  );
}
