import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { LangfuseSpanProcessor } from "@langfuse/otel";
import {
  createTraceId,
  propagateAttributes,
  setLangfuseTracerProvider,
  startObservation,
} from "@langfuse/tracing";
import { NodeSDK } from "@opentelemetry/sdk-node";

import {
  createFilesystemSubagentResolver,
  parseTranscriptTurns,
  resolveFullTranscriptPath,
  type ParsedAgentObservation,
  type ParsedChildObservation,
  type ParsedTurnTrace,
} from "./transcript-parser.ts";

export interface StopHookInput {
  conversationId?: string;
  transcriptPath?: string;
  modelName?: string;
  cwd?: string;
  workspacePaths?: string[];
}

export interface ContextAnchor {
  gitSha: string;
  gitShortSha: string;
  gitBranch: string;
  isDirty: boolean;
  agentsHash: string;
  version: string;
}

export interface LangfuseCursorState {
  lastExportedStepIndex: number;
  lastExportedTurnIndex: number;
  updatedAt: string;
}

interface PendingExportSpool {
  pendingTurns: ParsedTurnTrace[];
  updatedAt: string;
}

type SpanExporterLike = NonNullable<
  ConstructorParameters<typeof LangfuseSpanProcessor>[0]
>["exporter"];

type TracerProviderLike = Parameters<typeof setLangfuseTracerProvider>[0];

type ParentSpanContextLike = NonNullable<
  Parameters<typeof startObservation>[2]
>["parentSpanContext"];

export interface RunStopHookOptions {
  dryRun?: boolean;
  persistCursorInDryRun?: boolean;
  timeoutMs?: number;
  spanExporter?: SpanExporterLike;
  simulateFlushFailure?: Error;
  onWarning?: (message: string) => void;
}

export interface RunStopHookResult {
  decision: "allow";
  exportedTurns: number;
  spooledTurns: number;
  version: string;
  dryRun: boolean;
  summary: Array<{
    turnIndex: number;
    traceId: string;
    childCount: number;
    tags: string[];
    totalTokens: number;
  }>;
}

const DEFAULT_TIMEOUT_MS = 4500;
const SYNTHETIC_PARENT_SPAN_ID = "0123456789abcdef";

function runGitCommand(workspaceRoot: string, args: string[], fallback: string): string {
  try {
    const out = execFileSync("git", args, {
      cwd: workspaceRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });

    return out.trim() || fallback;
  } catch {
    return fallback;
  }
}

function collectAgentCustomizationFiles(dirPath: string, rootDir: string, out: string[]): void {
  if (!fs.existsSync(dirPath)) {
    return;
  }

  let entries: fs.Dirent[];

  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (
      entry.name === "tests" ||
      entry.name === "node_modules" ||
      entry.name.startsWith(".langfuse-") ||
      entry.name.startsWith(".pending-")
    ) {
      continue;
    }

    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      collectAgentCustomizationFiles(fullPath, rootDir, out);
    } else if (entry.isFile()) {
      const relPosix = path.relative(rootDir, fullPath).replace(/\\/g, "/");

      out.push(relPosix);
    }
  }
}

/**
 * Computes the deterministic release/version identifier (`${gitShortSha}-${agentsHash}`)
 * and Git workspace state for trace correlation.
 */
export function computeContextAnchor(workspaceRoot: string): ContextAnchor {
  const gitSha = runGitCommand(
    workspaceRoot,
    ["rev-parse", "HEAD"],
    "0000000000000000000000000000000000000000",
  );
  const gitShortSha = gitSha.slice(0, 7);
  const gitBranch = runGitCommand(workspaceRoot, ["rev-parse", "--abbrev-ref", "HEAD"], "unknown");
  const porcelain = runGitCommand(workspaceRoot, ["status", "--porcelain"], "");
  const isDirty = porcelain.length > 0;

  const filesToHash: string[] = [];
  const agentsMdPath = path.join(workspaceRoot, "AGENTS.md");

  if (fs.existsSync(agentsMdPath)) {
    filesToHash.push("AGENTS.md");
  }

  collectAgentCustomizationFiles(path.join(workspaceRoot, ".agents"), workspaceRoot, filesToHash);
  filesToHash.sort((a, b) => a.localeCompare(b));

  const hash = crypto.createHash("sha256");

  for (const relPath of filesToHash) {
    try {
      const content = fs.readFileSync(path.join(workspaceRoot, relPath), "utf8");
      const normalized = content.replace(/\r\n/g, "\n");

      hash.update(`${relPath}\n${normalized}\n`, "utf8");
    } catch {
      // Skip unreadable file
    }
  }

  const agentsHash = hash.digest("hex").slice(0, 8);
  const version = `${gitShortSha}-${agentsHash}`;

  return {
    gitSha,
    gitShortSha,
    gitBranch,
    isDirty,
    agentsHash,
    version,
  };
}

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

function readCursorState(cursorPath: string): LangfuseCursorState | null {
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

function writeCursorState(cursorPath: string, state: LangfuseCursorState): void {
  fs.writeFileSync(cursorPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function readPendingSpool(spoolPath: string): ParsedTurnTrace[] {
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

function writePendingSpool(spoolPath: string, turns: ParsedTurnTrace[]): void {
  const payload: PendingExportSpool = {
    pendingTurns: turns,
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(spoolPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function mergeTurnsForExport(
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

function maybeLoadEnvLocal(workspaceRoot: string): void {
  if (process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY) {
    return;
  }

  const envLocalPath = path.join(workspaceRoot, ".env.local");

  if (!fs.existsSync(envLocalPath)) {
    return;
  }

  try {
    if (typeof process.loadEnvFile === "function") {
      process.loadEnvFile(envLocalPath);
    }
  } catch {
    // Ignore env loading errors
  }
}

function emitChildObservations(
  children: ParsedChildObservation[],
  parentSpanContext: ParentSpanContextLike,
): void {
  for (const child of children) {
    if (child.type === "generation") {
      const genObs = startObservation(
        child.name,
        {
          model: child.model,
          input: child.input,
          output: child.output,
          usageDetails: child.usageDetails,
          metadata: child.metadata,
          level: child.level,
          statusMessage: child.statusMessage,
        },
        {
          asType: "generation",
          startTime: child.startTime,
          parentSpanContext,
        },
      );

      genObs.end(child.endTime);
    } else if (child.type === "tool") {
      const toolObs = startObservation(
        child.name,
        {
          input: child.input,
          output: child.output,
          level: child.level,
          statusMessage: child.statusMessage,
          metadata: child.metadata,
        },
        {
          asType: "tool",
          startTime: child.startTime,
          parentSpanContext,
        },
      );

      toolObs.end(child.endTime);
    } else if (child.type === "agent") {
      const subagentObs = startObservation(
        child.name,
        {
          input: child.input,
          output: child.output,
          level: child.level,
          statusMessage: child.statusMessage,
          metadata: {
            ...child.metadata,
            usageSummary: child.usageSummary,
          },
        },
        {
          asType: "agent",
          startTime: child.startTime,
          parentSpanContext,
        },
      );

      emitChildObservations(child.children, subagentObs.otelSpan.spanContext());
      subagentObs.end(child.endTime);
    }
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

function createNoopSpanExporter(): SpanExporterLike {
  return {
    export(_spans, resultCallback) {
      resultCallback({ code: 0 });
    },
    shutdown: async () => {},
  };
}

/**
 * Executes the Antigravity Stop hook workflow:
 * 1. Resolves `transcript_full.jsonl` and loads cursor + pending spool state.
 * 2. Parses unexported turns into the Langfuse v6 observation hierarchy.
 * 3. Emits OpenTelemetry spans via `NodeSDK` + `LangfuseSpanProcessor`.
 * 4. Soft fails open with a 5s budget, saving unexported turns to `.pending-export.json` on failure.
 */
export async function runStopHook(
  input: StopHookInput,
  options: RunStopHookOptions = {},
): Promise<RunStopHookResult> {
  const workspaceRoot = input.cwd ?? input.workspacePaths?.[0] ?? process.cwd();

  maybeLoadEnvLocal(workspaceRoot);

  const contextAnchor = computeContextAnchor(workspaceRoot);
  const hasCredentials = Boolean(
    process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY,
  );
  const dryRun =
    options.dryRun ?? (process.env.LANGFUSE_DRY_RUN === "1" || (! options.spanExporter && !hasCredentials));

  if (!input.transcriptPath) {
    return {
      decision: "allow",
      exportedTurns: 0,
      spooledTurns: 0,
      version: contextAnchor.version,
      dryRun,
      summary: [],
    };
  }

  const resolvedTranscriptPath = resolveFullTranscriptPath(input.transcriptPath);

  if (!fs.existsSync(resolvedTranscriptPath)) {
    return {
      decision: "allow",
      exportedTurns: 0,
      spooledTurns: 0,
      version: contextAnchor.version,
      dryRun,
      summary: [],
    };
  }

  const transcriptDir = path.dirname(resolvedTranscriptPath);
  const cursorPath = path.join(transcriptDir, ".langfuse-cursor.json");
  const spoolPath = path.join(transcriptDir, ".pending-export.json");

  const cursor = readCursorState(cursorPath);
  const spooledTurns = readPendingSpool(spoolPath);

  const rawTranscript = fs.readFileSync(resolvedTranscriptPath, "utf8");
  const conversationId =
    input.conversationId ?? path.basename(path.resolve(transcriptDir, "..", ".."));

  const newlyParsedTurns = parseTranscriptTurns(rawTranscript, {
    conversationId,
    modelName: input.modelName,
    afterStepIndex: cursor?.lastExportedStepIndex,
    resolveSubagentTranscript: createFilesystemSubagentResolver(resolvedTranscriptPath),
  });

  const turnsToExport = mergeTurnsForExport(spooledTurns, newlyParsedTurns);

  if (turnsToExport.length === 0) {
    return {
      decision: "allow",
      exportedTurns: 0,
      spooledTurns: 0,
      version: contextAnchor.version,
      dryRun,
      summary: [],
    };
  }

  const exporter = options.spanExporter ?? (dryRun ? createNoopSpanExporter() : undefined);
  const processor = new LangfuseSpanProcessor({
    exporter,
    exportMode: exporter ? "immediate" : "batched",
    publicKey: process.env.LANGFUSE_PUBLIC_KEY ?? "pk-lf-dry-run",
    secretKey: process.env.LANGFUSE_SECRET_KEY ?? "sk-lf-dry-run",
    baseUrl: process.env.LANGFUSE_BASE_URL ?? process.env.LANGFUSE_HOST,
    release: contextAnchor.version,
    environment: process.env.LANGFUSE_TRACING_ENVIRONMENT ?? "development",
    mediaUploadEnabled: false,
    timeout: 4,
  });

  const sdk = new NodeSDK({
    spanProcessors: [processor],
    logRecordProcessors: [],
    autoDetectResources: false,
  });

  const summary: RunStopHookResult["summary"] = [];
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  try {
    sdk.start();

    const internalProvider = (sdk as unknown as { _tracerProvider?: TracerProviderLike })
      ._tracerProvider;

    if (internalProvider) {
      setLangfuseTracerProvider(internalProvider);
    }

    for (const turn of turnsToExport) {
      const traceId = await createTraceId(turn.traceSeed);

      summary.push({
        turnIndex: turn.turnIndex,
        traceId,
        childCount: turn.children.length,
        tags: turn.tags,
        totalTokens: turn.usageSummary.total,
      });

      await propagateAttributes(
        {
          sessionId: turn.sessionId,
          version: contextAnchor.version,
          tags: turn.tags,
          traceName: "agent-turn",
          metadata: {
            gitSha: contextAnchor.gitSha.slice(0, 120),
            gitBranch: contextAnchor.gitBranch.slice(0, 120),
            isDirty: String(contextAnchor.isDirty),
            turnIndex: String(turn.turnIndex),
          },
        },
        async () => {
          const rootObs = startObservation(
            "agent-turn",
            {
              input: turn.input,
              output: turn.output,
              metadata: {
                ...turn.metadata,
                gitSha: contextAnchor.gitSha,
                gitBranch: contextAnchor.gitBranch,
                isDirty: contextAnchor.isDirty,
                usageSummary: turn.usageSummary,
              },
            },
            {
              asType: "agent",
              startTime: turn.startTime,
              parentSpanContext: {
                traceId,
                spanId: SYNTHETIC_PARENT_SPAN_ID,
                traceFlags: 1,
              },
            },
          );

          emitChildObservations(turn.children, rootObs.otelSpan.spanContext());
          rootObs.end(turn.endTime);
        },
      );
    }

    if (options.simulateFlushFailure) {
      throw options.simulateFlushFailure;
    }

    await withTimeout(
      (async () => {
        await processor.forceFlush();
        await sdk.shutdown();
      })(),
      timeoutMs,
      "Langfuse span export flush",
    );

    const shouldPersistState = !dryRun || options.persistCursorInDryRun === true;

    if (shouldPersistState) {
      const lastTurn = turnsToExport[turnsToExport.length - 1]!;

      writeCursorState(cursorPath, {
        lastExportedStepIndex: Math.max(
          cursor?.lastExportedStepIndex ?? -1,
          lastTurn.endStepIndex,
        ),
        lastExportedTurnIndex: Math.max(cursor?.lastExportedTurnIndex ?? -1, lastTurn.turnIndex),
        updatedAt: new Date().toISOString(),
      });

      if (fs.existsSync(spoolPath)) {
        fs.rmSync(spoolPath, { force: true });
      }
    }

    return {
      decision: "allow",
      exportedTurns: turnsToExport.length,
      spooledTurns: 0,
      version: contextAnchor.version,
      dryRun,
      summary,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const warnFn =
      options.onWarning ??
      ((msg: string) => {
        process.stderr.write(`[langfuse-stop-hook] Warn: ${msg}\n`);
      });

    warnFn(`Failed to export ${turnsToExport.length} turn(s) to Langfuse: ${message}`);

    try {
      writePendingSpool(spoolPath, turnsToExport);
    } catch {
      // Ignore secondary spool write failure
    }

    try {
      await sdk.shutdown();
    } catch {
      // Ignore shutdown error during fail-open
    }

    return {
      decision: "allow",
      exportedTurns: 0,
      spooledTurns: turnsToExport.length,
      version: contextAnchor.version,
      dryRun,
      summary,
    };
  } finally {
    setLangfuseTracerProvider(null);
  }
}

async function readStdinText(skipIfIdleMs = 100): Promise<string> {
  if (process.stdin.isTTY) {
    return "";
  }

  return new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    let resolved = false;

    const finish = (value: string) => {
      if (resolved) {
        return;
      }

      resolved = true;
      clearTimeout(idleTimer);
      process.stdin.pause();
      resolve(value);
    };

    const idleTimer = setTimeout(() => {
      if (chunks.length === 0) {
        finish("");
      }
    }, skipIfIdleMs);

    process.stdin.on("data", (chunk: Buffer | string) => {
      clearTimeout(idleTimer);
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk);
    });

    process.stdin.on("end", () => {
      finish(Buffer.concat(chunks).toString("utf8"));
    });

    process.stdin.on("error", () => {
      finish("");
    });
  });
}

function parseCliArgs(argv: string[]): {
  dryRun: boolean;
  transcriptPath?: string;
  conversationId?: string;
} {
  let dryRun = false;
  let transcriptPath: string | undefined;
  let conversationId: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--transcript" && argv[i + 1]) {
      transcriptPath = argv[i + 1];
      i++;
    } else if (arg === "--conversation-id" && argv[i + 1]) {
      conversationId = argv[i + 1];
      i++;
    }
  }

  return { dryRun, transcriptPath, conversationId };
}

async function main(): Promise<void> {
  try {
    const cli = parseCliArgs(process.argv.slice(2));
    const stdinRaw = await readStdinText();
    let hookInput: StopHookInput = {};

    if (stdinRaw.trim().length > 0) {
      try {
        const parsed = JSON.parse(stdinRaw) as Record<string, unknown>;

        hookInput = {
          conversationId:
            typeof parsed.conversationId === "string"
              ? parsed.conversationId
              : typeof parsed.session_id === "string"
                ? parsed.session_id
                : undefined,
          transcriptPath:
            typeof parsed.transcriptPath === "string"
              ? parsed.transcriptPath
              : typeof parsed.transcript_path === "string"
                ? parsed.transcript_path
                : undefined,
          modelName: typeof parsed.modelName === "string" ? parsed.modelName : undefined,
          cwd: typeof parsed.cwd === "string" ? parsed.cwd : undefined,
          workspacePaths: Array.isArray(parsed.workspacePaths)
            ? parsed.workspacePaths.filter((p): p is string => typeof p === "string")
            : undefined,
        };
      } catch {
        // Ignore malformed stdin JSON
      }
    }

    if (cli.transcriptPath) {
      hookInput.transcriptPath = cli.transcriptPath;
    }

    if (cli.conversationId) {
      hookInput.conversationId = cli.conversationId;
    }

    const result = await runStopHook(hookInput, {
      dryRun: cli.dryRun ? true : undefined,
    });

    if (cli.dryRun) {
      process.stderr.write(
        `[langfuse-stop-hook] Dry-run summary: ${JSON.stringify(
          {
            version: result.version,
            exportedTurns: result.exportedTurns,
            summary: result.summary,
          },
          null,
          2,
        )}\n`,
      );
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    process.stderr.write(`[langfuse-stop-hook] Unhandled error: ${message}\n`);
  }

  process.stdout.write(`${JSON.stringify({ decision: "allow" })}\n`);
}

const isMainModule =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMainModule) {
  void main();
}
