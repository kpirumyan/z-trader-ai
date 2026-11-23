import fs from "node:fs";
import path from "node:path";

import type { RawTranscriptStep } from "../types.ts";

const UUID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const UUID_GLOBAL_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const LABELED_CONVERSATION_ID_GLOBAL_REGEX =
  /conversation_?[Ii]d[:\s"=]+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;
const SENDER_UUID_REGEX =
  /sender[:\s"=]+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

export function isSubagentToolCall(
  toolName: string,
  deserializedArgs: Record<string, unknown>,
): boolean {
  if (toolName === "invoke_subagent") {
    return true;
  }

  if (toolName === "swarm" && deserializedArgs.action === "add") {
    return true;
  }

  return false;
}

export function createFilesystemSubagentResolver(
  parentTranscriptPath: string,
): (subagentConversationId: string) => string | null {
  // Parent transcript lives at <brainDir>/<conversationId>/.system_generated/logs/transcript_full.jsonl
  const logsDir = path.dirname(parentTranscriptPath);
  const systemGeneratedDir = path.dirname(logsDir);
  const conversationDir = path.dirname(systemGeneratedDir);
  const brainDir = path.dirname(conversationDir);

  return (subagentConversationId: string): string | null => {
    const candidateLogsDir = path.join(
      brainDir,
      subagentConversationId,
      ".system_generated",
      "logs",
    );
    const fullPath = path.join(candidateLogsDir, "transcript_full.jsonl");

    if (fs.existsSync(fullPath)) {
      return fs.readFileSync(fullPath, "utf8");
    }

    const compactPath = path.join(candidateLogsDir, "transcript.jsonl");

    if (fs.existsSync(compactPath)) {
      return fs.readFileSync(compactPath, "utf8");
    }

    return null;
  };
}

export function deriveSubagentObservationName(deserializedArgs: Record<string, unknown>): string {
  const rawRole =
    typeof deserializedArgs.Role === "string" && deserializedArgs.Role.trim()
      ? deserializedArgs.Role.trim()
      : typeof deserializedArgs.TypeName === "string" && deserializedArgs.TypeName.trim()
        ? deserializedArgs.TypeName.trim()
        : typeof deserializedArgs.name === "string" && deserializedArgs.name.trim()
          ? deserializedArgs.name.trim()
          : "worker";

  const slug = rawRole
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return `subagent:${slug || "worker"}`;
}

export function extractSubagentConversationIds(
  deserializedArgs: Record<string, unknown>,
  genericContent: string,
): string[] {
  const found = new Set<string>();

  for (const key of ["ConversationId", "conversationId", "conversation_id"]) {
    const raw = deserializedArgs[key];

    if (typeof raw === "string") {
      const argMatch = raw.match(UUID_REGEX);

      if (argMatch) {
        found.add(argMatch[0].toLowerCase());
      }
    }
  }

  for (const match of genericContent.matchAll(LABELED_CONVERSATION_ID_GLOBAL_REGEX)) {
    if (match[1]) {
      found.add(match[1].toLowerCase());
    }
  }

  if (found.size === 0) {
    for (const match of genericContent.matchAll(UUID_GLOBAL_REGEX)) {
      found.add(match[0].toLowerCase());
    }
  }

  return Array.from(found);
}

export function extractSubagentConversationId(
  deserializedArgs: Record<string, unknown>,
  genericContent: string,
): string | undefined {
  return extractSubagentConversationIds(deserializedArgs, genericContent)[0];
}

export function extractParentConversationFromTranscript(
  steps: RawTranscriptStep[],
  selfConversationId: string,
): string | undefined {
  const normalizedSelf = selfConversationId.trim().toLowerCase();

  for (const step of steps) {
    if (step.type === "USER_INPUT") {
      return undefined;
    }

    if (step.type === "PLANNER_RESPONSE") {
      return undefined;
    }

    if (step.type === "SYSTEM_MESSAGE" && step.content) {
      const match = step.content.match(SENDER_UUID_REGEX);

      if (match?.[1]) {
        const candidate = match[1].toLowerCase();

        if (candidate !== normalizedSelf) {
          return candidate;
        }
      }
    }
  }

  return undefined;
}
