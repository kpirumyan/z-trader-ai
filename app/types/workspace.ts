export type WorkspaceRecord = {
  id: string;
  // Window persistence is introduced when its schema is approved in T3.3.
  windows: [];
};

export type WorkspaceStorageEnvelope = {
  version: 1;
  activeWorkspaceId: string;
  workspaces: WorkspaceRecord[];
};

export type WorkspaceReadResult =
  | { status: "ready"; workspace: WorkspaceStorageEnvelope }
  | { status: "missing" }
  | { status: "corrupted" }
  | { status: "unavailable" };

export type WorkspaceState =
  | { status: "ready"; workspace: WorkspaceStorageEnvelope }
  | { status: "corrupted" }
  | { status: "unavailable"; workspace: WorkspaceStorageEnvelope };
