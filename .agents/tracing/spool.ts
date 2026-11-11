import fs from "node:fs";

import type {
  LangfuseCursorState,
  ParsedAgentObservation,
  ParsedChildObservation,
  ParsedTurnTrace,
  PendingExportSpool,
} from "./types.ts";

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
  fs.writeFileSync(cursorPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function readPendingSpool(spoolPath: string): ParsedTurnTrace[] {
  if (!fs.existsSync(spoolPath)) {
    return [];
  }

  try {
    const raw = fs.readFileSync(spoolPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<PendingExportSpool>;

    if (Array.isArray(parsed.pendingTurns)) {
      return parsed.pendingTurns.map((t) => reviveTurnDates(t));
    }
  } catch {
    // Ignore unreadable spool file
  }

  return [];
}

export function writePendingSpool(spoolPath: string, turns: ParsedTurnTrace[]): void {
  const payload: PendingExportSpool = {
    pendingTurns: turns,
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(spoolPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
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
