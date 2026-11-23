import fs from "node:fs";
import path from "node:path";

import { atomicWriteJsonFile } from "./fs-atomic.ts";

import type { SubagentLinkRecord } from "../types.ts";

const LINKS_DIR_NAME = "links";

function getSubagentLinkPath(spoolDir: string, subagentConversationId: string): string {
  const normalized = subagentConversationId.trim().toLowerCase();
  const sanitized = normalized.replace(/[^a-z0-9._-]/g, "_") || "unknown";

  return path.join(spoolDir, LINKS_DIR_NAME, `${sanitized}.json`);
}

export function readSubagentLink(
  spoolDir: string,
  subagentConversationId: string,
): SubagentLinkRecord | null {
  const linkPath = getSubagentLinkPath(spoolDir, subagentConversationId);

  if (!fs.existsSync(linkPath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(linkPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<SubagentLinkRecord>;

    if (
      typeof parsed.subagentConversationId === "string" &&
      typeof parsed.parentConversationId === "string" &&
      typeof parsed.parentTraceId === "string" &&
      typeof parsed.parentSpanId === "string" &&
      typeof parsed.parentSessionId === "string"
    ) {
      return {
        subagentConversationId: parsed.subagentConversationId,
        parentConversationId: parsed.parentConversationId,
        parentTraceId: parsed.parentTraceId,
        parentSpanId: parsed.parentSpanId,
        parentSessionId: parsed.parentSessionId,
        agentName: typeof parsed.agentName === "string" ? parsed.agentName : "subagent:worker",
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
      };
    }
  } catch {
    // Ignore unreadable subagent link files
  }

  return null;
}

export function writeSubagentLink(spoolDir: string, link: SubagentLinkRecord): void {
  const linkPath = getSubagentLinkPath(spoolDir, link.subagentConversationId);

  atomicWriteJsonFile(linkPath, link);
}
