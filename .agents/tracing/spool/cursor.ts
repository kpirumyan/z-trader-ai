import fs from "node:fs";

import { atomicWriteJsonFile } from "./fs-atomic.ts";

import type { LangfuseCursorState, ParsedTurnTrace } from "../types.ts";

export function readCursorState(cursorPath: string): LangfuseCursorState | null {
  if (!fs.existsSync(cursorPath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(cursorPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<LangfuseCursorState>;

    if (typeof parsed.lastExportedStepIndex === "number") {
      return {
        lastExportedStepIndex: parsed.lastExportedStepIndex,
        ...(typeof parsed.lastExportedLineIndex === "number"
          ? { lastExportedLineIndex: parsed.lastExportedLineIndex }
          : {}),
        lastExportedTurnIndex:
          typeof parsed.lastExportedTurnIndex === "number" ? parsed.lastExportedTurnIndex : -1,
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
      };
    }
  } catch {
    // Ignore corrupted cursor file and re-export cleanly
  }

  return null;
}

export function writeCursorState(cursorPath: string, state: LangfuseCursorState): void {
  atomicWriteJsonFile(cursorPath, state);
}

export function advanceCursorForTurns(cursorPath: string, turns: ParsedTurnTrace[]): void {
  if (turns.length === 0) {
    return;
  }

  const existingCursor = readCursorState(cursorPath);
  let maxStepIndex = existingCursor?.lastExportedStepIndex ?? -1;
  let maxLineIndex = existingCursor?.lastExportedLineIndex;
  let maxTurnIndex = existingCursor?.lastExportedTurnIndex ?? -1;

  for (const turn of turns) {
    if (turn.endStepIndex > maxStepIndex) {
      maxStepIndex = turn.endStepIndex;
    }

    if (typeof turn.endLineIndex === "number") {
      maxLineIndex =
        typeof maxLineIndex === "number"
          ? Math.max(maxLineIndex, turn.endLineIndex)
          : turn.endLineIndex;
    }

    if (turn.turnIndex > maxTurnIndex) {
      maxTurnIndex = turn.turnIndex;
    }
  }

  writeCursorState(cursorPath, {
    lastExportedStepIndex: maxStepIndex,
    ...(typeof maxLineIndex === "number" ? { lastExportedLineIndex: maxLineIndex } : {}),
    lastExportedTurnIndex: maxTurnIndex,
    updatedAt: new Date().toISOString(),
  });
}
