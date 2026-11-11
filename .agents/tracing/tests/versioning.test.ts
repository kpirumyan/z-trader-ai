// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { computeContextAnchor } from "../index.ts";

describe("versioning: computeContextAnchor", () => {
  it("computes deterministic context anchor (gitShortSha-agentsHash) excluding test files", () => {
    const tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "z-trader-anchor-test-"));

    try {
      fs.writeFileSync(path.join(tempWorkspace, "AGENTS.md"), "# Agent Rules\n", "utf8");

      fs.mkdirSync(path.join(tempWorkspace, ".agents", "skills", "langfuse"), {
        recursive: true,
      });

      fs.mkdirSync(path.join(tempWorkspace, ".agents", "tracing", "tests"), {
        recursive: true,
      });

      fs.writeFileSync(
        path.join(tempWorkspace, ".agents", "skills", "langfuse", "SKILL.md"),
        "name: langfuse\n",
        "utf8",
      );

      fs.writeFileSync(
        path.join(tempWorkspace, ".agents", "tracing", "tests", "some.test.ts"),
        "// test v1\n",
        "utf8",
      );

      const anchor1 = computeContextAnchor(tempWorkspace);

      expect(anchor1.agentsHash).toMatch(/^[0-9a-f]{8}$/);
      expect(anchor1.version).toBe(`${anchor1.gitShortSha}-${anchor1.agentsHash}`);

      // Modifying a test file inside .agents/**/tests/ should NOT change agentsHash
      fs.writeFileSync(
        path.join(tempWorkspace, ".agents", "tracing", "tests", "some.test.ts"),
        "// test v2 changed\n",
        "utf8",
      );

      const anchor2 = computeContextAnchor(tempWorkspace);

      expect(anchor2.agentsHash).toBe(anchor1.agentsHash);

      // Modifying a skill file inside .agents/skills/ MUST change agentsHash
      fs.writeFileSync(
        path.join(tempWorkspace, ".agents", "skills", "langfuse", "SKILL.md"),
        "name: langfuse-updated\n",
        "utf8",
      );

      const anchor3 = computeContextAnchor(tempWorkspace);

      expect(anchor3.agentsHash).not.toBe(anchor1.agentsHash);
    } finally {
      fs.rmSync(tempWorkspace, { recursive: true, force: true });
    }
  });
});
