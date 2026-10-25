"use client";

import Image from "next/image";

import { EMPTY_WORKSPACE_INSTRUCTION, EMPTY_WORKSPACE_TITLE } from "../constants";
import styles from "./workspace-canvas.module.css";

import type { WorkspaceCanvasProps } from "../types";

export function WorkspaceCanvas({ children, isEmpty = false }: WorkspaceCanvasProps) {
  return (
    <main className={styles.canvas} role="main" aria-label="Workspace">
      <div className={styles.watermark} aria-hidden="true">
        <Image
          className="theme-light-only"
          src="/logo-full.png"
          alt=""
          width={1254}
          height={1254}
          loading="eager"
          fetchPriority="high"
          unoptimized
        />
        <Image
          className="theme-dark-only"
          src="/logo-full-dark.png"
          alt=""
          width={1254}
          height={1254}
          loading="eager"
          fetchPriority="high"
          unoptimized
        />
      </div>

      {isEmpty && (
        <div className={styles.emptyInstruction}>
          <h1 className={styles.emptyTitle}>{EMPTY_WORKSPACE_TITLE}</h1>
          <p className={styles.emptyText}>{EMPTY_WORKSPACE_INSTRUCTION}</p>
        </div>
      )}

      {children}
    </main>
  );
}
