import Image from "next/image";
import type { ReactNode } from "react";
import { useWorkspace } from "../hooks/use-workspace";

export function WorkspaceState() {
  useWorkspace();
  return null;
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
