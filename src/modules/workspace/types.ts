import type { Instrument, WidgetDefinition, WindowKind } from "@/src/shared/contracts";
import type { ReactNode, Ref } from "react";

export interface WindowPosition {
  readonly x: number;
  readonly y: number;
}

export interface WindowSize {
  readonly width: number;
  readonly height: number;
}

export interface WorkspaceWindow {
  readonly id: string;
  readonly kind: WindowKind;
  readonly instrument: Instrument;
  readonly position: WindowPosition;
  readonly size?: WindowSize;
  readonly zIndex: number;
}

export interface WorkspaceRecord {
  readonly id: string;
  readonly title?: string;
  readonly windows: readonly WorkspaceWindow[];
}

export interface WorkspaceStorageEnvelope {
  readonly version: 1;
  readonly activeWorkspaceId: string;
  readonly workspaces: readonly WorkspaceRecord[];
}

export interface WorkspaceStoreState {
  readonly windows: readonly WorkspaceWindow[];
  readonly activeWindowId: string | null;
  readonly isInitialized: boolean;
}

export interface WorkspaceStoreActions {
  readonly addWindow: (kind: WindowKind, instrument: Instrument) => string;
  readonly closeWindow: (id: string) => void;
  readonly focusWindow: (id: string) => void;
  readonly blurWindow: () => void;
  readonly moveWindow: (id: string, position: WindowPosition) => void;
  readonly resizeWindow: (id: string, size: WindowSize) => void;
  readonly changeInstrument: (id: string, instrument: Instrument) => void;
  readonly resetWorkspace: () => void;
  readonly loadWorkspace: () => void;
  readonly saveWorkspace: () => void;
}

export type WorkspaceStore = WorkspaceStoreState & WorkspaceStoreActions;

export interface TerminalShellProps {
  readonly widgets?: readonly WidgetDefinition[];
  readonly initialInstrument?: Instrument;
  readonly className?: string;
}

export interface TerminalWindowProps {
  readonly window: WorkspaceWindow;
  readonly widgetDefinition?: WidgetDefinition;
  readonly isFocused: boolean;
  readonly onClose: (id: string) => void;
  readonly onFocus: (id: string) => void;
  readonly onMove: (id: string, position: WindowPosition) => void;
  readonly onChangeInstrument: (id: string) => void;
}

export interface TopBarProps {
  readonly isNewOpen: boolean;
  readonly newButtonRef: Ref<HTMLButtonElement>;
  readonly onToggleNew: () => void;
  readonly onClearFocus?: () => void;
  readonly children?: ReactNode;
}

export interface NewMenuPopoverProps {
  readonly widgets: readonly WidgetDefinition[];
  readonly onClose: () => void;
  readonly onSelect: (kind: WindowKind) => void;
}

export interface WorkspaceCanvasProps {
  readonly children?: ReactNode;
  readonly isEmpty?: boolean;
  readonly onClearFocus?: () => void;
}

export interface StatusBarProps {
  readonly status?: "connected" | "connecting" | "disconnected";
  readonly latencyMs?: number;
  readonly serverTime?: string;
  readonly onClearFocus?: () => void;
}
