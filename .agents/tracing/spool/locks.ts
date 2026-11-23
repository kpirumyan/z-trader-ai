import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const LOCKS_DIR_NAME = "locks";

const DEFAULT_SPOOL_LOCK_STALE_MS = 30_000;

export interface SpoolLockHandle {
  lockPath: string;
  token: string;
}

function getLockPath(spoolDir: string, key: string): string {
  const sanitized =
    key
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, "_") || "unknown";

  return path.join(spoolDir, LOCKS_DIR_NAME, `${sanitized}.lock`);
}

function isLockStale(lockPath: string, staleMs: number): boolean {
  try {
    const raw = fs.readFileSync(lockPath, "utf8");
    const parsed = JSON.parse(raw) as { createdAt?: unknown };

    if (typeof parsed.createdAt === "number" && Number.isFinite(parsed.createdAt)) {
      return Date.now() - parsed.createdAt > staleMs;
    }
  } catch {
    // Fall back to filesystem mtime if lock file is unreadable or half-written
  }

  try {
    const stat = fs.statSync(lockPath);

    return Date.now() - stat.mtimeMs > staleMs;
  } catch {
    return true;
  }
}

function tryOpenExclusiveLock(lockPath: string, token: string): boolean {
  const fd = fs.openSync(lockPath, "wx");

  try {
    fs.writeFileSync(
      fd,
      JSON.stringify({ pid: process.pid, token, createdAt: Date.now() }),
      "utf8",
    );
  } finally {
    fs.closeSync(fd);
  }

  return true;
}

export function acquireSpoolLock(
  spoolDir: string,
  key: string,
  staleMs = DEFAULT_SPOOL_LOCK_STALE_MS,
): SpoolLockHandle | null {
  const lockPath = getLockPath(spoolDir, key);
  const token = `${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString("hex")}`;

  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      tryOpenExclusiveLock(lockPath, token);

      return { lockPath, token };
    } catch (err: unknown) {
      const code =
        err && typeof err === "object" && "code" in err
          ? (err as { code?: string }).code
          : undefined;

      if (code !== "EEXIST") {
        throw err;
      }

      if (attempt === 0 && isLockStale(lockPath, staleMs)) {
        try {
          fs.unlinkSync(lockPath);
          continue;
        } catch {
          // Another process raced us to remove or re-acquire the stale lock
        }
      }

      return null;
    }
  }

  return null;
}

export function releaseSpoolLock(handle: SpoolLockHandle | null | undefined): void {
  if (!handle) {
    return;
  }

  try {
    if (!fs.existsSync(handle.lockPath)) {
      return;
    }

    const raw = fs.readFileSync(handle.lockPath, "utf8");
    const parsed = JSON.parse(raw) as { token?: unknown };

    if (parsed.token === handle.token) {
      fs.unlinkSync(handle.lockPath);
    }
  } catch {
    // Ignore cleanup errors or already-removed lock files
  }
}

export async function acquireSpoolLockWithRetry(
  spoolDir: string,
  key: string,
  maxWaitMs: number,
  staleMs = DEFAULT_SPOOL_LOCK_STALE_MS,
): Promise<SpoolLockHandle | null> {
  const deadline = Date.now() + Math.max(0, maxWaitMs);

  while (true) {
    const acquired = acquireSpoolLock(spoolDir, key, staleMs);

    if (acquired) {
      return acquired;
    }

    const remaining = deadline - Date.now();

    if (remaining <= 0) {
      return null;
    }

    await new Promise((resolve) => setTimeout(resolve, Math.min(40, remaining)));
  }
}
