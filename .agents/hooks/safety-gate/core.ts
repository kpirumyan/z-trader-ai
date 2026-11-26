export interface PreToolUseInput {
  toolCall?: {
    name?: unknown;
    args?: Record<string, unknown>;
  };
}

export interface PreToolUseDecision {
  decision: "allow" | "deny";
  reason?: string;
}

const COMMAND_ARG_KEYS = ["CommandLine", "commandLine", "command"] as const;

const GIT_GLOBAL_ARGS_WITH_VALUE = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--super-prefix",
  "--exec-path",
  "--config-env",
]);

const NO_VERIFY_GIT_SUBCOMMANDS = new Set(["commit", "push", "merge", "cherry-pick", "am"]);

const SHELL_WRAPPERS = new Set([
  "sh",
  "bash",
  "zsh",
  "cmd",
  "cmd.exe",
  "pwsh",
  "powershell",
  "powershell.exe",
]);

const SHELL_INLINE_FLAGS = new Set(["-c", "/c", "-command"]);

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : undefined;
}

/** Extracts the raw command string from a PreToolUse `run_command` payload. */
export function extractCommandLine(input: PreToolUseInput): string | undefined {
  const args = input.toolCall?.args;

  if (args === undefined || args === null || typeof args !== "object") {
    return undefined;
  }

  for (const key of COMMAND_ARG_KEYS) {
    const candidate = asNonEmptyString(args[key]);

    if (candidate !== undefined) {
      return candidate;
    }
  }

  return undefined;
}

function splitCommandSegments(commandLine: string): string[][] {
  const segments: string[][] = [];
  let currentSegment: string[] = [];
  let currentValue = "";
  let hasToken = false;
  let quoteChar: "'" | '"' | null = null;

  const pushToken = (): void => {
    if (!hasToken) {
      return;
    }

    currentSegment.push(currentValue);
    currentValue = "";
    hasToken = false;
  };

  const pushSegment = (): void => {
    pushToken();

    if (currentSegment.length > 0) {
      segments.push(currentSegment);
      currentSegment = [];
    }
  };

  for (let i = 0; i < commandLine.length; i++) {
    const ch = commandLine[i];

    if (quoteChar !== null) {
      if (ch === "\\" && quoteChar === '"' && i + 1 < commandLine.length) {
        currentValue += commandLine[i + 1];
        i++;
        continue;
      }

      if (ch === quoteChar) {
        quoteChar = null;
        continue;
      }

      currentValue += ch;
      continue;
    }

    if (ch === "'" || ch === '"') {
      quoteChar = ch;
      hasToken = true;
      continue;
    }

    if (ch === ";" || ch === "\n" || ch === "\r" || ch === "|") {
      if (ch === "|" && commandLine[i + 1] === "|") {
        i++;
      }

      pushSegment();
      continue;
    }

    if (ch === "&" && commandLine[i + 1] === "&") {
      i++;
      pushSegment();
      continue;
    }

    if (/\s/.test(ch)) {
      pushToken();
      continue;
    }

    currentValue += ch;
    hasToken = true;
  }

  pushSegment();

  return segments;
}

function baseCommandName(tokenValue: string): string {
  const parts = tokenValue.split(/[/\\]/);

  return (parts[parts.length - 1] ?? tokenValue).toLowerCase();
}

function isEnvAssignment(value: string): boolean {
  return /^(?:\$env:)?[A-Za-z_][A-Za-z0-9_]*=/.test(value);
}

function checkSegmentForHookBypass(tokens: string[], depth: number): string | null {
  let idx = 0;
  let huskyDisabled = false;

  while (idx < tokens.length && isEnvAssignment(tokens[idx])) {
    const assignment = tokens[idx];

    if (/^(?:\$env:)?HUSKY=0$/i.test(assignment)) {
      huskyDisabled = true;
    }

    idx++;
  }

  if (idx >= tokens.length) {
    return null;
  }

  const cmdName = baseCommandName(tokens[idx]);

  // Recursively inspect inline subshell strings such as `cmd /c "git commit --no-verify"`.
  if (depth < 3 && SHELL_WRAPPERS.has(cmdName)) {
    for (let j = idx + 1; j + 1 < tokens.length; j++) {
      if (SHELL_INLINE_FLAGS.has(tokens[j].toLowerCase())) {
        const nestedReason = findHookBypassReason(tokens[j + 1], depth + 1);

        if (nestedReason !== null) {
          return nestedReason;
        }
      }
    }

    return null;
  }

  if (cmdName !== "git" && cmdName !== "git.exe") {
    return null;
  }

  if (huskyDisabled) {
    return "Blocked `HUSKY=0 git ...`: bypassing git hooks is forbidden.";
  }

  let subcommand: string | null = null;
  let afterDoubleDash = false;
  let skipNextArg = false;

  for (let j = idx + 1; j < tokens.length; j++) {
    const val = tokens[j];

    if (skipNextArg) {
      if (subcommand === null && /^core\.hooksPath=/i.test(val)) {
        return "Blocked `git -c core.hooksPath=...`: overriding git hooks is forbidden.";
      }

      skipNextArg = false;
      continue;
    }

    if (afterDoubleDash) {
      continue;
    }

    if (val === "--") {
      afterDoubleDash = true;
      continue;
    }

    if (subcommand === null) {
      if (val.startsWith("-")) {
        if (GIT_GLOBAL_ARGS_WITH_VALUE.has(val)) {
          skipNextArg = true;
        } else if (/^-ccore\.hooksPath=/i.test(val)) {
          return "Blocked `git -ccore.hooksPath=...`: overriding git hooks is forbidden.";
        }

        continue;
      }

      subcommand = val.toLowerCase();
      continue;
    }

    if (!NO_VERIFY_GIT_SUBCOMMANDS.has(subcommand)) {
      continue;
    }

    if (val === "-m" || val === "--message" || val === "-F" || val === "--file") {
      skipNextArg = true;
      continue;
    }

    if (val === "--no-verify" || val.startsWith("--no-verify=")) {
      return `Blocked \`git ${subcommand} --no-verify\`: bypassing pre-commit/pre-push checks is forbidden.`;
    }

    if (subcommand === "commit" && val.startsWith("-") && !val.startsWith("--")) {
      const shortFlags = val.slice(1);

      if (shortFlags.includes("n")) {
        return "Blocked `git commit -n`: bypassing pre-commit checks is forbidden.";
      }

      if (shortFlags.includes("m") || shortFlags.includes("F")) {
        // Only treat the next token as message/file if it wasn't inline after -m/-F.
        const flagIdx = shortFlags.search(/[mF]/);

        if (flagIdx === shortFlags.length - 1) {
          skipNextArg = true;
        }
      }
    }
  }

  return null;
}

function findHookBypassReason(commandLine: string, depth = 0): string | null {
  const segments = splitCommandSegments(commandLine);

  for (const segment of segments) {
    const reason = checkSegmentForHookBypass(segment, depth);

    if (reason !== null) {
      return reason;
    }
  }

  return null;
}

/** Evaluates a PreToolUse payload and blocks git hook bypass flags (`--no-verify`, `-n`, `HUSKY=0`). */
export function evaluateSafetyGate(input: PreToolUseInput): PreToolUseDecision {
  const commandLine = extractCommandLine(input);

  if (commandLine === undefined) {
    return { decision: "allow" };
  }

  const bypassReason = findHookBypassReason(commandLine);

  if (bypassReason !== null) {
    return {
      decision: "deny",
      reason: bypassReason,
    };
  }

  return { decision: "allow" };
}
