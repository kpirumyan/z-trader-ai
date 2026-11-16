import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Atomically writes a JSON payload using a same-directory temp file and rename.
 */
export function atomicWriteJsonFile(targetPath: string, payload: unknown): void {
  const dir = path.dirname(targetPath);

  fs.mkdirSync(dir, { recursive: true });

  const suffix = `${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString("hex")}`;
  const tempPath = `${targetPath}.${suffix}.tmp`;

  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    fs.renameSync(tempPath, targetPath);
  } catch (err) {
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch {
      // Ignore temp cleanup failure
    }

    throw err;
  }
}
