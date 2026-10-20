import Image from "next/image";
import type { ReactNode } from "react";
import { useWorkspace } from "../hooks/use-workspace";
import { StorageRecoveryBanner } from "./storage-recovery-banner";

export function WorkspaceState({ hasWindows = false, children }: { hasWindows?: boolean; children?: ReactNode }) {
  const { state, retry, startEmpty } = useWorkspace();
  const activeWorkspace = state.status === "corrupted" ? undefined : state.workspace.workspaces.find(
    (workspace) => workspace.id === state.workspace.activeWorkspaceId,
  );
  const showEmptyInstruction = !hasWindows && activeWorkspace && activeWorkspace.windows.length === 0;

  return (
    <>
      {children}
      {state.status === "corrupted" && (
        <StorageRecoveryBanner status="corrupted" onRetry={retry} onStartEmpty={startEmpty} />
      )}
      {state.status === "unavailable" && <StorageRecoveryBanner status="unavailable" />}
      {showEmptyInstruction && <section className="empty-instruction" aria-labelledby="empty-workspace-title">
        <h1 id="empty-workspace-title">Your workspace is empty</h1>
        <p>
          Use <strong>New</strong> to open a <strong>Chart</strong>, <strong>Level II</strong>, or <strong>T &amp; S</strong> window.
        </p>
      </section>}
    </>
  );
}

export function WorkspaceCanvas({ children }: { children?: ReactNode }) {
  return (
    <main className="workspace-canvas" aria-label="Workspace">
      <div className="workspace-watermark" aria-hidden="true">
        <Image
          className="theme-light-only" src="/logo-full.png" alt=""
          width={1254} height={1254} loading="eager" fetchPriority="high" unoptimized
        />
        <Image
          className="theme-dark-only" src="/logo-full-dark.png" alt=""
          width={1254} height={1254} loading="eager" fetchPriority="high" unoptimized
        />
      </div>
      {children}
    </main>
  );
}
