import { create } from "zustand";

import { safeStorage } from "@/src/shared/storage";

import {
  CURRENT_WORKSPACE_VERSION,
  DEFAULT_WORKSPACE_ID,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  WINDOW_CASCADE_MAX_SLOTS,
  WINDOW_CASCADE_OFFSET,
  WINDOW_CASCADE_STEP,
  WORKSPACE_STORAGE_KEY,
} from "../constants";
import { workspaceStorageSchema } from "../schema";

import type {
  WindowPosition,
  WindowSize,
  WorkspaceStorageEnvelope,
  WorkspaceStore,
  WorkspaceWindow,
} from "../types";
import type { Instrument, WindowKind } from "@/src/shared/contracts";

function buildStorageEnvelope(windows: readonly WorkspaceWindow[]): WorkspaceStorageEnvelope {
  return {
    version: CURRENT_WORKSPACE_VERSION,
    activeWorkspaceId: DEFAULT_WORKSPACE_ID,
    workspaces: [
      {
        id: DEFAULT_WORKSPACE_ID,
        title: "Default",
        windows,
      },
    ],
  };
}

export const useWorkspaceStore = create<WorkspaceStore>()((set, get) => ({
  windows: [],
  activeWindowId: null,
  isInitialized: false,

  addWindow: (kind: WindowKind, instrument: Instrument): string => {
    let createdId = "";

    set((state) => {
      const index = state.windows.length % WINDOW_CASCADE_MAX_SLOTS;
      const x = WINDOW_CASCADE_OFFSET + index * WINDOW_CASCADE_STEP;
      const y = WINDOW_CASCADE_OFFSET + index * WINDOW_CASCADE_STEP;
      const maxZ = state.windows.reduce((max, w) => Math.max(max, w.zIndex), 0);
      const nextZIndex = maxZ + 1;

      createdId = `window-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const newWindow: WorkspaceWindow = {
        id: createdId,
        kind,
        instrument,
        position: { x, y },
        zIndex: nextZIndex,
      };

      const nextWindows = [...state.windows, newWindow];

      safeStorage.setJSON(WORKSPACE_STORAGE_KEY, buildStorageEnvelope(nextWindows));

      return {
        windows: nextWindows,
        activeWindowId: createdId,
      };
    });

    return createdId;
  },

  closeWindow: (id: string) => {
    set((state) => {
      const nextWindows = state.windows.filter((w) => w.id !== id);
      let nextActiveId: string | null = null;

      if (nextWindows.length > 0) {
        if (state.activeWindowId !== id && nextWindows.some((w) => w.id === state.activeWindowId)) {
          nextActiveId = state.activeWindowId;
        } else {
          const topWindow = nextWindows.reduce((highest, current) =>
            current.zIndex > highest.zIndex ? current : highest,
          );

          nextActiveId = topWindow.id;
        }
      }

      safeStorage.setJSON(WORKSPACE_STORAGE_KEY, buildStorageEnvelope(nextWindows));

      return {
        windows: nextWindows,
        activeWindowId: nextActiveId,
      };
    });
  },

  focusWindow: (id: string) => {
    set((state) => {
      const target = state.windows.find((w) => w.id === id);

      if (!target) return state;

      const maxZ = state.windows.reduce((max, w) => Math.max(max, w.zIndex), 0);

      if (state.activeWindowId === id && target.zIndex === maxZ) {
        return state;
      }

      const nextZ = maxZ + 1;
      const nextWindows = state.windows.map((w) => (w.id === id ? { ...w, zIndex: nextZ } : w));

      safeStorage.setJSON(WORKSPACE_STORAGE_KEY, buildStorageEnvelope(nextWindows));

      return {
        windows: nextWindows,
        activeWindowId: id,
      };
    });
  },

  moveWindow: (id: string, position: WindowPosition) => {
    set((state) => {
      const clampedX = Math.max(0, Math.round(position.x));
      const clampedY = Math.max(0, Math.round(position.y));

      const nextWindows = state.windows.map((w) =>
        w.id === id ? { ...w, position: { x: clampedX, y: clampedY } } : w,
      );

      safeStorage.setJSON(WORKSPACE_STORAGE_KEY, buildStorageEnvelope(nextWindows));

      return { windows: nextWindows };
    });
  },

  resizeWindow: (id: string, size: WindowSize) => {
    set((state) => {
      const width = Math.max(MIN_WINDOW_WIDTH, Math.round(size.width));
      const height = Math.max(MIN_WINDOW_HEIGHT, Math.round(size.height));

      const nextWindows = state.windows.map((w) =>
        w.id === id ? { ...w, size: { width, height } } : w,
      );

      safeStorage.setJSON(WORKSPACE_STORAGE_KEY, buildStorageEnvelope(nextWindows));

      return { windows: nextWindows };
    });
  },

  changeInstrument: (id: string, instrument: Instrument) => {
    set((state) => {
      const nextWindows = state.windows.map((w) => (w.id === id ? { ...w, instrument } : w));

      safeStorage.setJSON(WORKSPACE_STORAGE_KEY, buildStorageEnvelope(nextWindows));

      return { windows: nextWindows };
    });
  },

  resetWorkspace: () => {
    safeStorage.setJSON(WORKSPACE_STORAGE_KEY, buildStorageEnvelope([]));

    set({
      windows: [],
      activeWindowId: null,
    });
  },

  loadWorkspace: () => {
    try {
      const envelope = safeStorage.getJSON(WORKSPACE_STORAGE_KEY, workspaceStorageSchema);

      if (!envelope || !envelope.workspaces || envelope.workspaces.length === 0) {
        set({
          windows: [],
          activeWindowId: null,
          isInitialized: true,
        });

        return;
      }

      const active =
        envelope.workspaces.find((w) => w.id === envelope.activeWorkspaceId) ??
        envelope.workspaces[0];

      const windows = active?.windows ?? [];
      let activeWindowId: string | null = null;

      if (windows.length > 0) {
        const topWindow = windows.reduce((highest, current) =>
          current.zIndex > highest.zIndex ? current : highest,
        );

        activeWindowId = topWindow.id;
      }

      set({
        windows,
        activeWindowId,
        isInitialized: true,
      });
    } catch {
      set({
        windows: [],
        activeWindowId: null,
        isInitialized: true,
      });
    }
  },

  saveWorkspace: () => {
    const { windows } = get();

    safeStorage.setJSON(WORKSPACE_STORAGE_KEY, buildStorageEnvelope(windows));
  },
}));
