import crypto from "node:crypto";

import { isDefaultExportSpan, LangfuseSpanProcessor } from "@langfuse/otel";
import { setLangfuseTracerProvider } from "@langfuse/tracing";
import { NodeSDK } from "@opentelemetry/sdk-node";

import type { SkillReference, SpanExporterLike, TracerProviderLike } from "./types.ts";

export const DEFAULT_TIMEOUT_MS = 4500;
export const LINK_ANCHOR_SPAN_NAME = "__langfuse_link_anchor__";

type NodeSdkIdGenerator = NonNullable<ConstructorParameters<typeof NodeSDK>[0]>["idGenerator"];

let pendingDeterministicSpanId: string | undefined;

function deriveDeterministicSpanId(seed: string): string {
  const hex = crypto.createHash("sha256").update(seed).digest("hex").slice(0, 16);

  return hex === "0000000000000000" ? "0000000000000001" : hex;
}

export function withDeterministicSpanId<T>(seed: string, fn: () => T): T {
  const prevSpanId = pendingDeterministicSpanId;

  pendingDeterministicSpanId = deriveDeterministicSpanId(seed);

  try {
    return fn();
  } finally {
    pendingDeterministicSpanId = prevSpanId;
  }
}

const deterministicIdGenerator: NonNullable<NodeSdkIdGenerator> = {
  generateTraceId(): string {
    return crypto.randomBytes(16).toString("hex");
  },
  generateSpanId(): string {
    if (pendingDeterministicSpanId) {
      const spanId = pendingDeterministicSpanId;

      pendingDeterministicSpanId = undefined;

      return spanId;
    }

    return crypto.randomBytes(8).toString("hex");
  },
};

export function createNoopSpanExporter(): SpanExporterLike {
  return {
    export(_spans, resultCallback) {
      resultCallback({ code: 0 });
    },
    shutdown: async () => {},
  };
}

export interface TracingSession {
  sdk: NodeSDK;
  processor: LangfuseSpanProcessor;
}

export function startTracingSession(options: {
  release: string;
  dryRun: boolean;
  spanExporter?: SpanExporterLike;
  availableSkills?: SkillReference[];
}): TracingSession {
  const exporter = options.spanExporter ?? (options.dryRun ? createNoopSpanExporter() : undefined);
  const processor = new LangfuseSpanProcessor({
    exporter,
    exportMode: exporter ? "immediate" : "batched",
    publicKey: process.env.LANGFUSE_PUBLIC_KEY ?? "pk-lf-dry-run",
    secretKey: process.env.LANGFUSE_SECRET_KEY ?? "sk-lf-dry-run",
    baseUrl: process.env.LANGFUSE_BASE_URL ?? process.env.LANGFUSE_HOST,
    release: options.release,
    environment: process.env.LANGFUSE_TRACING_ENVIRONMENT ?? "development",
    ...(options.availableSkills && options.availableSkills.length > 0
      ? { skills: { available: options.availableSkills } }
      : {}),
    shouldExportSpan: ({ otelSpan }) =>
      isDefaultExportSpan(otelSpan) && otelSpan.name !== LINK_ANCHOR_SPAN_NAME,
    mediaUploadEnabled: false,
    timeout: 4,
  });

  const sdk = new NodeSDK({
    spanProcessors: [processor],
    logRecordProcessors: [],
    autoDetectResources: false,
    idGenerator: deterministicIdGenerator,
  });

  sdk.start();

  const internalProvider = (sdk as unknown as { _tracerProvider?: TracerProviderLike })
    ._tracerProvider;

  if (internalProvider) {
    setLangfuseTracerProvider(internalProvider);
  }

  return { sdk, processor };
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

export async function flushAndShutdown(
  session: TracingSession,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<void> {
  await withTimeout(
    (async () => {
      await session.processor.forceFlush();
      await session.sdk.shutdown();
    })(),
    timeoutMs,
    "Langfuse span export flush",
  );
}

export function resetTracingProvider(): void {
  pendingDeterministicSpanId = undefined;
  setLangfuseTracerProvider(null);
}
