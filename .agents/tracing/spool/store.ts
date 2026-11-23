import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { atomicWriteJsonFile } from "./fs-atomic.ts";

import type {
  ContextAnchor,
  ParsedAgentObservation,
  ParsedChildObservation,
  ParsedTurnTrace,
  PendingExportSpool,
} from "../types.ts";

const SPOOL_DIR_NAME = ".langfuse-spool";

function reviveChildDates(child: ParsedChildObservation): ParsedChildObservation {
  const startTime = new Date(child.startTime);
  const endTime = new Date(child.endTime);

  if (child.type === "agent") {
    const agentChild: ParsedAgentObservation = {
      ...child,
      startTime,
      endTime,
      children: child.children.map((nested) => reviveChildDates(nested)),
    };

    return agentChild;
  }

  return {
    ...child,
    startTime,
    endTime,
  };
}

function reviveTurnDates(turn: ParsedTurnTrace): ParsedTurnTrace {
  return {
    ...turn,
    startTime: new Date(turn.startTime),
    endTime: new Date(turn.endTime),
    children: turn.children.map((child) => reviveChildDates(child)),
  };
}

function findBrainAncestor(targetPath: string): string | null {
  let current = path.resolve(targetPath);

  while (true) {
    if (path.basename(current) === "brain") {
      return current;
    }

    const parent = path.dirname(current);

    if (parent === current) {
      return null;
    }

    current = parent;
  }
}

export function resolveSpoolDir(options: {
  spoolDir?: string;
  transcriptPath?: string;
  artifactDirectoryPath?: string;
  homeDir?: string;
}): string {
  if (options.spoolDir) {
    return path.resolve(options.spoolDir);
  }

  const envSpoolDir = process.env.LANGFUSE_SPOOL_DIR?.trim();

  if (envSpoolDir) {
    return path.resolve(envSpoolDir);
  }

  if (options.transcriptPath) {
    const resolvedTranscript = path.resolve(options.transcriptPath);
    const brainRoot = findBrainAncestor(resolvedTranscript);

    if (brainRoot) {
      return path.join(brainRoot, SPOOL_DIR_NAME);
    }

    const transcriptDir = path.dirname(resolvedTranscript);

    if (
      path.basename(transcriptDir) === "logs" &&
      path.basename(path.dirname(transcriptDir)) === ".system_generated"
    ) {
      return path.join(path.resolve(transcriptDir, "..", "..", ".."), SPOOL_DIR_NAME);
    }

    return path.join(path.dirname(transcriptDir), SPOOL_DIR_NAME);
  }

  if (options.artifactDirectoryPath) {
    const resolvedArtifact = path.resolve(options.artifactDirectoryPath);
    const brainRoot = findBrainAncestor(resolvedArtifact);

    if (brainRoot) {
      return path.join(brainRoot, SPOOL_DIR_NAME);
    }

    return path.join(path.dirname(resolvedArtifact), SPOOL_DIR_NAME);
  }

  return path.join(
    options.homeDir ?? os.homedir(),
    ".gemini",
    "antigravity",
    "brain",
    SPOOL_DIR_NAME,
  );
}

export function getSpoolFilePath(spoolDir: string, conversationId: string): string {
  const sanitized = conversationId.replace(/[^a-zA-Z0-9._-]/g, "_") || "unknown";

  return path.join(spoolDir, `${sanitized}.json`);
}

export function listSpoolFiles(spoolDir: string): string[] {
  if (!fs.existsSync(spoolDir)) {
    return [];
  }

  try {
    const entries = fs.readdirSync(spoolDir, { withFileTypes: true });

    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => path.join(spoolDir, entry.name))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

export function removeSpoolFile(spoolPath: string): boolean {
  try {
    fs.unlinkSync(spoolPath);

    return true;
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "ENOENT"
    ) {
      return false;
    }

    throw err;
  }
}

export function readSpoolEntry(spoolPath: string): PendingExportSpool | null {
  if (!fs.existsSync(spoolPath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(spoolPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<PendingExportSpool>;

    if (Array.isArray(parsed.pendingTurns)) {
      return {
        ...(typeof parsed.conversationId === "string"
          ? { conversationId: parsed.conversationId }
          : {}),
        ...(typeof parsed.parentConversationId === "string"
          ? { parentConversationId: parsed.parentConversationId }
          : {}),
        ...(typeof parsed.awaitingWorkflowMatch === "boolean"
          ? { awaitingWorkflowMatch: parsed.awaitingWorkflowMatch }
          : {}),
        ...(typeof parsed.workspaceRoot === "string"
          ? { workspaceRoot: parsed.workspaceRoot }
          : {}),
        ...(typeof parsed.cursorPath === "string" ? { cursorPath: parsed.cursorPath } : {}),
        ...(parsed.contextAnchor ? { contextAnchor: parsed.contextAnchor } : {}),
        pendingTurns: parsed.pendingTurns.map((t) => reviveTurnDates(t)),
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
      };
    }
  } catch {
    // Ignore unreadable spool file
  }

  return null;
}

export function readPendingSpool(spoolPath: string): ParsedTurnTrace[] {
  return readSpoolEntry(spoolPath)?.pendingTurns ?? [];
}

export function writePendingSpool(
  spoolPath: string,
  turns: ParsedTurnTrace[],
  metadata?: {
    conversationId?: string;
    parentConversationId?: string;
    awaitingWorkflowMatch?: boolean;
    workspaceRoot?: string;
    cursorPath?: string;
    contextAnchor?: ContextAnchor;
  },
): void {
  const payload: PendingExportSpool = {
    ...(metadata?.conversationId ? { conversationId: metadata.conversationId } : {}),
    ...(metadata?.parentConversationId
      ? { parentConversationId: metadata.parentConversationId }
      : {}),
    ...(metadata?.awaitingWorkflowMatch ? { awaitingWorkflowMatch: true } : {}),
    ...(metadata?.workspaceRoot ? { workspaceRoot: metadata.workspaceRoot } : {}),
    ...(metadata?.cursorPath ? { cursorPath: metadata.cursorPath } : {}),
    ...(metadata?.contextAnchor ? { contextAnchor: metadata.contextAnchor } : {}),
    pendingTurns: turns,
    updatedAt: new Date().toISOString(),
  };

  atomicWriteJsonFile(spoolPath, payload);
}

export function mergeTurnsForExport(
  spooledTurns: ParsedTurnTrace[],
  newlyParsedTurns: ParsedTurnTrace[],
): ParsedTurnTrace[] {
  const byTurnIndex = new Map<number, ParsedTurnTrace>();

  for (const turn of spooledTurns) {
    byTurnIndex.set(turn.turnIndex, turn);
  }

  for (const turn of newlyParsedTurns) {
    byTurnIndex.set(turn.turnIndex, turn);
  }

  return Array.from(byTurnIndex.values()).sort((a, b) => a.turnIndex - b.turnIndex);
}
