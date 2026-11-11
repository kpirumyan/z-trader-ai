import fs from "node:fs";
import path from "node:path";

const UUID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

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
        : "worker";

  const slug = rawRole
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return `subagent:${slug || "worker"}`;
}

export function extractSubagentConversationId(
  deserializedArgs: Record<string, unknown>,
  genericContent: string,
): string | undefined {
  if (typeof deserializedArgs.ConversationId === "string") {
    const argMatch = deserializedArgs.ConversationId.match(UUID_REGEX);

    if (argMatch) {
      return argMatch[0].toLowerCase();
    }
  }

  const labeledMatch = genericContent.match(
    /conversationId[:\s"=]+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  );

  if (labeledMatch && labeledMatch[1]) {
    return labeledMatch[1].toLowerCase();
  }

  const anyUuidMatch = genericContent.match(UUID_REGEX);

  return anyUuidMatch ? anyUuidMatch[0].toLowerCase() : undefined;
}
