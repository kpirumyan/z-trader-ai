import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface PostToolUseInput {
  hookEventName?: unknown;
  conversationId?: unknown;
  error?: unknown;
  cwd?: unknown;
  workspacePaths?: unknown;
  toolCall?: {
    name?: unknown;
    args?: Record<string, unknown>;
  };
}

interface AutoFixDiagnostic {
  tool: "eslint" | "prettier";
  message: string;
}

export interface AutoFixResult {
  status: "fixed" | "failed" | "skipped";
  reason?: string;
  filePath?: string;
  eslintRan: boolean;
  prettierRan: boolean;
  diagnostics: AutoFixDiagnostic[];
}

export interface PostInvocationOutput {
  injectSteps?: Array<{
    systemMessage: {
      systemMessage: string;
    };
  }>;
}

export interface AutoFixDeps {
  nodeBin?: string;
  diagnosticsDir?: string;
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
const MAX_DIAGNOSTIC_CHARS = 2000;
const ANSI_ESCAPE_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

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

function extractProcessOutput(err: unknown): string {
  const chunks: string[] = [];

  if (err !== null && typeof err === "object") {
    const record = err as { stdout?: unknown; stderr?: unknown; message?: unknown };

    for (const stream of [record.stdout, record.stderr]) {
      if (typeof stream === "string" && stream.trim()) {
        chunks.push(stream.trim());
      } else if (Buffer.isBuffer(stream)) {
        const text = stream.toString("utf8").trim();

        if (text) {
          chunks.push(text);
        }
      }
    }

    if (chunks.length === 0 && typeof record.message === "string" && record.message.trim()) {
      chunks.push(record.message.trim());
    }
  } else if (err instanceof Error && err.message.trim()) {
    chunks.push(err.message.trim());
  }

  const combined = (chunks.join("\n") || String(err)).replace(ANSI_ESCAPE_RE, "").trim();

  if (combined.length <= MAX_DIAGNOSTIC_CHARS) {
    return combined;
  }

  return `${combined.slice(0, MAX_DIAGNOSTIC_CHARS)}\n...[truncated]`;
}

function resolveDiagnosticsFilePath(
  input: PostToolUseInput,
  workspaceRoot: string,
  diagnosticsDir?: string,
): string {
  const baseDir = diagnosticsDir ?? path.join(os.tmpdir(), "z-trader-auto-fix");
  const rawConvId = asNonEmptyString(input.conversationId);
  const key = rawConvId
    ? rawConvId.replace(/[^a-zA-Z0-9._-]/g, "_")
    : crypto.createHash("sha256").update(workspaceRoot).digest("hex").slice(0, 16);

  return path.join(baseDir, `${key}.json`);
}

function readDiagnosticsMap(filePath: string): Record<string, AutoFixDiagnostic[]> {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;

    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, AutoFixDiagnostic[]>;
    }
  } catch {
    // Ignore corrupt diagnostics state and overwrite cleanly.
  }

  return {};
}

function updatePendingDiagnostics(
  filePath: string,
  relativePosixPath: string,
  diagnostics: AutoFixDiagnostic[],
): void {
  const map = readDiagnosticsMap(filePath);

  if (diagnostics.length > 0) {
    map[relativePosixPath] = diagnostics;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(map, null, 2), "utf8");

    return;
  }

  if (relativePosixPath in map) {
    delete map[relativePosixPath];

    if (Object.keys(map).length === 0) {
      fs.rmSync(filePath, { force: true });
    } else {
      fs.writeFileSync(filePath, JSON.stringify(map, null, 2), "utf8");
    }
  }
}

export function runAutoFixHook(
  input: PostToolUseInput,
  fallbackRoot: string,
  deps: AutoFixDeps = {},
): AutoFixResult {
  const errorText = asNonEmptyString(input.error);

  if (errorText !== undefined) {
    return {
      status: "skipped",
      reason: "tool-failed",
      eslintRan: false,
      prettierRan: false,
      diagnostics: [],
    };
  }

  const rawTarget = extractTargetFilePath(input);

  if (rawTarget === undefined) {
    return {
      status: "skipped",
      reason: "no-file-path",
      eslintRan: false,
      prettierRan: false,
      diagnostics: [],
    };
  }

  const workspaceRoot = resolveWorkspaceRoot(input, fallbackRoot);
  const baseDir = asNonEmptyString(input.cwd) ?? workspaceRoot;
  const resolvedPath = path.resolve(baseDir, rawTarget);
  const relativePath = path.relative(workspaceRoot, resolvedPath);

  if (relativePath === "" || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return {
      status: "skipped",
      reason: "outside-workspace",
      eslintRan: false,
      prettierRan: false,
      diagnostics: [],
    };
  }

  if (isInsideIgnoredSegment(relativePath)) {
    return {
      status: "skipped",
      reason: "ignored-path",
      eslintRan: false,
      prettierRan: false,
      diagnostics: [],
    };
  }

  const exists = deps.exists ?? fs.existsSync;
  const isFile = deps.isFile ?? defaultIsFile;

  if (!exists(resolvedPath) || !isFile(resolvedPath)) {
    return {
      status: "skipped",
      reason: "missing-file",
      eslintRan: false,
      prettierRan: false,
      diagnostics: [],
    };
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

  const eslintBin = path.join(workspaceRoot, "node_modules", "eslint", "bin", "eslint.js");
  const prettierBin = path.join(workspaceRoot, "node_modules", "prettier", "bin", "prettier.cjs");
  const isJsTs = JS_TS_FILE_RE.test(resolvedPath);
  const diagnostics: AutoFixDiagnostic[] = [];
  let eslintRan = false;
  let prettierRan = false;

  if (isJsTs && exists(eslintBin)) {
    eslintRan = true;

    try {
      runNodeScript(eslintBin, ["--fix", "--max-warnings", "0", resolvedPath], workspaceRoot);
    } catch (err: unknown) {
      diagnostics.push({ tool: "eslint", message: extractProcessOutput(err) });
    }
  }

  if (exists(prettierBin)) {
    prettierRan = true;

    try {
      const prettierArgs = isJsTs
        ? ["--write", resolvedPath]
        : ["--write", "--ignore-unknown", resolvedPath];

      runNodeScript(prettierBin, prettierArgs, workspaceRoot);
    } catch (err: unknown) {
      diagnostics.push({ tool: "prettier", message: extractProcessOutput(err) });
    }
  }

  const relativePosixPath = relativePath.replace(/\\/g, "/");
  const diagnosticsFilePath = resolveDiagnosticsFilePath(input, workspaceRoot, deps.diagnosticsDir);

  updatePendingDiagnostics(diagnosticsFilePath, relativePosixPath, diagnostics);

  return {
    status: diagnostics.length > 0 ? "failed" : "fixed",
    filePath: resolvedPath,
    eslintRan,
    prettierRan,
    diagnostics,
  };
}

export function flushAutoFixDiagnostics(
  input: PostToolUseInput,
  fallbackRoot: string,
  deps: Pick<AutoFixDeps, "diagnosticsDir"> = {},
): PostInvocationOutput {
  const workspaceRoot = resolveWorkspaceRoot(input, fallbackRoot);
  const diagnosticsFilePath = resolveDiagnosticsFilePath(input, workspaceRoot, deps.diagnosticsDir);

  if (!fs.existsSync(diagnosticsFilePath)) {
    return {};
  }

  const map = readDiagnosticsMap(diagnosticsFilePath);

  fs.rmSync(diagnosticsFilePath, { force: true });

  const entries = Object.entries(map);

  if (entries.length === 0) {
    return {};
  }

  const lines = ["[auto-fix] Unfixable lint/format errors detected after file edit:"];

  for (const [file, items] of entries) {
    for (const item of items) {
      lines.push(`- ${file} (${item.tool}):\n${item.message}`);
    }
  }

  return {
    injectSteps: [
      {
        systemMessage: {
          systemMessage: lines.join("\n"),
        },
      },
    ],
  };
}
