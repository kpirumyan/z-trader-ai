import { LangfuseSpanProcessor } from "@langfuse/otel";
import { setLangfuseTracerProvider } from "@langfuse/tracing";
import { NodeSDK } from "@opentelemetry/sdk-node";

import type { SpanExporterLike, TracerProviderLike } from "./types.ts";

export const DEFAULT_TIMEOUT_MS = 4500;

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
    mediaUploadEnabled: false,
    timeout: 4,
  });

  const sdk = new NodeSDK({
    spanProcessors: [processor],
    logRecordProcessors: [],
    autoDetectResources: false,
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
  setLangfuseTracerProvider(null);
}
