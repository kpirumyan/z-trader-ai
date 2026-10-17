"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent,
  type ReactNode,
} from "react";
import { chartArtwork } from "./chart-artwork";

type Kind = "main" | "hour" | "nasdaq";
type ChartWindow = {
  id: number;
  kind: Kind;
  x: number;
  y: number;
  width: number;
  height: number;
  minimized: boolean;
  maximized: boolean;
};
type Theme = "dark" | "light";
const STORAGE = "z-trader-stitch-v1";
const instruments = [
  ["ES", "S&P 500 E-mini", "5 084.25", "+0.42%"],
  ["NQ", "Nasdaq 100", "18 112.50", "-0.18%"],
  ["YM", "Dow Jones Mini", "38 980.00", "+0.12%"],
  ["RTY", "Russell 2000", "2 054.10", "+0.65%"],
  ["CL", "Crude Oil", "78.45", "-0.85%"],
  ["GC", "Gold Futures", "2 165.30", "+0.35%"],
  ["6E", "Euro FX", "1.0892", "-0.05%"],
];
const details = {
  main: {
    symbol: "ES",
    interval: "15м",
    name: "S&P 500 E-mini Futures",
    prices: ["5 100.00", "5 090.00", "5 080.00", "5 070.00", "5 060.00"],
  },
  hour: {
    symbol: "ES",
    interval: "1ч",
    name: "S&P 500 E-mini Futures — Часовой срез",
    prices: ["5 100.00", "5 080.00", "5 060.00", "5 040.00", "5 020.00"],
  },
  nasdaq: {
    symbol: "NQ",
    interval: "5м",
    name: "Nasdaq 100 E-mini Futures",
    prices: ["18 160", "18 140", "18 112.5", "18 090", "18 070"],
  },
};
const initialWindows: ChartWindow[] = [
  {
    id: 2,
    kind: "hour",
    x: 620,
    y: 32,
    width: 560,
    height: 420,
    minimized: false,
    maximized: false,
  },
  {
    id: 3,
    kind: "nasdaq",
    x: 510,
    y: 400,
    width: 660,
    height: 380,
    minimized: false,
    maximized: false,
  },
  {
    id: 1,
    kind: "main",
    x: 16,
    y: 16,
    width: 730,
    height: 570,
    minimized: false,
    maximized: false,
  },
];
function Icon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    terminal: (
      <>
        <path d="m4 5 5 5-5 5M11 15h6" />
        <rect x="1" y="1" width="20" height="20" rx="3" />
      </>
    ),
    sidebar: (
      <>
        <rect x="2" y="3" width="18" height="16" rx="2" />
        <path d="M8 3v16" />
      </>
    ),
    grid: (
      <>
        <rect x="2" y="2" width="7" height="7" />
        <rect x="13" y="2" width="7" height="7" />
        <rect x="2" y="13" width="7" height="7" />
        <rect x="13" y="13" width="7" height="7" />
      </>
    ),
    cascade: (
      <>
        <rect x="7" y="7" width="13" height="13" rx="1" />
        <path d="M15 4V2H2v13h2" />
      </>
    ),
    reset: (
      <>
        <path d="M4 7a8 8 0 1 1-1 8M4 2v5h5" />
      </>
    ),
    sun: (
      <>
        <circle cx="11" cy="11" r="4" />
        <path d="M11 1v2m0 16v2M1 11h2m16 0h2M4 4l2 2m10 10 2 2M4 18l2-2M16 6l2-2" />
      </>
    ),
    moon: <path d="M19 14A8 8 0 0 1 8 3a8 8 0 1 0 11 11Z" />,
    search: (
      <>
        <circle cx="9" cy="9" r="6" />
        <path d="m14 14 6 6" />
      </>
    ),
    chart: (
      <>
        <path d="M4 2v18m7-18v18m7-18v18" />
        <rect x="2" y="5" width="4" height="7" />
        <rect x="9" y="10" width="4" height="6" />
        <rect x="16" y="4" width="4" height="7" />
      </>
    ),
    minus: <path d="M4 11h14" />,
    maximize: <rect x="4" y="4" width="14" height="14" />,
    close: <path d="m5 5 12 12M17 5 5 17" />,
    pointer: <path d="m4 2 14 10-7 1-3 7Z" />,
    line: <path d="m3 18 16-14" />,
    level: <path d="M2 11h18" />,
    area: <rect x="3" y="4" width="16" height="14" strokeDasharray="3 2" />,
    help: (
      <>
        <rect x="1" y="4" width="20" height="14" rx="2" />
        <path d="M5 8h1m4 0h1m4 0h1M5 12h1m4 0h1m4 0h1M7 15h8" />
      </>
    ),
    plus: <path d="M11 3v16M3 11h16" />,
  };
  return (
    <svg
      className="icon"
      viewBox="0 0 22 22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.chart}
    </svg>
  );
}
function Artwork({
  kind,
  id,
}: {
  kind: keyof typeof chartArtwork;
  id: number;
}) {
  // Each window gets unique SVG pattern ids so duplicate charts remain independent.
  const markup = chartArtwork[kind].replace(
    /grid-w([123])/g,
    "grid-" + id + "-$1",
  );
  return (
    <div className="artwork" dangerouslySetInnerHTML={{ __html: markup }} />
  );
}
function validWindows(value: unknown): value is ChartWindow[] {
  return (
    Array.isArray(value) &&
    value.length <= 20 &&
    new Set(value.map((w) => w?.id)).size === value.length &&
    value.every(
      (w) =>
        w &&
        Number.isSafeInteger(w.id) &&
        w.id > 0 &&
        ["main", "hour", "nasdaq"].includes(w.kind) &&
        ["x", "y", "width", "height"].every(
          (k) => typeof w[k] === "number" && Number.isFinite(w[k]),
        ) &&
        w.width >= 480 &&
        w.height >= 360 &&
        typeof w.minimized === "boolean" &&
        typeof w.maximized === "boolean",
    )
  );
}

function createWorkspaceStore() {
  const serverSnapshot = {
    theme: "dark" as Theme,
    windows: initialWindows,
    sidebar: true,
    ready: false,
    storageAvailable: true,
    recoveryWarning: false,
  };
  let snapshot = serverSnapshot;
  const listeners = new Set<() => void>();

  function save(next: typeof snapshot) {
    let storageAvailable = true;
    try {
      const { theme, windows, sidebar } = next;
      localStorage.setItem(STORAGE, JSON.stringify({ theme, windows, sidebar }));
    } catch {
      storageAvailable = false;
    }
    snapshot = { ...next, storageAvailable };
    listeners.forEach((listener) => listener());
  }

  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => serverSnapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      // Load only after hydration; StrictMode resubscriptions keep this snapshot.
      if (!snapshot.ready) {
        let next = { ...snapshot, ready: true };
        try {
          const saved = localStorage.getItem(STORAGE);
          if (saved) {
            const data = JSON.parse(saved);
            if (
              !validWindows(data.windows) ||
              !["dark", "light"].includes(data.theme) ||
              typeof data.sidebar !== "boolean"
            )
              throw new Error("Invalid workspace");
            next = {
              ...next,
              windows: data.windows,
              theme: data.theme,
              sidebar: data.sidebar,
            };
          } else {
            next.theme = matchMedia("(prefers-color-scheme: dark)").matches
              ? "dark"
              : "light";
          }
        } catch {
          next.recoveryWarning = true;
          next.theme = document.documentElement.dataset.theme === "light"
            ? "light"
            : "dark";
        }
        save(next);
      }
      return () => {
        listeners.delete(listener);
      };
    },
    setTheme(theme: Theme) {
      save({ ...snapshot, theme });
    },
    setSidebar(sidebar: boolean) {
      save({ ...snapshot, sidebar });
    },
    setWindows(value: ChartWindow[] | ((items: ChartWindow[]) => ChartWindow[])) {
      const windows = typeof value === "function" ? value(snapshot.windows) : value;
      save({ ...snapshot, windows });
    },
    reset() {
      save({ ...snapshot, windows: initialWindows, recoveryWarning: false });
    },
  };
}

export default function Terminal() {
  const [workspace] = useState(createWorkspaceStore);
  const { theme, windows, sidebar, ready, storageAvailable, recoveryWarning } =
    useSyncExternalStore(
      workspace.subscribe,
      workspace.getSnapshot,
      workspace.getServerSnapshot,
    );
  const { setTheme, setWindows, setSidebar } = workspace;
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("ES");
  const saveStatus = !ready
    ? "Загрузка рабочего места…"
    : !storageAvailable
      ? "Настройки не сохраняются на этом устройстве"
      : recoveryWarning
        ? "Не удалось восстановить настройки; открыт макет"
        : "Настройки сохранены локально";
  const [dialog, setDialog] = useState<"help" | number | null>(null);
  const [undo, setUndo] = useState<ChartWindow | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const modal = useRef<HTMLDialogElement>(null);
  const [size, setSize] = useState({ width: 1200, height: 820 });
  const gesture = useRef<{
    id: number;
    mode: "move" | "resize";
    startX: number;
    startY: number;
    original: ChartWindow;
  } | null>(null);
  const active = windows.filter((w) => !w.minimized).at(-1)?.id;

  useLayoutEffect(() => {
    if (ready) document.documentElement.dataset.theme = theme;
  }, [ready, theme]);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), 10000);
    return () => clearTimeout(timer);
  }, [undo]);
  useEffect(() => {
    if (dialog !== null) modal.current?.showModal();
    else modal.current?.close();
  }, [dialog]);

  function update(id: number, patch: Partial<ChartWindow>) {
    setWindows((items) =>
      items.map((w) => (w.id === id ? { ...w, ...patch } : w)),
    );
  }
  function focus(id: number) {
    setWindows((items) =>
      items.at(-1)?.id === id
        ? items
        : [...items.filter((w) => w.id !== id), ...items.filter((w) => w.id === id)],
    );
  }
  function open(kind: Kind) {
    if (windows.length >= 20) return;
    const template = initialWindows.find((w) => w.kind === kind)!;
    setWindows((items) => [
      ...items,
      {
        ...template,
        id: Math.max(Date.now(), ...items.map((item) => item.id + 1)),
        x: 24 + items.length * 18,
        y: 24 + items.length * 18,
      },
    ]);
  }
  function arrange(mode: "tile" | "cascade") {
    const visible = windows.filter((w) => !w.minimized);
    const cols = Math.max(1, Math.floor(size.width / 480));
    const rows = Math.ceil(visible.length / cols);
    if (mode === "tile" && rows * 360 > size.height) return;
    setWindows((items) => {
      let index = 0;
      return items.map((w) => {
        if (w.minimized) return w;
        const n = index++;
        return mode === "tile"
          ? {
              ...w,
              maximized: false,
              x: ((n % cols) * size.width) / cols,
              y: (Math.floor(n / cols) * size.height) / rows,
              width: size.width / cols,
              height: size.height / rows,
            }
          : { ...w, maximized: false, x: 16 + n * 36, y: 16 + n * 36 };
      });
    });
  }
  function startGesture(
    event: PointerEvent<HTMLElement>,
    win: ChartWindow,
    mode: "move" | "resize",
  ) {
    if (win.maximized || (event.target as HTMLElement).closest("button"))
      return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = {
      id: win.id,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      original: win,
    };
    focus(win.id);
  }
  function moveGesture(event: PointerEvent<HTMLElement>) {
    const g = gesture.current;
    if (!g) return;
    const dx = event.clientX - g.startX,
      dy = event.clientY - g.startY;
    const next =
      g.mode === "move"
        ? {
            x: Math.max(0, Math.min(size.width - 120, g.original.x + dx)),
            y: Math.max(0, Math.min(size.height - 32, g.original.y + dy)),
          }
        : {
            width: Math.max(
              480,
              Math.min(size.width - g.original.x, g.original.width + dx),
            ),
            height: Math.max(
              360,
              Math.min(size.height - g.original.y, g.original.height + dy),
            ),
          };
    update(g.id, next);
  }
  const filtered = instruments.filter((row) =>
    (row[0] + " " + row[1]).toLowerCase().includes(query.toLowerCase()),
  );
  const canTile =
    Math.ceil(
      windows.filter((w) => !w.minimized).length /
        Math.max(1, Math.floor(size.width / 480)),
    ) *
      360 <=
    size.height;
  const target =
    typeof dialog === "number" ? windows.find((w) => w.id === dialog) : null;
  return (
    <div className={"terminal " + theme} data-theme={theme}>
      <div className="small-screen">
        <Icon name="chart" />
        <h1>Z-Trader AI</h1>
        <p>Для работы с графиками расширьте окно браузера</p>
        <span>Минимальный размер — 1024 × 720</span>
      </div>
      <div className="desktop">
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark">
              <Icon name="terminal" />
            </span>
            Z-Trader <b>AI</b>
          </div>
          <button
            className="icon-button"
            title="Список инструментов"
            aria-label="Список инструментов"
            aria-expanded={sidebar}
            onClick={() => setSidebar(!sidebar)}
          >
            <Icon name="sidebar" />
          </button>
          <span className="divider" />
          <button
            onClick={() => arrange("tile")}
            disabled={!canTile}
            title={
              canTile
                ? "Расположить окна рядом"
                : "Окна не помещаются: сверните часть окон"
            }
          >
            <Icon name="grid" />
            Рядом
          </button>
          <button onClick={() => arrange("cascade")}>
            <Icon name="cascade" />
            Каскадом
          </button>
          <button onClick={workspace.reset}>
            <Icon name="reset" />
            Сбросить вид
          </button>
          <div className="demo-label">
            <i />
            Демонстрационные данные · UTC
          </div>
          <div className="theme-switch" aria-label="Тема оформления">
            <button
              aria-pressed={theme === "dark"}
              onClick={() => setTheme("dark")}
            >
              <Icon name="moon" />
              Тёмная
            </button>
            <button
              aria-pressed={theme === "light"}
              onClick={() => setTheme("light")}
            >
              <Icon name="sun" />
              Светлая
            </button>
          </div>
          <button
            className="icon-button"
            aria-label="Справка"
            onClick={() => setDialog("help")}
          >
            <Icon name="help" />
          </button>
        </header>
        <div className="workbench">
          {sidebar && (
            <aside className="watchlist">
              <label className="search">
                <Icon name="search" />
                <input
                  aria-label="Поиск инструмента"
                  placeholder="Поиск инструмента…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <div className="list-heading">
                <span>СИМВОЛ</span>
                <span>ПОСЛЕДНЯЯ / ИЗМ</span>
              </div>
              <div className="instrument-list">
                {filtered.map(([symbol, name, price, change]) => (
                  <button
                    key={symbol}
                    className={
                      "instrument " + (selected === symbol ? "selected" : "")
                    }
                    onClick={() => setSelected(symbol)}
                    onDoubleClick={() => {
                      if (symbol === "ES" || symbol === "NQ")
                        open(symbol === "ES" ? "main" : "nasdaq");
                    }}
                    onKeyDown={(e) => {
                      if (
                        e.key === "Enter" &&
                        (symbol === "ES" || symbol === "NQ")
                      ) {
                        e.preventDefault();
                        open(symbol === "ES" ? "main" : "nasdaq");
                      }
                    }}
                  >
                    <span>
                      <strong>{symbol}</strong>
                      <small>{name}</small>
                    </span>
                    <span className="quote">
                      <strong>{price}</strong>
                      <small className={change.startsWith("+") ? "up" : "down"}>
                        {change}
                      </small>
                    </span>
                  </button>
                ))}
                {filtered.length === 0 && (
                  <div className="no-results">
                    Инструменты не найдены
                    <button onClick={() => setQuery("")}>Очистить поиск</button>
                  </div>
                )}
              </div>
              <div className="watchlist-bottom">
                <button
                  className="primary"
                  disabled={
                    !["ES", "NQ"].includes(selected) || windows.length >= 20
                  }
                  onClick={() => open(selected === "ES" ? "main" : "nasdaq")}
                >
                  <Icon name="plus" />
                  Открыть график
                </button>
                {!["ES", "NQ"].includes(selected) && (
                  <small>В макете доступны графики ES и NQ</small>
                )}
              </div>
            </aside>
          )}
          <main className="workspace">
            <div className="workspace-heading">
              <span>
                <i />
                ПРОСТРАНСТВО 01{" "}
                <span className="muted">Мульти-таймфрейм анализ фьючерсов</span>
              </span>
              <span className="muted">ES / NQ · Демо</span>
            </div>
            <div className="canvas" ref={canvas}>
              {!windows.some((w) => !w.minimized) && (
                <div className="empty">
                  <Icon name="chart" />
                  <p>Откройте инструмент из списка слева</p>
                  <button onClick={() => setSidebar(true)}>
                    Показать инструменты
                  </button>
                </div>
              )}
              {/* Keep DOM order stable while a window holds pointer capture. */}
              {[...windows].sort((a, b) => a.id - b.id).map((win) => {
                if (win.minimized) return null;
                const index = windows.indexOf(win);
                const info = details[win.kind];
                const width = Math.min(win.width, size.width);
                const height = Math.min(win.height, size.height);
                const x = Math.max(0, Math.min(win.x, size.width - width));
                const y = Math.max(0, Math.min(win.y, size.height - height));
                const style = win.maximized
                  ? { inset: 0, zIndex: index + 1 }
                  : { left: x, top: y, width, height, zIndex: index + 1 };
                return (
                  <section
                    key={win.id}
                    className={
                      "chart-window " + (active === win.id ? "active" : "")
                    }
                    style={style}
                    aria-label={info.symbol + " · " + info.interval}
                    onPointerDown={() => focus(win.id)}
                  >
                    <div
                      className="window-title"
                      onPointerDown={(e) =>
                        startGesture(e, { ...win, x, y }, "move")
                      }
                      onPointerMove={moveGesture}
                      onPointerUp={() => (gesture.current = null)}
                      onPointerCancel={() => (gesture.current = null)}
                      onDoubleClick={(e) => {
                        if (!(e.target as HTMLElement).closest("button"))
                          update(win.id, { maximized: !win.maximized });
                      }}
                      tabIndex={0}
                      title="Перетащите окно. Стрелки — переместить, Shift + стрелки — изменить размер."
                      onKeyDown={(e) => {
                        if (
                          ![
                            "ArrowLeft",
                            "ArrowRight",
                            "ArrowUp",
                            "ArrowDown",
                          ].includes(e.key) ||
                          win.maximized
                        )
                          return;
                        e.preventDefault();
                        const dx =
                            e.key === "ArrowLeft"
                              ? -10
                              : e.key === "ArrowRight"
                                ? 10
                                : 0,
                          dy =
                            e.key === "ArrowUp"
                              ? -10
                              : e.key === "ArrowDown"
                                ? 10
                                : 0;
                        update(
                          win.id,
                          e.shiftKey
                            ? {
                                width: Math.max(
                                  480,
                                  Math.min(size.width - x, width + dx),
                                ),
                                height: Math.max(
                                  360,
                                  Math.min(size.height - y, height + dy),
                                ),
                              }
                            : {
                                x: Math.max(
                                  0,
                                  Math.min(size.width - width, x + dx),
                                ),
                                y: Math.max(
                                  0,
                                  Math.min(size.height - height, y + dy),
                                ),
                              },
                        );
                      }}
                    >
                      <Icon name="chart" />
                      <strong>
                        {info.symbol} · {info.interval}{" "}
                        <span>({info.name})</span>
                      </strong>
                      {active === win.id && (
                        <span className="focus-badge">Фокус</span>
                      )}
                      <div className="window-actions">
                        <button
                          aria-label={
                            "Свернуть " + info.symbol + " " + info.interval
                          }
                          onClick={() => update(win.id, { minimized: true })}
                        >
                          <Icon name="minus" />
                        </button>
                        <button
                          aria-label={
                            (win.maximized ? "Восстановить " : "Развернуть ") +
                            info.symbol +
                            " " +
                            info.interval
                          }
                          onClick={() =>
                            update(win.id, { maximized: !win.maximized })
                          }
                        >
                          <Icon name="maximize" />
                        </button>
                        <button
                          aria-label={
                            "Закрыть " + info.symbol + " " + info.interval
                          }
                          onClick={() => {
                            setUndo(win);
                            setWindows((items) =>
                              items.filter((w) => w.id !== win.id),
                            );
                          }}
                        >
                          <Icon name="close" />
                        </button>
                      </div>
                    </div>
                    <div className="chart-toolbar">
                      <div className="intervals">
                        {["1м", "5м", "15м", "1ч", "4ч", "1д"].map(
                          (interval) => {
                            const available =
                              info.symbol === "ES"
                                ? ["15м", "1ч"].includes(interval)
                                : interval === "5м";
                            return (
                              <button
                                key={interval}
                                className={
                                  info.interval === interval ? "chosen" : ""
                                }
                                disabled={!available}
                                title={
                                  !available
                                    ? "Для этого интервала нет макета"
                                    : "Показать демонстрационный срез " +
                                      interval
                                }
                                onClick={() =>
                                  update(win.id, {
                                    kind:
                                      info.symbol === "NQ"
                                        ? "nasdaq"
                                        : interval === "1ч"
                                          ? "hour"
                                          : "main",
                                  })
                                }
                              >
                                {interval}
                              </button>
                            );
                          },
                        )}
                      </div>
                      <span className="divider" />
                      <button onClick={() => setDialog(win.id)}>
                        <b>ƒ(x)</b> Индикаторы
                        {win.kind === "main"
                          ? " (3)"
                          : win.kind === "nasdaq"
                            ? " (1)"
                            : ""}
                      </button>
                      <span className="drawing-tools">
                        <span className="divider" />
                        <button className="chosen" title="Указатель">
                          <Icon name="pointer" />
                        </button>
                        {["line", "level", "area"].map((name) => (
                          <button
                            key={name}
                            disabled
                            title="Редактирование разметки будет добавлено при подключении графического движка"
                          >
                            <Icon name={name} />
                          </button>
                        ))}
                      </span>
                    </div>
                    <div className="ohlc">
                      {win.kind === "nasdaq" ? (
                        <>
                          NQ: <span>18 112.50</span>{" "}
                          <span className="down">−0.18%</span>
                        </>
                      ) : win.kind === "hour" ? (
                        <>
                          O: <span>5 072.00</span> H: <span>5 088.50</span> L:{" "}
                          <span>5 066.25</span> C:{" "}
                          <span className="up">5 084.25 (+0.54%)</span>
                        </>
                      ) : (
                        <>
                          O: <span>5 081.50</span> H: <span>5 086.75</span> L:{" "}
                          <span>5 079.25</span> C:{" "}
                          <span className="up">5 084.25 (+0.42%)</span>
                        </>
                      )}
                    </div>
                    {win.kind === "main" && (
                      <div className="legend">
                        <span className="sma">SMA (20, close): 5 076.40</span>
                        <span className="ema">EMA (50, close): 5 068.10</span>
                      </div>
                    )}
                    <div className="price-chart">
                      <Artwork kind={win.kind} id={win.id} />
                      <div className="price-axis">
                        {info.prices.map((p) => (
                          <span key={p}>{p}</span>
                        ))}
                      </div>
                      {win.kind === "main" && (
                        <>
                          <div className="price-marker">5 084.25</div>
                          <div className="time-marker">14:45 UTC</div>
                        </>
                      )}
                    </div>
                    <div className="time-axis">
                      {(win.kind === "hour"
                        ? ["04 Мар", "05 Мар", "06 Мар", "07 Мар", "08 Мар"]
                        : ["10:00", "11:00", "12:00", "13:00", "14:00"]
                      ).map((t) => (
                        <span key={t}>{t}</span>
                      ))}
                      <span>UTC</span>
                    </div>
                    {win.kind !== "hour" && (
                      <div className="indicator-panel">
                        <div className="indicator-heading">
                          {win.kind === "main" ? (
                            <>
                              Объём: <span className="up">14.82K</span>
                              <span className="muted">SMA(20): 11.45K</span>
                            </>
                          ) : (
                            <span className="rsi">RSI (14, close): 62.4</span>
                          )}
                          <span className="indicator-note">Иллюстрация</span>
                        </div>
                        <div className="indicator-chart">
                          <Artwork
                            kind={win.kind === "main" ? "volume" : "rsi"}
                            id={win.id}
                          />
                          <div className="price-axis">
                            {(win.kind === "main"
                              ? ["25.0K", "14.8K", "5.0K"]
                              : ["70.0", "50.0", "30.0"]
                            ).map((p) => (
                              <span key={p}>{p}</span>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                    {!win.maximized && (
                      <div
                        className="resize-handle"
                        title="Изменить размер"
                        onPointerDown={(e) =>
                          startGesture(
                            e,
                            { ...win, x, y, width, height },
                            "resize",
                          )
                        }
                        onPointerMove={moveGesture}
                        onPointerUp={() => (gesture.current = null)}
                        onPointerCancel={() => (gesture.current = null)}
                      />
                    )}
                  </section>
                );
              })}
            </div>
          </main>
        </div>
        <footer className="statusbar">
          <div className="minimized">
            <span>ОКНА:</span>
            {windows
              .filter((w) => w.minimized)
              .map((w) => (
                <button
                  key={w.id}
                  onClick={() => {
                    update(w.id, { minimized: false });
                    focus(w.id);
                  }}
                >
                  <Icon name="chart" />
                  {details[w.kind].symbol} · {details[w.kind].interval}
                </button>
              ))}
          </div>
          <span role="status">
            <i className={storageAvailable ? "" : "warning"} />
            {saveStatus}
          </span>
          <span className="muted">Демо · Без подключения к рынку</span>
        </footer>
        {undo && (
          <div className="toast" role="status">
            Окно закрыто
            <button
              onClick={() => {
                setWindows((items) => [...items, undo]);
                setUndo(null);
              }}
            >
              Вернуть окно
            </button>
          </div>
        )}
        <dialog
          ref={modal}
          onCancel={() => setDialog(null)}
          onClick={(e) => {
            if (e.target === e.currentTarget) setDialog(null);
          }}
        >
          <div className="dialog-title">
            <h2>
              {dialog === "help"
                ? "О демонстрационном терминале"
                : "Индикаторы · " +
                  (target
                    ? details[target.kind].symbol +
                      " " +
                      details[target.kind].interval
                    : "")}
            </h2>
            <button
              autoFocus
              aria-label="Закрыть диалог"
              onClick={() => setDialog(null)}
            >
              <Icon name="close" />
            </button>
          </div>
          {dialog === "help" ? (
            <div className="dialog-content">
              <p>
                Перенос макетов Stitch. Свечи и значения — иллюстрации,
                сохранённые в исходном дизайне.
              </p>
              <p>
                Работают темы, поиск, открытие графиков ES и NQ, расположение,
                перемещение, изменение размера и сворачивание окон.
              </p>
              <p>
                Перемещайте окно за заголовок, меняйте размер за правый нижний
                угол. Двойной щелчок по заголовку разворачивает окно. На
                заголовке также работают стрелки; Shift + стрелки меняют размер.
              </p>
              <p>
                Для ES доступны два демонстрационных среза: 15 минут и 1 час.
                Динамические графики, расчёт индикаторов и редактирование
                разметки — следующий этап.
              </p>
            </div>
          ) : (
            <div className="dialog-content">
              <p className="muted">Индикаторы, показанные в этом макете:</p>
              {(target?.kind === "main"
                ? [
                    "SMA · период 20 · закрытие",
                    "EMA · период 50 · закрытие",
                    "Объём",
                  ]
                : target?.kind === "nasdaq"
                  ? ["RSI · период 14 · уровни 30 / 70"]
                  : []
              ).map((name) => (
                <div className="indicator-row" key={name}>
                  <Icon name="chart" />
                  {name}
                </div>
              ))}
              {target?.kind === "hour" && <p>В этом срезе индикаторов нет.</p>}
              <p className="muted">
                Значения взяты из макета Stitch. Изменение параметров станет
                доступно после подключения расчётов и данных.
              </p>
            </div>
          )}
          <div className="dialog-footer">
            <button className="primary" onClick={() => setDialog(null)}>
              Понятно
            </button>
          </div>
        </dialog>
      </div>
    </div>
  );
}
