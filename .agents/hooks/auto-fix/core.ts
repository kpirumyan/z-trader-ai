import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface PostToolUseInput {
  error?: unknown;
  cwd?: unknown;
  workspacePaths?: unknown;
  toolCall?: {
    name?: unknown;
    args?: Record<string, unknown>;
  };
}

export interface AutoFixResult {
  status: "fixed" | "skipped";
  reason?: string;
  filePath?: string;
  prettierRan: boolean;
}

export interface AutoFixDeps {
  nodeBin?: string;
  exists?: (targetPath: string) => boolean;
  isFile?: (targetPath: string) => boolean;
  runNodeScript?: (scriptPath: string, args: string[], cwd: string) => void;
}

const JS_TS_FILE_RE = /\.(js|jsx|mjs|cjs|ts|tsx|mts|cts)$/i;

const IGNORED_SEGMENTS = new Set([
  "node_modules",
  ".git",
  ".next",
  "out",
  "build",
  "coverage",
  "test-results",
  "playwright-report",
]);

const PATH_ARG_KEYS = ["Path", "TargetFile", "AbsolutePath", "file_path", "path"] as const;

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : undefined;
}

function resolveWorkspaceRoot(input: PostToolUseInput, fallbackRoot: string): string {
  if (Array.isArray(input.workspacePaths)) {
    const validWorkspace = input.workspacePaths.find(
      (item): item is string => typeof item === "string" && item.trim().length > 0,
    );

    if (validWorkspace !== undefined) {
      return path.resolve(validWorkspace.trim());
    }
  }

  const inputCwd = asNonEmptyString(input.cwd);

  if (inputCwd !== undefined) {
    return path.resolve(inputCwd);
  }

  return path.resolve(fallbackRoot);
}

export function extractTargetFilePath(input: PostToolUseInput): string | undefined {
  const args = input.toolCall?.args;

  if (args === undefined || args === null || typeof args !== "object") {
    return undefined;
  }

  for (const key of PATH_ARG_KEYS) {
    const candidate = asNonEmptyString(args[key]);

    if (candidate !== undefined) {
      return candidate;
    }
  }

  return undefined;
}

function isInsideIgnoredSegment(relativePath: string): boolean {
  const segments = relativePath.split(/[/\\]+/);

  return segments.some((segment) => {
    if (IGNORED_SEGMENTS.has(segment)) {
      return true;
    }

    return segment === ".env" || segment.startsWith(".env.");
  });
}

function defaultIsFile(targetPath: string): boolean {
  try {
    return fs.statSync(targetPath).isFile();
  } catch {
    return false;
  }
}

export function runAutoFixHook(
  input: PostToolUseInput,
  fallbackRoot: string,
  deps: AutoFixDeps = {},
): AutoFixResult {
  const errorText = asNonEmptyString(input.error);

  if (errorText !== undefined) {
    return { status: "skipped", reason: "tool-failed", prettierRan: false };
  }

  const rawTarget = extractTargetFilePath(input);

  if (rawTarget === undefined) {
    return { status: "skipped", reason: "no-file-path", prettierRan: false };
  }

  const workspaceRoot = resolveWorkspaceRoot(input, fallbackRoot);
  const baseDir = asNonEmptyString(input.cwd) ?? workspaceRoot;
  const resolvedPath = path.resolve(baseDir, rawTarget);
  const relativePath = path.relative(workspaceRoot, resolvedPath);

  if (relativePath === "" || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return { status: "skipped", reason: "outside-workspace", prettierRan: false };
  }

  if (isInsideIgnoredSegment(relativePath)) {
    return { status: "skipped", reason: "ignored-path", prettierRan: false };
  }

  const exists = deps.exists ?? fs.existsSync;
  const isFile = deps.isFile ?? defaultIsFile;

  if (!exists(resolvedPath) || !isFile(resolvedPath)) {
    return { status: "skipped", reason: "missing-file", prettierRan: false };
  }

  const nodeBin = deps.nodeBin ?? process.execPath;
  const runNodeScript =
    deps.runNodeScript ??
    ((scriptPath: string, args: string[], cwd: string): void => {
      execFileSync(nodeBin, [scriptPath, ...args], {
        cwd,
        stdio: "pipe",
      });
    });

  const prettierBin = path.join(workspaceRoot, "node_modules", "prettier", "bin", "prettier.cjs");
  const isJsTs = JS_TS_FILE_RE.test(resolvedPath);
  let prettierRan = false;

  if (exists(prettierBin)) {
    prettierRan = true;

    try {
      const prettierArgs = isJsTs
        ? ["--write", resolvedPath]
        : ["--write", "--ignore-unknown", resolvedPath];

      runNodeScript(prettierBin, prettierArgs, workspaceRoot);
    } catch {
      // Prettier errors (such as syntax errors mid-edit) are surfaced by check:fast.
    }
  }

  return {
    status: "fixed",
    filePath: resolvedPath,
    prettierRan,
  };
}
