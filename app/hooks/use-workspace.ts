"use client";

import { use, useState } from "react";
import { browser } from "react-dom";
import {
  createEmptyWorkspace,
  readWorkspace,
  saveWorkspace,
} from "../storage/workspace-storage";
import type { WorkspaceState } from "../types/workspace";

function initializeWorkspace(): WorkspaceState {
  const result = readWorkspace();
  if (result.status === "ready" || result.status === "corrupted") return result;

  const workspace = createEmptyWorkspace();
  if (result.status === "unavailable") {
    return { status: "unavailable", workspace };
  }

  return { status: saveWorkspace(workspace), workspace };
}

export function useWorkspace(): WorkspaceState {
  use(browser("Workspace state is stored in localStorage"));
  const [workspace] = useState(initializeWorkspace);
  return workspace;
}
