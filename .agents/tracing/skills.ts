import os from "node:os";
import path from "node:path";

import { discoverSkills } from "@langfuse/otel/node";

import type { SkillReference } from "./types.ts";

/**
 * Resolves skill directories in precedence order:
 * 1. Project-local `.agents/skills`
 * 2. User-global `~/.gemini/config/skills`
 * 3. Built-in `~/.gemini/antigravity/builtin/skills`
 * 4. User-global `~/.agents/skills`
 */
export function resolveDefaultSkillDirs(workspaceRoot: string, homeDir = os.homedir()): string[] {
  const candidates = [
    path.join(workspaceRoot, ".agents", "skills"),
    path.join(homeDir, ".gemini", "config", "skills"),
    path.join(homeDir, ".gemini", "antigravity", "builtin", "skills"),
    path.join(homeDir, ".agents", "skills"),
  ];

  const seen = new Set<string>();
  const unique: string[] = [];

  for (const dir of candidates) {
    const resolved = path.resolve(dir);

    if (!seen.has(resolved)) {
      seen.add(resolved);
      unique.push(resolved);
    }
  }

  return unique;
}

/**
 * Discovers installed skills across multiple directories (fail-open).
 * Earlier directories take precedence when duplicate skill names exist.
 */
export async function discoverAvailableSkills(dirs: string[]): Promise<SkillReference[]> {
  const byName = new Map<string, SkillReference>();

  for (const dir of dirs) {
    try {
      const discovered = await discoverSkills({ dir });

      for (const skill of discovered) {
        if (!byName.has(skill.name)) {
          byName.set(skill.name, skill);
        }
      }
    } catch {
      // Fail-open: skip unreadable skill directories
    }
  }

  return Array.from(byName.values());
}
