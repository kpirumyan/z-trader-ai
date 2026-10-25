export type {
  NewMenuPopoverProps,
  StatusBarProps,
  TerminalShellProps,
  TerminalWindowProps,
  TopBarProps,
  WindowPosition,
  WindowSize,
  WorkspaceCanvasProps,
  WorkspaceRecord,
  WorkspaceStorageEnvelope,
  WorkspaceStore,
  WorkspaceStoreActions,
  WorkspaceStoreState,
  WorkspaceWindow,
} from "./types";

export {
  windowPositionSchema,
  windowSizeSchema,
  workspaceInstrumentSchema,
  workspaceRecordSchema,
  workspaceStorageSchema,
  workspaceWindowSchema,
} from "./schema";

export {
  CURRENT_WORKSPACE_VERSION,
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_KIND_LABELS,
  DEFAULT_WINDOW_WIDTH,
  DEFAULT_WORKSPACE_ID,
  EMPTY_WORKSPACE_INSTRUCTION,
  EMPTY_WORKSPACE_TITLE,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  WINDOW_CASCADE_MAX_SLOTS,
  WINDOW_CASCADE_OFFSET,
  WINDOW_CASCADE_STEP,
  WORKSPACE_STORAGE_KEY,
} from "./constants";

export { useWorkspaceStore } from "./model/workspace-store";

export { NewMenuPopover } from "./ui/new-menu-popover";
export { StatusBar } from "./ui/status-bar";
export { TerminalShell } from "./ui/terminal-shell";
export { TerminalWindow } from "./ui/terminal-window";
export { TopBar } from "./ui/top-bar";
export { WorkspaceCanvas } from "./ui/workspace-canvas";
