import type { SkillFileMatch, ToolClassificationResult } from "../types.ts";

const SKILL_PATH_PATTERNS = [
  /(?:^|\/)\.agents\/skills\/([a-zA-Z0-9_-]+)\/(.+)$/,
  /(?:^|\/)\.gemini\/config\/skills\/([a-zA-Z0-9_-]+)\/(.+)$/,
  /(?:^|\/)\.gemini\/antigravity\/builtin\/skills\/([a-zA-Z0-9_-]+)\/(.+)$/,
];

const FILE_READ_TOOL_NAMES = new Set(["read_file", "view_file", "readFile", "Read"]);

const RETRIEVER_TOOL_NAMES = new Set([
  "read_file",
  "view_file",
  "view_file_outline",
  "view_code_item",
  "list_dir",
  "find_by_name",
  "grep_search",
  "list_resources",
  "read_resource",
  "search_web",
  "read_url_content",
  "search_marketplace",
  "list_plugin_accounts",
]);

const READ_ONLY_MCP_TOOL_NAMES = new Set([
  "searchLangfuseDocs",
  "getLangfuseDocsPage",
  "getLangfuseOverview",
  "nextjs_docs",
  "nextjs_index",
]);

const READ_ONLY_MCP_PREFIX_REGEX = /^(?:get|list|search|read|fetch|find|lookup|query)(?:[A-Z_]|$)/;

const SUBCOMMAND_CLIS = new Set(["git", "docker", "kubectl", "gh", "cargo", "go"]);

const VALUE_FLAG_BEFORE_SUBCOMMAND = new Set([
  "-C",
  "-c",
  "-n",
  "--git-dir",
  "--work-tree",
  "--context",
  "--namespace",
]);

type CommandSegmentClassification =
  | { kind: "ignore" }
  | { kind: "tool"; label: string }
  | { kind: "evaluator"; label: string }
  | { kind: "guardrail"; label: string };

function readStringField(args: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = args[key];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

export function matchSkillFilePath(rawPath: string): SkillFileMatch | null {
  const normalized = rawPath.replace(/\\/g, "/").trim();

  if (!normalized) {
    return null;
  }

  for (const pattern of SKILL_PATH_PATTERNS) {
    const match = normalized.match(pattern);

    if (match?.[1] && match[2]) {
      const relativePath = match[2].replace(/^\/+/, "");

      if (relativePath) {
        return {
          skillName: match[1],
          relativePath,
        };
      }
    }
  }

  return null;
}

function splitShellSegments(commandLine: string): string[] {
  const segments: string[] = [];
  let current = "";
  let quoteChar: '"' | "'" | null = null;

  for (let i = 0; i < commandLine.length; i++) {
    const ch = commandLine[i];
    const next = commandLine[i + 1];

    if (quoteChar) {
      if (ch === "\\" && quoteChar === '"' && next !== undefined) {
        current += ch + next;
        i++;
        continue;
      }

      if (ch === quoteChar) {
        quoteChar = null;
      }

      current += ch;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quoteChar = ch;
      current += ch;
      continue;
    }

    if ((ch === "&" && next === "&") || (ch === "|" && next === "|")) {
      if (current.trim()) {
        segments.push(current.trim());
      }

      current = "";
      i++;
      continue;
    }

    if (ch === ";" || ch === "\n" || ch === "\r") {
      if (current.trim()) {
        segments.push(current.trim());
      }

      current = "";
      continue;
    }

    current += ch;
  }

  if (current.trim()) {
    segments.push(current.trim());
  }

  return segments;
}

function stripLeadingEnvAndExecWrappers(segment: string): string {
  let remaining = segment.trim();

  // Strip leading POSIX env assignments like FOO=bar BAR="baz"
  while (/^[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s]+)\s+/.test(remaining)) {
    remaining = remaining.replace(/^[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s]+)\s+/, "");
  }

  // Strip optional package runner prefixes (pnpm exec / npx / pnpx)
  remaining = remaining.replace(/^(?:pnpm\s+exec|npx|pnpx)(?:\s+--no-install)?\s+/i, "");

  return remaining.trim();
}

function extractFirstSubcommand(tokens: string[]): string | undefined {
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i].replace(/^["']|["']$/g, "");

    if (!token) {
      continue;
    }

    if (VALUE_FLAG_BEFORE_SUBCOMMAND.has(token)) {
      i++;
      continue;
    }

    if (token.startsWith("-")) {
      continue;
    }

    if (/^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/.test(token)) {
      return token.toLowerCase();
    }

    return undefined;
  }

  return undefined;
}

function deriveGeneralCommandLabel(normalizedSegment: string): string {
  const tokens = normalizedSegment.trim().split(/\s+/).filter(Boolean);

  if (tokens.length === 0) {
    return "run_command";
  }

  const rawCmd = tokens[0].replace(/^["']|["']$/g, "");
  const baseName = rawCmd.split(/[\\/]/).pop() ?? rawCmd;
  const binary = baseName
    .replace(/\.(?:exe|cmd|bat|ps1)$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9:._-]/g, "");

  if (!binary) {
    return "run_command";
  }

  if (SUBCOMMAND_CLIS.has(binary)) {
    const subcommand = extractFirstSubcommand(tokens);

    return subcommand ? `${binary}:${subcommand}` : binary;
  }

  return binary;
}

function classifyPackageScript(scriptName: string): CommandSegmentClassification | null {
  switch (scriptName) {
    case "check:fast":

    case "check":

    case "test:unit":

    case "test:e2e":

    case "test:all":

    case "test":
      return { kind: "evaluator", label: scriptName };

    case "depcruise":

    case "adr:check":

    case "lint":

    case "knip":

    case "typecheck":

    case "format:check":
      return { kind: "guardrail", label: scriptName };

    default:
      if (scriptName.startsWith("test:")) {
        return { kind: "evaluator", label: scriptName };
      }

      return null;
  }
}

function classifyCommandSegment(rawSegment: string): CommandSegmentClassification {
  const trimmed = rawSegment.trim();

  if (!trimmed) {
    return { kind: "ignore" };
  }

  // Changing working directory inside a chained check does not mutate repo state
  if (/^(?:cd|pushd|Set-Location)\s+/i.test(trimmed)) {
    return { kind: "ignore" };
  }

  const normalized = stripLeadingEnvAndExecWrappers(trimmed);

  if (!normalized) {
    return { kind: "ignore" };
  }

  // Match package-manager script invocations: pnpm <script>, pnpm run <script>, npm run <script>, npm test
  const pmScriptMatch = normalized.match(
    /^(?:pnpm|npm|yarn|bun)(?:\s+run)?\s+([a-zA-Z0-9:_-]+)(?:\s|$)/i,
  );

  if (pmScriptMatch?.[1]) {
    const scriptName = pmScriptMatch[1].toLowerCase();

    if (scriptName !== "exec" && scriptName !== "dlx") {
      const classified = classifyPackageScript(scriptName);

      if (classified) {
        return classified;
      }

      // Explicit package scripts like lint:fix, format, adr:new, install, build are tools
      return { kind: "tool", label: scriptName };
    }
  }

  // Direct test runner binaries
  if (/^vitest(?:\s|$)/i.test(normalized)) {
    return { kind: "evaluator", label: "vitest" };
  }

  if (/^playwright\s+test(?:\s|$)/i.test(normalized)) {
    return { kind: "evaluator", label: "playwright" };
  }

  if (/^jest(?:\s|$)/i.test(normalized)) {
    return { kind: "evaluator", label: "jest" };
  }

  if (/^node\b[^\n]*\s--test(?:\s|$)/i.test(normalized)) {
    return { kind: "evaluator", label: "node-test" };
  }

  // Direct guardrail binaries / scripts (only non-mutating check modes)
  if (/^depcruise(?:\s|$)/i.test(normalized)) {
    return { kind: "guardrail", label: "depcruise" };
  }

  if (/^node\s+[^\s]*adr-cli\.mjs\s+check(?:\s|$)/i.test(normalized)) {
    return { kind: "guardrail", label: "adr:check" };
  }

  if (/^eslint(?:\s|$)/i.test(normalized)) {
    if (/(?:^|\s)--fix(?:-dry-run)?(?:\s|$|=)/i.test(normalized)) {
      return { kind: "tool", label: "eslint" };
    }

    return { kind: "guardrail", label: "eslint" };
  }

  if (/^knip(?:\s|$)/i.test(normalized)) {
    return { kind: "guardrail", label: "knip" };
  }

  if (/^tsc(?:\s|$)/i.test(normalized) && /(?:^|\s)--noEmit(?:\s|$)/i.test(normalized)) {
    return { kind: "guardrail", label: "tsc" };
  }

  if (
    /^prettier(?:\s|$)/i.test(normalized) &&
    /(?:^|\s)(?:--check|-c|--list-different|-l)(?:\s|$)/i.test(normalized)
  ) {
    return { kind: "guardrail", label: "prettier:check" };
  }

  return { kind: "tool", label: deriveGeneralCommandLabel(normalized) };
}

function classifyRunCommand(args: Record<string, unknown>): ToolClassificationResult {
  const commandLine = readStringField(args, ["CommandLine", "commandLine", "command"]);

  if (!commandLine) {
    return { type: "tool", observationName: "run_command" };
  }

  const segments = splitShellSegments(commandLine)
    .map((segment) => classifyCommandSegment(segment))
    .filter(
      (classified): classified is Exclude<CommandSegmentClassification, { kind: "ignore" }> =>
        classified.kind !== "ignore",
    );

  if (segments.length === 0) {
    return { type: "tool", observationName: "run_command" };
  }

  if (segments.some((s) => s.kind === "tool")) {
    const distinctLabels = Array.from(
      new Set(segments.map((s) => s.label).filter((label) => label && label !== "run_command")),
    );

    if (distinctLabels.length === 0) {
      return { type: "tool", observationName: "run_command" };
    }

    const summaryLabel =
      distinctLabels.length <= 2
        ? distinctLabels.join("+")
        : `${distinctLabels.slice(0, 2).join("+")}+multi`;

    return {
      type: "tool",
      observationName: `run_command:${summaryLabel}`,
    };
  }

  const evaluators = segments.filter(
    (s): s is { kind: "evaluator"; label: string } => s.kind === "evaluator",
  );

  if (evaluators.length > 0) {
    const distinctLabels = Array.from(new Set(evaluators.map((e) => e.label)));
    const primaryLabel = distinctLabels.length === 1 ? distinctLabels[0] : "eval-suite";

    return {
      type: "evaluator",
      observationName: `run_command:${primaryLabel}`,
    };
  }

  const guardrails = segments.filter(
    (s): s is { kind: "guardrail"; label: string } => s.kind === "guardrail",
  );
  const distinctGuardrailLabels = Array.from(new Set(guardrails.map((g) => g.label)));
  const guardrailLabel =
    distinctGuardrailLabels.length === 1 ? distinctGuardrailLabels[0] : "guardrail-checks";

  return {
    type: "guardrail",
    observationName: `run_command:${guardrailLabel}`,
  };
}

function classifyMcpTool(args: Record<string, unknown>): ToolClassificationResult {
  const serverName = readStringField(args, ["ServerName", "serverName"]);
  const toolName = readStringField(args, ["ToolName", "toolName"]);

  const observationName =
    serverName && toolName
      ? `mcp:${serverName}:${toolName}`
      : toolName
        ? `mcp:${toolName}`
        : "call_mcp_tool";

  if (
    toolName &&
    (READ_ONLY_MCP_TOOL_NAMES.has(toolName) || READ_ONLY_MCP_PREFIX_REGEX.test(toolName))
  ) {
    return {
      type: "retriever",
      observationName,
    };
  }

  return {
    type: "tool",
    observationName,
  };
}

/**
 * Classifies a non-subagent tool call into Langfuse native observation types
 * (`retriever`, `evaluator`, `guardrail`, or `tool`) and derives low-cardinality names.
 */
export function classifyToolCall(
  toolName: string,
  deserializedArgs: Record<string, unknown>,
): ToolClassificationResult {
  if (FILE_READ_TOOL_NAMES.has(toolName)) {
    const filePath = readStringField(deserializedArgs, [
      "Path",
      "path",
      "file_path",
      "AbsolutePath",
    ]);

    if (filePath) {
      const skillMatch = matchSkillFilePath(filePath);

      if (skillMatch) {
        return {
          type: "tool",
          observationName: "skill_read",
          normalizedInput: {
            ...deserializedArgs,
            skillName: skillMatch.skillName,
            path: skillMatch.relativePath,
          },
          skillMatch,
        };
      }
    }

    return {
      type: "retriever",
      observationName: toolName,
    };
  }

  if (RETRIEVER_TOOL_NAMES.has(toolName)) {
    return {
      type: "retriever",
      observationName: toolName,
    };
  }

  if (toolName === "call_mcp_tool") {
    return classifyMcpTool(deserializedArgs);
  }

  if (toolName === "run_command") {
    return classifyRunCommand(deserializedArgs);
  }

  return {
    type: "tool",
    observationName: toolName,
  };
}

/**
 * Derives a low-cardinality event name for a `SYSTEM_MESSAGE` transcript step.
 */
export function classifySystemMessageName(cleanContent: string): string {
  if (/\[BROWSER_HOST_FACTS\]/i.test(cleanContent)) {
    return "system:browser-facts";
  }

  if (/\[Subagent\]/i.test(cleanContent)) {
    return "system:subagent";
  }

  if (/\[Message\]/i.test(cleanContent)) {
    return "system:message";
  }

  if (/\[Notice\]/i.test(cleanContent)) {
    return "system:notice";
  }

  if (/\[(?:Timer|Cron|Schedule)\]/i.test(cleanContent)) {
    return "system:timer";
  }

  return "system:event";
}
