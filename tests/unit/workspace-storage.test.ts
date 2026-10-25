import { act, cleanup, renderHook } from "@testing-library/react";
import { createElement, Suspense, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WORKSPACE_STORAGE_KEY } from "@/app/constants/storage";
import { useWorkspace } from "@/app/hooks/use-workspace";
import {
  createEmptyWorkspace,
  readWorkspace,
  saveWorkspace,
} from "@/app/storage/workspace-storage";

import type { WorkspaceStorageEnvelope } from "@/app/types/workspace";

function suspenseWrapper({ children }: { children: ReactNode }) {
  return createElement(Suspense, { fallback: null }, children);
}

describe("workspace-storage and useWorkspace initialization", () => {
  const originalLocalStorage = Object.getOwnPropertyDescriptor(window, "localStorage");

  beforeEach(() => {
    if (originalLocalStorage) {
      Object.defineProperty(window, "localStorage", originalLocalStorage);
    }

    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();

    if (originalLocalStorage) {
      Object.defineProperty(window, "localStorage", originalLocalStorage);
    }

    window.localStorage.clear();
  });

  describe("createEmptyWorkspace", () => {
    it("creates a version 1 envelope with one empty workspace matching activeWorkspaceId", () => {
      const first = createEmptyWorkspace();
      const second = createEmptyWorkspace();

      expect(first.version).toBe(1);
      expect(first.activeWorkspaceId.trim().length).toBeGreaterThan(0);
      expect(first.workspaces).toEqual([{ id: first.activeWorkspaceId, windows: [] }]);
      expect(second.activeWorkspaceId).not.toBe(first.activeWorkspaceId);
    });
  });

  describe("readWorkspace", () => {
    it("returns missing when no record is stored", () => {
      expect(readWorkspace()).toEqual({ status: "missing" });
    });

    it("returns ready for a valid single-workspace or multi-workspace envelope", () => {
      const envelope: WorkspaceStorageEnvelope = {
        version: 1,
        activeWorkspaceId: "ws-2",
        workspaces: [
          { id: "ws-1", windows: [] },
          { id: "ws-2", windows: [] },
        ],
      };

      window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(envelope));

      expect(readWorkspace()).toEqual({
        status: "ready",
        workspace: envelope,
      });
    });

    it.each([
      { name: "malformed JSON", raw: "{broken-json" },
      { name: "JSON null", raw: "null" },
      { name: "JSON array", raw: "[]" },
      {
        name: "unsupported version",
        raw: JSON.stringify({
          version: 2,
          activeWorkspaceId: "ws-1",
          workspaces: [{ id: "ws-1", windows: [] }],
        }),
      },
      {
        name: "empty workspaces list",
        raw: JSON.stringify({
          version: 1,
          activeWorkspaceId: "ws-1",
          workspaces: [],
        }),
      },
      {
        name: "blank workspace id",
        raw: JSON.stringify({
          version: 1,
          activeWorkspaceId: "   ",
          workspaces: [{ id: "   ", windows: [] }],
        }),
      },
      {
        name: "duplicate workspace ids",
        raw: JSON.stringify({
          version: 1,
          activeWorkspaceId: "dup",
          workspaces: [
            { id: "dup", windows: [] },
            { id: "dup", windows: [] },
          ],
        }),
      },
      {
        name: "non-empty windows array in T1.5 envelope",
        raw: JSON.stringify({
          version: 1,
          activeWorkspaceId: "ws-1",
          workspaces: [{ id: "ws-1", windows: [{ id: "win-1" }] }],
        }),
      },
      {
        name: "activeWorkspaceId missing from workspaces",
        raw: JSON.stringify({
          version: 1,
          activeWorkspaceId: "missing-id",
          workspaces: [{ id: "ws-1", windows: [] }],
        }),
      },
    ])("returns corrupted without overwriting storage for $name", ({ raw }) => {
      window.localStorage.setItem(WORKSPACE_STORAGE_KEY, raw);

      const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
      const removeItemSpy = vi.spyOn(Storage.prototype, "removeItem");

      expect(readWorkspace()).toEqual({ status: "corrupted" });
      expect(window.localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe(raw);
      expect(setItemSpy).not.toHaveBeenCalled();
      expect(removeItemSpy).not.toHaveBeenCalled();
    });

    it("returns unavailable when localStorage getter throws", () => {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        get() {
          throw new DOMException("Storage disabled", "SecurityError");
        },
      });

      expect(readWorkspace()).toEqual({ status: "unavailable" });
    });

    it("returns unavailable when getItem throws SecurityError", () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new DOMException("Read denied", "SecurityError");
      });

      expect(readWorkspace()).toEqual({ status: "unavailable" });
    });
  });

  describe("saveWorkspace", () => {
    it("writes the envelope JSON to localStorage and returns ready", () => {
      const envelope: WorkspaceStorageEnvelope = {
        version: 1,
        activeWorkspaceId: "saved-ws",
        workspaces: [{ id: "saved-ws", windows: [] }],
      };

      expect(saveWorkspace(envelope)).toBe("ready");
      expect(JSON.parse(window.localStorage.getItem(WORKSPACE_STORAGE_KEY)!)).toEqual(envelope);
    });

    it("returns unavailable when setItem throws QuotaExceededError", () => {
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      });

      const envelope = createEmptyWorkspace();

      expect(saveWorkspace(envelope)).toBe("unavailable");
    });

    it("returns unavailable when localStorage getter throws", () => {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        get() {
          throw new DOMException("Storage disabled", "SecurityError");
        },
      });

      const envelope = createEmptyWorkspace();

      expect(saveWorkspace(envelope)).toBe("unavailable");
    });
  });

  describe("useWorkspace initialization", () => {
    it("creates and saves a new empty workspace when storage is initially empty", () => {
      const { result } = renderHook(() => useWorkspace(), {
        wrapper: suspenseWrapper,
      });

      expect(result.current.state.status).toBe("ready");

      if (result.current.state.status === "ready") {
        const stored = JSON.parse(
          window.localStorage.getItem(WORKSPACE_STORAGE_KEY)!,
        ) as WorkspaceStorageEnvelope;

        expect(stored).toEqual(result.current.state.workspace);
        expect(stored.workspaces).toHaveLength(1);
        expect(stored.workspaces[0].id).toBe(stored.activeWorkspaceId);
      }
    });

    it("preserves an existing valid workspace without replacing its id", () => {
      const existing: WorkspaceStorageEnvelope = {
        version: 1,
        activeWorkspaceId: "existing-workspace-id",
        workspaces: [{ id: "existing-workspace-id", windows: [] }],
      };

      window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(existing));

      const { result } = renderHook(() => useWorkspace(), {
        wrapper: suspenseWrapper,
      });

      expect(result.current.state).toEqual({
        status: "ready",
        workspace: existing,
      });

      expect(JSON.parse(window.localStorage.getItem(WORKSPACE_STORAGE_KEY)!)).toEqual(existing);
    });

    it("reports corrupted state and does not overwrite a corrupted record on mount", () => {
      const corruptedRaw = "{corrupted-json";

      window.localStorage.setItem(WORKSPACE_STORAGE_KEY, corruptedRaw);

      const { result } = renderHook(() => useWorkspace(), {
        wrapper: suspenseWrapper,
      });

      expect(result.current.state).toEqual({ status: "corrupted" });
      expect(window.localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe(corruptedRaw);
    });

    it("falls back to unavailable state with an in-memory empty workspace when read or write fails", () => {
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      });

      const { result } = renderHook(() => useWorkspace(), {
        wrapper: suspenseWrapper,
      });

      expect(result.current.state.status).toBe("unavailable");

      if (result.current.state.status === "unavailable") {
        expect(result.current.state.workspace.version).toBe(1);

        expect(result.current.state.workspace.workspaces).toEqual([
          {
            id: result.current.state.workspace.activeWorkspaceId,
            windows: [],
          },
        ]);
      }

      act(() => {
        result.current.startEmpty();
      });

      expect(result.current.state.status).toBe("unavailable");
    });
  });
});
