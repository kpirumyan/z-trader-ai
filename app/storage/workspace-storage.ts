import { CURRENT_WORKSPACE_VERSION, WORKSPACE_STORAGE_KEY } from "../constants/storage";
import type {
  WorkspaceReadResult,
  WorkspaceRecord,
  WorkspaceStorageEnvelope,
} from "../types/workspace";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isWorkspace(value: unknown): value is WorkspaceRecord {
  return (
    isRecord(value) && isId(value.id) && Array.isArray(value.windows) && value.windows.length === 0
  );
}

function isEnvelope(value: unknown): value is WorkspaceStorageEnvelope {
  if (
    !isRecord(value) ||
    value.version !== CURRENT_WORKSPACE_VERSION ||
    !isId(value.activeWorkspaceId) ||
    !Array.isArray(value.workspaces) ||
    value.workspaces.length === 0 ||
    !value.workspaces.every(isWorkspace)
  ) {
    return false;
  }

  const ids = value.workspaces.map((workspace) => workspace.id);

  return new Set(ids).size === ids.length && ids.includes(value.activeWorkspaceId);
}

export function readWorkspace(): WorkspaceReadResult {
  let raw: string | null;

  try {
    raw = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
  } catch {
    return { status: "unavailable" };
  }

  if (raw === null) return { status: "missing" };

  try {
    const parsed: unknown = JSON.parse(raw);

    return isEnvelope(parsed) ? { status: "ready", workspace: parsed } : { status: "corrupted" };
  } catch {
    return { status: "corrupted" };
  }
}

export function createEmptyWorkspace(): WorkspaceStorageEnvelope {
  const id = crypto.randomUUID();

  return {
    version: CURRENT_WORKSPACE_VERSION,
    activeWorkspaceId: id,
    workspaces: [{ id, windows: [] }],
  };
}

export function saveWorkspace(workspace: WorkspaceStorageEnvelope): "ready" | "unavailable" {
  try {
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(workspace));

    return "ready";
  } catch {
    return "unavailable";
  }
}
