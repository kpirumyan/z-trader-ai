import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CURRENT_WORKSPACE_VERSION,
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_KIND_LABELS,
  DEFAULT_WINDOW_WIDTH,
  DEFAULT_WORKSPACE_ID,
  EMPTY_WORKSPACE_INSTRUCTION,
  EMPTY_WORKSPACE_TITLE,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  MINIMIZED_WINDOW_GAP,
  MINIMIZED_WINDOW_HEIGHT,
  MINIMIZED_WINDOW_MARGIN,
  MINIMIZED_WINDOW_WIDTH,
  WINDOW_CASCADE_MAX_SLOTS,
  WINDOW_CASCADE_OFFSET,
  WINDOW_CASCADE_STEP,
  WORKSPACE_STORAGE_KEY,
  windowPositionSchema,
  windowSizeSchema,
  workspaceInstrumentSchema,
  workspaceRecordSchema,
  workspaceStorageSchema,
  workspaceWindowSchema,
  useWorkspaceStore,
  type WindowPosition,
  type WindowSize,
  type WorkspaceStorageEnvelope,
  type WorkspaceWindow,
} from "@/src/modules/workspace";
import { safeStorage } from "@/src/shared/storage";

import type { Instrument } from "@/src/shared/contracts";

const appleInstrument: Instrument = {
  symbol: "AAPL",
  name: "Apple Inc.",
};

const microsoftInstrument: Instrument = {
  symbol: "MSFT",
  name: "Microsoft Corp.",
};

const spFuturesInstrument: Instrument = {
  symbol: "ES",
  name: "E-mini S&P 500",
};

describe("Workspace Schema Validation", () => {
  it("validates windowPositionSchema with non-negative integers", () => {
    expect(windowPositionSchema.safeParse({ x: 0, y: 0 }).success).toBe(true);
    expect(windowPositionSchema.safeParse({ x: 16, y: 32 }).success).toBe(true);
    expect(windowPositionSchema.safeParse({ x: -1, y: 10 }).success).toBe(false);
    expect(windowPositionSchema.safeParse({ x: 10.5, y: 10 }).success).toBe(false);
  });

  it("validates windowSizeSchema enforcing minimum dimensions", () => {
    expect(windowSizeSchema.safeParse({ width: 380, height: 440 }).success).toBe(true);
    expect(windowSizeSchema.safeParse({ width: 199, height: 440 }).success).toBe(false);
    expect(windowSizeSchema.safeParse({ width: 380, height: 149 }).success).toBe(false);
  });

  it("validates workspaceInstrumentSchema", () => {
    expect(workspaceInstrumentSchema.safeParse(appleInstrument).success).toBe(true);
    expect(workspaceInstrumentSchema.safeParse({ symbol: "", name: "Apple" }).success).toBe(false);
    expect(workspaceInstrumentSchema.safeParse({ symbol: "AAPL", name: "" }).success).toBe(false);
  });

  it("validates workspaceWindowSchema", () => {
    const validWindow: WorkspaceWindow = {
      id: "win-1",
      kind: "chart",
      instrument: appleInstrument,
      position: { x: 16, y: 16 },
      size: { width: 380, height: 440 },
      zIndex: 1,
    };

    expect(workspaceWindowSchema.safeParse(validWindow).success).toBe(true);

    const invalidKind = {
      ...validWindow,
      kind: "invalidKind",
    };

    expect(workspaceWindowSchema.safeParse(invalidKind).success).toBe(false);
  });

  it("validates workspaceWindowSchema with optional isMinimized flag", () => {
    const validWindow: WorkspaceWindow = {
      id: "win-1",
      kind: "chart",
      instrument: appleInstrument,
      position: { x: 16, y: 16 },
      size: { width: 380, height: 440 },
      zIndex: 1,
      isMinimized: true,
    };

    expect(workspaceWindowSchema.safeParse(validWindow).success).toBe(true);

    const validUnminimized: WorkspaceWindow = {
      ...validWindow,
      isMinimized: false,
    };

    expect(workspaceWindowSchema.safeParse(validUnminimized).success).toBe(true);

    const invalidMinimizedType = {
      ...validWindow,
      isMinimized: "not-a-boolean",
    };

    expect(workspaceWindowSchema.safeParse(invalidMinimizedType).success).toBe(false);
  });

  it("validates workspaceRecordSchema", () => {
    const validRecord = {
      id: "workspace-1",
      title: "Main Layout",
      windows: [
        {
          id: "win-1",
          kind: "chart" as const,
          instrument: appleInstrument,
          position: { x: 16, y: 16 },
          zIndex: 1,
        },
      ],
    };

    expect(workspaceRecordSchema.safeParse(validRecord).success).toBe(true);
  });

  it("validates workspaceStorageSchema envelope", () => {
    const validEnvelope: WorkspaceStorageEnvelope = {
      version: 1,
      activeWorkspaceId: DEFAULT_WORKSPACE_ID,
      workspaces: [
        {
          id: DEFAULT_WORKSPACE_ID,
          title: "Default",
          windows: [
            {
              id: "win-1",
              kind: "chart",
              instrument: appleInstrument,
              position: { x: 16, y: 16 },
              zIndex: 1,
            },
          ],
        },
      ],
    };

    expect(workspaceStorageSchema.safeParse(validEnvelope).success).toBe(true);

    const invalidVersion = {
      ...validEnvelope,
      version: 2,
    };

    expect(workspaceStorageSchema.safeParse(invalidVersion).success).toBe(false);

    const emptyWorkspaces = {
      ...validEnvelope,
      workspaces: [],
    };

    expect(workspaceStorageSchema.safeParse(emptyWorkspaces).success).toBe(false);
  });
});

describe("Workspace Constants", () => {
  it("exposes expected layout and persistence constants", () => {
    expect(WORKSPACE_STORAGE_KEY).toBe("z-trader.workspace");
    expect(CURRENT_WORKSPACE_VERSION).toBe(1);
    expect(DEFAULT_WORKSPACE_ID).toBe("default");
    expect(WINDOW_CASCADE_OFFSET).toBe(16);
    expect(WINDOW_CASCADE_STEP).toBe(32);
    expect(WINDOW_CASCADE_MAX_SLOTS).toBe(8);
    expect(DEFAULT_WINDOW_WIDTH).toBe(380);
    expect(DEFAULT_WINDOW_HEIGHT).toBe(440);
    expect(MIN_WINDOW_WIDTH).toBe(260);
    expect(MIN_WINDOW_HEIGHT).toBe(180);
    expect(MINIMIZED_WINDOW_WIDTH).toBe(180);
    expect(MINIMIZED_WINDOW_HEIGHT).toBe(28);
    expect(MINIMIZED_WINDOW_GAP).toBe(6);
    expect(MINIMIZED_WINDOW_MARGIN).toBe(8);
    expect(DEFAULT_WINDOW_KIND_LABELS.chart).toBe("Chart");
    expect(DEFAULT_WINDOW_KIND_LABELS.orderBook).toBe("Level II");
    expect(DEFAULT_WINDOW_KIND_LABELS.timeAndSales).toBe("T & S");
    expect(EMPTY_WORKSPACE_TITLE).toBe("Your workspace is empty");
    expect(EMPTY_WORKSPACE_INSTRUCTION).toBe("Use New to open a Chart, Level II, or T & S window.");
  });
});

describe("useWorkspaceStore (Unit)", () => {
  beforeEach(() => {
    safeStorage.clear();
    useWorkspaceStore.getState().resetWorkspace();
  });

  afterEach(() => {
    safeStorage.clear();
  });

  it("initializes with an empty window list and null activeWindowId", () => {
    const state = useWorkspaceStore.getState();

    expect(state.windows).toEqual([]);
    expect(state.activeWindowId).toBeNull();
  });

  it("Scenario 2: adds a window with cascading placement at slot 0", () => {
    const store = useWorkspaceStore.getState();
    const windowId = store.addWindow("chart", appleInstrument);

    expect(windowId).toBeTruthy();

    const updated = useWorkspaceStore.getState();

    expect(updated.windows).toHaveLength(1);
    expect(updated.activeWindowId).toBe(windowId);

    const created = updated.windows[0];

    expect(created.id).toBe(windowId);
    expect(created.kind).toBe("chart");
    expect(created.instrument).toEqual(appleInstrument);

    expect(created.position).toEqual({
      x: WINDOW_CASCADE_OFFSET,
      y: WINDOW_CASCADE_OFFSET,
    });

    expect(created.zIndex).toBe(1);
  });

  it("Scenario 3: assigns cyclic cascade offsets for multiple windows", () => {
    const store = useWorkspaceStore.getState();
    const createdIds: string[] = [];

    for (let slot = 0; slot < WINDOW_CASCADE_MAX_SLOTS; slot += 1) {
      const id = store.addWindow("orderBook", spFuturesInstrument);

      createdIds.push(id);
    }

    const stateAfter8 = useWorkspaceStore.getState();

    expect(stateAfter8.windows).toHaveLength(8);

    for (let index = 0; index < WINDOW_CASCADE_MAX_SLOTS; index += 1) {
      const windowItem = stateAfter8.windows[index];
      const expectedOffset = WINDOW_CASCADE_OFFSET + index * WINDOW_CASCADE_STEP;

      expect(windowItem.position).toEqual({
        x: expectedOffset,
        y: expectedOffset,
      });

      expect(windowItem.zIndex).toBe(index + 1);
    }

    // Adding the 9th window wraps around (8 % 8 = 0)
    const ninthId = store.addWindow("timeAndSales", appleInstrument);
    const stateAfter9 = useWorkspaceStore.getState();

    expect(stateAfter9.windows).toHaveLength(9);

    const ninthWindow = stateAfter9.windows.find((windowItem) => windowItem.id === ninthId);

    expect(ninthWindow).toBeDefined();

    expect(ninthWindow?.position).toEqual({
      x: WINDOW_CASCADE_OFFSET,
      y: WINDOW_CASCADE_OFFSET,
    });

    expect(ninthWindow?.zIndex).toBe(9);
    expect(stateAfter9.activeWindowId).toBe(ninthId);
  });

  it("Scenario 4: elevates zIndex and updates activeWindowId on focusWindow", () => {
    const store = useWorkspaceStore.getState();
    const id1 = store.addWindow("chart", appleInstrument);
    const id2 = store.addWindow("orderBook", spFuturesInstrument);

    let state = useWorkspaceStore.getState();

    expect(state.activeWindowId).toBe(id2);

    const win1Before = state.windows.find((windowItem) => windowItem.id === id1);
    const win2Before = state.windows.find((windowItem) => windowItem.id === id2);

    expect(win1Before?.zIndex).toBe(1);
    expect(win2Before?.zIndex).toBe(2);

    store.focusWindow(id1);

    state = useWorkspaceStore.getState();
    expect(state.activeWindowId).toBe(id1);

    const win1After = state.windows.find((windowItem) => windowItem.id === id1);
    const win2After = state.windows.find((windowItem) => windowItem.id === id2);

    expect(win1After?.zIndex).toBe(3);
    expect(win2After?.zIndex).toBe(2);

    // Focusing the same active window again is idempotent
    store.focusWindow(id1);

    const stateIdempotent = useWorkspaceStore.getState();

    expect(stateIdempotent.windows.find((windowItem) => windowItem.id === id1)?.zIndex).toBe(3);
  });

  it("Scenario 1 (focus-management): blurs active window via blurWindow, setting activeWindowId to null while preserving window geometry and zIndices", () => {
    const store = useWorkspaceStore.getState();
    const id1 = store.addWindow("chart", appleInstrument);
    const id2 = store.addWindow("orderBook", spFuturesInstrument);

    let state = useWorkspaceStore.getState();

    expect(state.windows).toHaveLength(2);
    expect(state.activeWindowId).toBe(id2);

    const win1Before = state.windows.find((windowItem) => windowItem.id === id1);
    const win2Before = state.windows.find((windowItem) => windowItem.id === id2);

    expect(win1Before?.zIndex).toBe(1);
    expect(win2Before?.zIndex).toBe(2);

    // Dispatches blurWindow action
    store.blurWindow();

    state = useWorkspaceStore.getState();

    // activeWindowId is reset to null
    expect(state.activeWindowId).toBeNull();
    // windows list is preserved
    expect(state.windows).toHaveLength(2);

    const win1After = state.windows.find((windowItem) => windowItem.id === id1);
    const win2After = state.windows.find((windowItem) => windowItem.id === id2);

    expect(win1After?.position).toEqual(win1Before?.position);
    expect(win1After?.zIndex).toBe(win1Before?.zIndex);
    expect(win2After?.position).toEqual(win2Before?.position);
    expect(win2After?.zIndex).toBe(win2Before?.zIndex);

    // Idempotent: repeated blurWindow call leaves state intact
    store.blurWindow();

    const stateAfterSecondBlur = useWorkspaceStore.getState();

    expect(stateAfterSecondBlur.activeWindowId).toBeNull();
    expect(stateAfterSecondBlur.windows).toHaveLength(2);
  });

  it("Scenario 5: closes an active window and falls back to window with highest remaining zIndex", () => {
    const store = useWorkspaceStore.getState();
    const idA = store.addWindow("chart", appleInstrument);
    const idB = store.addWindow("orderBook", spFuturesInstrument);
    const idC = store.addWindow("timeAndSales", microsoftInstrument);

    let state = useWorkspaceStore.getState();

    expect(state.windows).toHaveLength(3);
    expect(state.activeWindowId).toBe(idC);

    store.closeWindow(idC);

    state = useWorkspaceStore.getState();
    expect(state.windows).toHaveLength(2);
    expect(state.windows.some((windowItem) => windowItem.id === idC)).toBe(false);
    expect(state.activeWindowId).toBe(idB);

    // Closing the remaining active window falls back to idA
    store.closeWindow(idB);
    state = useWorkspaceStore.getState();
    expect(state.windows).toHaveLength(1);
    expect(state.activeWindowId).toBe(idA);

    // Closing the final window leaves activeWindowId as null
    store.closeWindow(idA);
    state = useWorkspaceStore.getState();
    expect(state.windows).toHaveLength(0);
    expect(state.activeWindowId).toBeNull();
  });

  it("Scenario 5 edge case: closing an inactive window keeps the current activeWindowId intact", () => {
    const store = useWorkspaceStore.getState();
    const idA = store.addWindow("chart", appleInstrument);
    const idB = store.addWindow("orderBook", spFuturesInstrument);

    expect(useWorkspaceStore.getState().activeWindowId).toBe(idB);

    store.closeWindow(idA);

    const state = useWorkspaceStore.getState();

    expect(state.windows).toHaveLength(1);
    expect(state.activeWindowId).toBe(idB);
  });

  it("Scenario 6: clamps window move coordinates to non-negative values", () => {
    const store = useWorkspaceStore.getState();
    const id = store.addWindow("chart", appleInstrument);

    store.moveWindow(id, { x: -50, y: -20 });

    let state = useWorkspaceStore.getState();
    let target = state.windows.find((windowItem) => windowItem.id === id);

    expect(target?.position).toEqual({ x: 0, y: 0 });

    store.moveWindow(id, { x: 120, y: 80 });

    state = useWorkspaceStore.getState();
    target = state.windows.find((windowItem) => windowItem.id === id);

    expect(target?.position).toEqual({ x: 120, y: 80 });
  });

  it("resizes window coordinates via resizeWindow", () => {
    const store = useWorkspaceStore.getState();
    const id = store.addWindow("chart", appleInstrument);

    const newSize: WindowSize = { width: 500, height: 400 };

    store.resizeWindow(id, newSize);

    const state = useWorkspaceStore.getState();
    const target = state.windows.find((windowItem) => windowItem.id === id);

    expect(target?.size).toEqual(newSize);
  });

  it("Scenario 10: updates instrument on changeInstrument while preserving geometry and zIndex", () => {
    const store = useWorkspaceStore.getState();
    const id = store.addWindow("chart", appleInstrument);

    const originalPosition: WindowPosition = { x: 100, y: 150 };

    store.moveWindow(id, originalPosition);

    const beforeState = useWorkspaceStore.getState();
    const beforeWindow = beforeState.windows.find((windowItem) => windowItem.id === id);

    expect(beforeWindow?.instrument).toEqual(appleInstrument);

    store.changeInstrument(id, microsoftInstrument);

    const afterState = useWorkspaceStore.getState();
    const afterWindow = afterState.windows.find((windowItem) => windowItem.id === id);

    expect(afterWindow?.instrument).toEqual(microsoftInstrument);
    expect(afterWindow?.position).toEqual(originalPosition);
    expect(afterWindow?.zIndex).toBe(beforeWindow?.zIndex);
    expect(afterWindow?.kind).toBe("chart");
  });

  it("saves and loads workspace layout with safeStorage envelope", () => {
    const store = useWorkspaceStore.getState();
    const id1 = store.addWindow("chart", appleInstrument);
    const id2 = store.addWindow("orderBook", spFuturesInstrument);

    store.saveWorkspace();

    const envelope = safeStorage.getJSON<WorkspaceStorageEnvelope>(
      WORKSPACE_STORAGE_KEY,
      workspaceStorageSchema,
    );

    expect(envelope).not.toBeNull();
    expect(envelope?.version).toBe(CURRENT_WORKSPACE_VERSION);
    expect(envelope?.activeWorkspaceId).toBe(DEFAULT_WORKSPACE_ID);
    expect(envelope?.workspaces[0]?.windows).toHaveLength(2);

    // Reset in-memory state without overwriting storage
    useWorkspaceStore.setState({ windows: [], activeWindowId: null });
    expect(useWorkspaceStore.getState().windows).toHaveLength(0);

    // Rehydrate from storage
    store.loadWorkspace();

    const restored = useWorkspaceStore.getState();

    expect(restored.windows).toHaveLength(2);
    expect(restored.windows[0]?.id).toBe(id1);
    expect(restored.windows[1]?.id).toBe(id2);
    expect(restored.activeWindowId).toBe(id2);
  });

  it("resets in-memory windows and overwrites persistent storage with an empty schema on resetWorkspace", () => {
    const store = useWorkspaceStore.getState();

    store.addWindow("chart", appleInstrument);
    store.addWindow("orderBook", spFuturesInstrument);
    expect(useWorkspaceStore.getState().windows).toHaveLength(2);

    store.resetWorkspace();

    const state = useWorkspaceStore.getState();

    expect(state.windows).toEqual([]);
    expect(state.activeWindowId).toBeNull();

    const envelope = safeStorage.getJSON<WorkspaceStorageEnvelope>(
      WORKSPACE_STORAGE_KEY,
      workspaceStorageSchema,
    );

    expect(envelope).not.toBeNull();
    expect(envelope?.version).toBe(CURRENT_WORKSPACE_VERSION);
    expect(envelope?.activeWorkspaceId).toBe(DEFAULT_WORKSPACE_ID);

    const activeWorkspace = envelope?.workspaces.find(
      (workspaceItem) => workspaceItem.id === envelope.activeWorkspaceId,
    );

    expect(activeWorkspace).toBeDefined();
    expect(activeWorkspace?.windows).toEqual([]);
  });

  it("Scenario 9: recovers silently with an empty workspace when safeStorage has corrupted payload (ADR-0004)", () => {
    safeStorage.setItem(WORKSPACE_STORAGE_KEY, "{broken-json-not-valid");

    const store = useWorkspaceStore.getState();

    expect(() => {
      store.loadWorkspace();
    }).not.toThrow();

    const state = useWorkspaceStore.getState();

    expect(state.windows).toEqual([]);
    expect(state.activeWindowId).toBeNull();
    expect(state.isInitialized).toBe(true);

    // Also test invalid schema structure
    safeStorage.setItem(
      WORKSPACE_STORAGE_KEY,
      JSON.stringify({ version: 999, invalidStructure: true }),
    );

    expect(() => {
      store.loadWorkspace();
    }).not.toThrow();

    const stateAfterInvalidSchema = useWorkspaceStore.getState();

    expect(stateAfterInvalidSchema.windows).toEqual([]);
    expect(stateAfterInvalidSchema.activeWindowId).toBeNull();
  });

  describe("Window Minimization & Resizing Behavioral Scenarios", () => {
    it("Scenario 1: minimizing an active window updates state and shifts focus to remaining highest-z window", () => {
      const store = useWorkspaceStore.getState();
      const id1 = store.addWindow("chart", appleInstrument);
      const id2 = store.addWindow("orderBook", spFuturesInstrument);

      const beforeWin2 = useWorkspaceStore.getState().windows.find((w) => w.id === id2);

      expect(beforeWin2).toBeDefined();
      expect(useWorkspaceStore.getState().activeWindowId).toBe(id2);

      store.minimizeWindow(id2);

      const state = useWorkspaceStore.getState();
      const win2After = state.windows.find((w) => w.id === id2);

      expect(win2After?.isMinimized).toBe(true);
      expect(win2After?.position).toEqual(beforeWin2?.position);
      expect(win2After?.size).toEqual(beforeWin2?.size);
      expect(state.activeWindowId).toBe(id1);
    });

    it("Scenario 2: minimizing all windows sets activeWindowId to null", () => {
      const store = useWorkspaceStore.getState();
      const id1 = store.addWindow("chart", appleInstrument);

      expect(useWorkspaceStore.getState().activeWindowId).toBe(id1);

      store.minimizeWindow(id1);

      const state = useWorkspaceStore.getState();
      const win1After = state.windows.find((w) => w.id === id1);

      expect(win1After?.isMinimized).toBe(true);
      expect(state.activeWindowId).toBeNull();
    });

    it("Scenario 3: restoring a minimized window unminimizes, elevates zIndex, and focuses it", () => {
      const store = useWorkspaceStore.getState();
      const id1 = store.addWindow("chart", appleInstrument);
      const id2 = store.addWindow("orderBook", spFuturesInstrument);

      store.minimizeWindow(id1);
      expect(useWorkspaceStore.getState().activeWindowId).toBe(id2);

      const win2ZIndex =
        useWorkspaceStore.getState().windows.find((w) => w.id === id2)?.zIndex ?? 0;

      store.restoreWindow(id1);

      const state = useWorkspaceStore.getState();
      const win1After = state.windows.find((w) => w.id === id1);

      expect(win1After?.isMinimized).toBe(false);
      expect(win1After?.zIndex).toBeGreaterThan(win2ZIndex);
      expect(state.activeWindowId).toBe(id1);
    });

    it("Scenario 4: toggle minimize alternates window state", () => {
      const store = useWorkspaceStore.getState();
      const id1 = store.addWindow("chart", appleInstrument);

      expect(
        useWorkspaceStore.getState().windows.find((w) => w.id === id1)?.isMinimized,
      ).toBeFalsy();

      store.toggleMinimizeWindow(id1);

      expect(useWorkspaceStore.getState().windows.find((w) => w.id === id1)?.isMinimized).toBe(
        true,
      );

      store.toggleMinimizeWindow(id1);

      expect(useWorkspaceStore.getState().windows.find((w) => w.id === id1)?.isMinimized).toBe(
        false,
      );

      expect(useWorkspaceStore.getState().activeWindowId).toBe(id1);
    });

    it("Scenario 5: resizing window clamps to minimum dimensions", () => {
      const store = useWorkspaceStore.getState();
      const id1 = store.addWindow("chart", appleInstrument);

      store.resizeWindow(id1, { width: 150, height: 100 });

      const stateClamped = useWorkspaceStore.getState();
      const targetClamped = stateClamped.windows.find((w) => w.id === id1);

      expect(targetClamped?.size).toEqual({
        width: MIN_WINDOW_WIDTH,
        height: MIN_WINDOW_HEIGHT,
      });

      store.resizeWindow(id1, { width: 450, height: 350 });

      const stateValid = useWorkspaceStore.getState();
      const targetValid = stateValid.windows.find((w) => w.id === id1);

      expect(targetValid?.size).toEqual({ width: 450, height: 350 });
    });

    it("Scenario 6: safeStorage persistence preserves custom geometry and minimized flags across reload", () => {
      const store = useWorkspaceStore.getState();
      const id1 = store.addWindow("chart", appleInstrument);

      const customSize: WindowSize = { width: 500, height: 600 };

      store.resizeWindow(id1, customSize);
      store.minimizeWindow(id1);

      store.saveWorkspace();

      // Clear in-memory state
      useWorkspaceStore.setState({ windows: [], activeWindowId: null });
      expect(useWorkspaceStore.getState().windows).toHaveLength(0);

      // Rehydrate from storage
      store.loadWorkspace();

      const restoredState = useWorkspaceStore.getState();

      expect(restoredState.windows).toHaveLength(1);

      const restoredWindow = restoredState.windows[0];

      expect(restoredWindow?.id).toBe(id1);
      expect(restoredWindow?.size).toEqual(customSize);
      expect(restoredWindow?.isMinimized).toBe(true);
    });
  });
});
