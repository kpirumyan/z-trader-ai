import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

interface SkillsLock {
  skills?: Record<string, unknown>;
}

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, "../..");

function readSkillsFromLock(lockPath: string): string[] {
  const parsed: unknown = JSON.parse(fs.readFileSync(lockPath, "utf8"));

  if (typeof parsed !== "object" || parsed === null) {
    return [];
  }

  const skills = (parsed as SkillsLock).skills;

  if (typeof skills !== "object" || skills === null) {
    return [];
  }

  return Object.keys(skills);
}

function readIgnoredEntries(ignorePath: string): Set<string> {
  const lines = fs.readFileSync(ignorePath, "utf8").split(/\r?\n/);

  return new Set(
    lines
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"))
      .map((line) => line.replace(/\/+$/, "")),
  );
}

function readMarkdownlintIgnores(configPath: string): Set<string> {
  const lines = fs.readFileSync(configPath, "utf8").split(/\r?\n/);
  const ignores = new Set<string>();
  let inIgnores = false;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();

    if (!inIgnores) {
      if (/^ignores\s*:/.test(rawLine)) {
        inIgnores = true;
      }

      continue;
    }

    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }

    if (!/^\s/.test(rawLine)) {
      break;
    }

    const match = trimmed.match(/^-\s+(.+)$/);

    if (!match) {
      continue;
    }

    const entry = match[1]
      .replace(/\s+#.*$/, "")
      .trim()
      .replace(/^["']|["']$/g, "")
      .replace(/\/+$/, "");

    if (entry.length > 0) {
      ignores.add(entry);
    }
  }

  return ignores;
}

function findMissingSkillIgnores(lockSkills: string[], ignored: Set<string>): string[] {
  return lockSkills.map((name) => `.agents/skills/${name}`).filter((entry) => !ignored.has(entry));
}

describe("third-party skill ignore sync", () => {
  it("ignores every third-party skill declared in skills-lock.json in .prettierignore", () => {
    const lockPath = path.join(WORKSPACE_ROOT, "skills-lock.json");
    const ignorePath = path.join(WORKSPACE_ROOT, ".prettierignore");
    const lockSkills = readSkillsFromLock(lockPath);
    const ignored = readIgnoredEntries(ignorePath);

    expect(findMissingSkillIgnores(lockSkills, ignored)).toEqual([]);
  });

  it("ignores every third-party skill declared in skills-lock.json in .markdownlint-cli2.yaml", () => {
    const lockPath = path.join(WORKSPACE_ROOT, "skills-lock.json");
    const configPath = path.join(WORKSPACE_ROOT, ".markdownlint-cli2.yaml");
    const lockSkills = readSkillsFromLock(lockPath);
    const ignored = readMarkdownlintIgnores(configPath);

    expect(findMissingSkillIgnores(lockSkills, ignored)).toEqual([]);
  });
});
