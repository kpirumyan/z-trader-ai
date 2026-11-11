import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { ContextAnchor } from "./types.ts";

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
