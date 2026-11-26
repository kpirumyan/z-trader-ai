import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface PostToolUseInput {
  conversationId?: unknown;
  hookEventName?: unknown;
  error?: unknown;
  cwd?: unknown;
  workspacePaths?: unknown;
  toolCall?: {
    name?: unknown;
    args?: Record<string, unknown>;
  };
}

export interface AutoFixResult {
  status: "fixed" | "skipped" | "error";
  reason?: string;
  filePath?: string;
  prettierRan: boolean;
  error?: string;
}

export interface AutoFixDeps {
  nodeBin?: string;
  pendingDir?: string;
  exists?: (targetPath: string) => boolean;
  isFile?: (targetPath: string) => boolean;
  runNodeScript?: (scriptPath: string, args: string[], cwd: string) => void;
}

export interface PostInvocationInput {
  conversationId?: unknown;
  hookEventName?: unknown;
}

export interface PostInvocationDeps {
  pendingDir?: string;
}

export interface PostInvocationOutput {
  injectSteps?: Array<{
    systemMessage: {
      systemMessage: string;
    };
  }>;
}

const JS_TS_FILE_RE = /\.(js|jsx|mjs|cjs|ts|tsx|mts|cts)$/i;
const MAX_ERROR_LENGTH = 600;
const DEFAULT_PENDING_DIR = path.join(os.tmpdir(), "z-trader-auto-fix");

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

function readBufferOrString(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (Buffer.isBuffer(value)) {
    return value.toString("utf8").trim();
  }

  return "";
}

function extractErrorMessage(err: unknown): string {
  let raw = "";

  if (err !== null && typeof err === "object") {
    const record = err as Record<string, unknown>;

    raw = readBufferOrString(record.stderr) || readBufferOrString(record.stdout);
  }

  if (!raw) {
    raw = err instanceof Error ? err.message.trim() : String(err).trim();
  }

  if (!raw) {
    return "Unknown Prettier error";
  }

  return raw.length > MAX_ERROR_LENGTH ? `${raw.slice(0, MAX_ERROR_LENGTH)}...` : raw;
}

function resolvePendingFilePath(conversationId: string, pendingDir: string): string {
  const safeId = conversationId.replace(/[^a-zA-Z0-9._-]/g, "_");

  return path.join(pendingDir, `${safeId}.json`);
}

function readPendingErrors(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);

    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const result: Record<string, string> = {};

    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string") {
        result[key] = value;
      }
    }

    return result;
  } catch {
    return {};
  }
}

function updatePendingError(
  conversationId: string,
  relativePath: string,
  errorMessage: string | null,
  pendingDir: string,
): void {
  const filePath = resolvePendingFilePath(conversationId, pendingDir);
  const current = readPendingErrors(filePath);
  const normalizedKey = relativePath.replace(/\\/g, "/");

  if (errorMessage === null) {
    if (!(normalizedKey in current)) {
      return;
    }

    delete current[normalizedKey];

    if (Object.keys(current).length === 0) {
      fs.rmSync(filePath, { force: true });

      return;
    }
  } else {
    current[normalizedKey] = errorMessage;
  }

  fs.mkdirSync(pendingDir, { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(current, null, 2)}\n`, "utf8");
}

function safeUpdatePendingError(
  conversationId: string | undefined,
  relativePath: string,
  errorMessage: string | null,
  pendingDir: string,
): void {
  if (conversationId === undefined) {
    return;
  }

  try {
    updatePendingError(conversationId, relativePath, errorMessage, pendingDir);
  } catch {
    // Ignore temp-dir storage errors so the hook never fails on stdout contract.
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
  const pendingDir = deps.pendingDir ?? DEFAULT_PENDING_DIR;
  const conversationId = asNonEmptyString(input.conversationId);
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
      safeUpdatePendingError(conversationId, relativePath, null, pendingDir);
    } catch (err: unknown) {
      const errorMessage = extractErrorMessage(err);

      safeUpdatePendingError(conversationId, relativePath, errorMessage, pendingDir);

      return {
        status: "error",
        filePath: resolvedPath,
        prettierRan,
        error: errorMessage,
      };
    }
  }

  return {
    status: "fixed",
    filePath: resolvedPath,
    prettierRan,
  };
}

export function runPostInvocationHook(
  input: PostInvocationInput,
  deps: PostInvocationDeps = {},
): PostInvocationOutput {
  const conversationId = asNonEmptyString(input.conversationId);

  if (conversationId === undefined) {
    return {};
  }

  const pendingDir = deps.pendingDir ?? DEFAULT_PENDING_DIR;
  const filePath = resolvePendingFilePath(conversationId, pendingDir);
  const entries = readPendingErrors(filePath);

  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath, { force: true });
  }

  const failedFiles = Object.entries(entries);

  if (failedFiles.length === 0) {
    return {};
  }

  const lines = failedFiles.map(([file, message]) => `- ${file}: ${message}`);
  const summary =
    "[auto-fix] Prettier failed after editing the following file(s) (check for syntax errors):\n" +
    lines.join("\n");

  return {
    injectSteps: [
      {
        systemMessage: {
          systemMessage: summary,
        },
      },
    ],
  };
}
