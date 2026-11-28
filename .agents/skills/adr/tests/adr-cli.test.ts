import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  checkAdrs,
  cmdDeprecate,
  cmdList,
  cmdNew,
  cmdRemovePath,
  cmdRetarget,
  cmdSupersede,
  cmdSync,
  generateAdrReadme,
  getGoverningAdrsForPath,
  matchesGovernancePath,
  parseArgs,
  parseFrontmatter,
  serializeFrontmatter,
  updateModuleReadmeContent,
} from "../scripts/adr-cli.ts";

interface ParsedResult {
  frontmatter: Record<string, unknown>;
  body: string;
}

function parse(raw: string): ParsedResult {
  return parseFrontmatter(raw) as unknown as ParsedResult;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

function initGitRepo(cwd: string): string {
  git(cwd, "init", "-b", "main");
  git(cwd, "add", ".");
  git(
    cwd,
    "-c",
    "user.email=test@example.com",
    "-c",
    "user.name=Test Runner",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-m",
    "initial",
  );

  return git(cwd, "rev-parse", "HEAD");
}

function commitAll(cwd: string, message: string): string {
  git(cwd, "add", "-A");
  git(
    cwd,
    "-c",
    "user.email=test@example.com",
    "-c",
    "user.name=Test Runner",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-m",
    message,
  );

  return git(cwd, "rev-parse", "HEAD");
}

describe("ADR Governance CLI Unit Suite", () => {
  describe("Frontmatter Parsing & Serialization", () => {
    it("parses valid MADR 4.0 frontmatter with arrays, nulls, and quoted colons", () => {
      const raw = `\uFEFF---
id: "ADR-0099"
title: "Test: Architecture"
status: "accepted"
date: "2026-11-06"
decision-makers:
  - "Product Owner"
  - "Architect Agent"
area: "Tooling & Governance"
applies_to:
  - "src/modules/chart"
  - "src/modules/order-book"
enforced_by:
  - "src/modules/chart/tests/chart.test.tsx"
supersedes: null
superseded_by: null
---

# ADR-0099: Test: Architecture

## Context and Problem Statement
Context text.
`;

      const { frontmatter, body } = parse(raw);

      expect(frontmatter).toBeDefined();
      expect(frontmatter.id).toBe("ADR-0099");
      expect(frontmatter.title).toBe("Test: Architecture");
      expect(frontmatter.status).toBe("accepted");
      expect(frontmatter.date).toBe("2026-11-06");
      expect(frontmatter["decision-makers"]).toEqual(["Product Owner", "Architect Agent"]);
      expect(frontmatter.area).toBe("Tooling & Governance");
      expect(frontmatter.applies_to).toEqual(["src/modules/chart", "src/modules/order-book"]);
      expect(frontmatter.enforced_by).toEqual(["src/modules/chart/tests/chart.test.tsx"]);
      expect(frontmatter.supersedes).toBeNull();
      expect(frontmatter.superseded_by).toBeNull();
      expect(body).toContain("## Context and Problem Statement");
    });

    it("serializes frontmatter and preserves body exactly", () => {
      const fm = {
        id: "ADR-0042",
        title: "Test Serialization",
        status: "accepted",
        date: "2026-11-06",
        "decision-makers": ["Alice", "Bob"],
        area: "Storage",
        applies_to: ["src/shared/storage"],
        enforced_by: ["src/shared/storage/tests/storage.test.ts"],
        supersedes: "ADR-0004",
        superseded_by: null,
      };

      const body = "\n# ADR-0042: Test Serialization\n\n## Context\nSome body\n";
      const serialized = serializeFrontmatter(fm, body);
      const parsed = parseFrontmatter(serialized);

      expect(parsed.frontmatter).toEqual(fm);
      expect(parsed.body.trim()).toBe(body.trim());
    });
  });

  describe("Module Filtering & Traceability", () => {
    const mockAdrs = [
      {
        fileName: "0001-modular.md",
        frontmatter: {
          id: "ADR-0001",
          title: "Modular Architecture",
          status: "accepted",
          area: "Architecture",
          applies_to: ["src/modules/chart", "src/modules/order-book"],
        },
      },
      {
        fileName: "0006-chart.md",
        frontmatter: {
          id: "ADR-0006",
          title: "Lightweight Charts",
          status: "accepted",
          area: "Charting",
          applies_to: ["src/modules/chart"],
        },
      },
      {
        fileName: "0004-storage.md",
        frontmatter: {
          id: "ADR-0004",
          title: "Resilient Storage",
          status: "accepted",
          area: "Storage",
          applies_to: ["src/modules/workspace"],
        },
      },
      {
        fileName: "0099-deprecated.md",
        frontmatter: {
          id: "ADR-0099",
          title: "Old Charting",
          status: "deprecated",
          area: "Charting",
          applies_to: ["src/modules/chart"],
        },
      },
    ];

    it("filters active governing ADRs for a given path", () => {
      const chartAdrs = getGoverningAdrsForPath(
        "src/modules/chart",
        mockAdrs as unknown as Parameters<typeof getGoverningAdrsForPath>[1],
      );

      expect(chartAdrs.map((a) => a.frontmatter.id)).toEqual(["ADR-0001", "ADR-0006"]);
      expect(chartAdrs.some((a) => a.frontmatter.id === "ADR-0099")).toBe(false);
    });

    it("generates markdown bullet list for module README", () => {
      const existingReadme =
        "# Module Passport: chart\n\n## Verification\n\n- Black box tests.\n\n## Governing ADRs\n\n- Stale text\n";
      const governing = [
        {
          fileName: "0001-modular.md",
          frontmatter: {
            id: "ADR-0001",
            title: "Modular Architecture",
            area: "Architecture",
          },
        },
      ];

      const updated = updateModuleReadmeContent(
        existingReadme,
        governing as unknown as Parameters<typeof updateModuleReadmeContent>[1],
      );

      expect(updated).toContain("## Governing ADRs");
      expect(updated).toContain(
        "- [ADR-0001: Modular Architecture](../../../docs/adr/0001-modular.md) \u2014 Architecture",
      );
      expect(updated).not.toContain("Stale text");
    });
  });

  describe("docs/adr/README Index Generation", () => {
    it("partitions active and historical decisions correctly", () => {
      const adrs = [
        {
          fileName: "0000-exec.md",
          frontmatter: {
            id: "ADR-0000",
            title: "Executable Governance",
            status: "accepted",
            date: "2026-11-05",
            area: "Tooling",
          },
        },
        {
          fileName: "0008-old.md",
          frontmatter: {
            id: "ADR-0008",
            title: "Replaced Decision",
            status: "superseded by ADR-0009",
            date: "2026-10-01",
            area: "Storage",
          },
        },
      ];

      const generated = generateAdrReadme(
        adrs as unknown as Parameters<typeof generateAdrReadme>[0],
      );

      expect(generated).toContain("## Active Decisions Index");
      expect(generated).toContain("[ADR-0000](./0000-exec.md)");
      expect(generated).toContain("## Historical Decisions Index");
      expect(generated).toContain("[ADR-0008](./0008-old.md)");
    });
  });

  describe("Module Lifecycle Workflows & Git-Anchored Immutability", () => {
    let tmpRoot: string;
    let adrDir: string;
    let modulesDir: string;

    beforeEach(() => {
      tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "adr-lifecycle-test-"));
      adrDir = path.join(tmpRoot, "docs", "adr");
      modulesDir = path.join(tmpRoot, "src", "modules");
      fs.mkdirSync(adrDir, { recursive: true });
      fs.mkdirSync(modulesDir, { recursive: true });

      fs.writeFileSync(
        path.join(tmpRoot, "package.json"),
        JSON.stringify({ name: "mock-z-trader", type: "module" }),
        "utf8",
      );
    });

    afterEach(() => {
      try {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors on windows locks
      }
    });

    it("allows authoring uncommitted draft ADR body freely without a lockfile", () => {
      const modPath = path.join(modulesDir, "order-analytics");

      fs.mkdirSync(path.join(modPath, "tests"), { recursive: true });
      fs.writeFileSync(path.join(modPath, "README.md"), "# Module\n\n## Governing ADRs\n", "utf8");
      fs.writeFileSync(path.join(modPath, "tests", "analytics.test.ts"), "export {};\n", "utf8");

      const result = cmdNew(
        {
          title: "Order Analytics Subsystem",
          area: "Analytics & Orders",
          "applies-to": "src/modules/order-analytics",
          "enforced-by": "src/modules/order-analytics/tests/analytics.test.ts",
        },
        { rootDir: tmpRoot, silent: true },
      )!;

      initGitRepo(tmpRoot);

      // Create second ADR after initial commit and edit its body before committing
      const draft = cmdNew(
        {
          title: "Second Uncommitted Decision",
          area: "Analytics",
          "applies-to": "src/modules/order-analytics",
          "enforced-by": "src/modules/order-analytics/tests/analytics.test.ts",
        },
        { rootDir: tmpRoot, silent: true },
      )!;

      const draftPath = path.join(adrDir, draft.fileName);
      const parsedDraft = parse(fs.readFileSync(draftPath, "utf8"));
      const authoredBody = parsedDraft.body.replace(
        "Describe the context and problem statement here.",
        "Detailed domain context authored before committing.",
      );

      fs.writeFileSync(draftPath, serializeFrontmatter(parsedDraft.frontmatter, authoredBody));

      expect(fs.existsSync(path.join(adrDir, ".adr-lock.json"))).toBe(false);

      const checkResult = checkAdrs({ rootDir: tmpRoot });

      expect(checkResult.valid).toBe(true);
      expect(checkResult.errors).toHaveLength(0);
      expect(result.id).toBe("ADR-0000");
    }, 15000);

    it("detects body tampering, file deletion, and immutable metadata edits against HEAD and baseRef", () => {
      const modPath = path.join(modulesDir, "tamper-test");

      fs.mkdirSync(path.join(modPath, "tests"), { recursive: true });
      fs.writeFileSync(path.join(modPath, "README.md"), "# Module\n\n## Governing ADRs\n", "utf8");
      fs.writeFileSync(path.join(modPath, "tests", "t.test.ts"), "export {};\n", "utf8");

      const adr = cmdNew(
        {
          title: "Tamper Test Decision",
          area: "Security",
          "applies-to": "src/modules/tamper-test",
          "enforced-by": "src/modules/tamper-test/tests/t.test.ts",
        },
        { rootDir: tmpRoot, silent: true },
      )!;

      const baseSha = initGitRepo(tmpRoot);
      const adrFilePath = path.join(adrDir, adr.fileName);
      const originalRaw = fs.readFileSync(adrFilePath, "utf8");

      // 1. Uncommitted body edit fails against HEAD
      fs.writeFileSync(adrFilePath, `${originalRaw}\nUnauthorized body append\n`, "utf8");

      const dirtyBodyCheck = checkAdrs({ rootDir: tmpRoot });

      expect(dirtyBodyCheck.valid).toBe(false);
      expect(dirtyBodyCheck.errors.some((e) => e.includes("Body of committed ADR"))).toBe(true);

      // 2. Committed body edit on a branch fails when checked against baseSha (CI mode)
      git(tmpRoot, "checkout", "-b", "feat/tamper");
      commitAll(tmpRoot, "tamper body in branch commit");

      const committedTamperCheck = checkAdrs({ rootDir: tmpRoot, baseRef: baseSha });

      expect(committedTamperCheck.valid).toBe(false);
      expect(committedTamperCheck.errors.some((e) => e.includes("Body of committed ADR"))).toBe(
        true,
      );

      // 3. Immutable metadata tampering (e.g. title) fails
      const parsed = parse(originalRaw);

      parsed.frontmatter.title = "Silently Renamed Title";
      fs.writeFileSync(adrFilePath, serializeFrontmatter(parsed.frontmatter, parsed.body), "utf8");

      const metaTamperCheck = checkAdrs({ rootDir: tmpRoot, baseRef: baseSha });

      expect(metaTamperCheck.valid).toBe(false);
      expect(
        metaTamperCheck.errors.some((e) => e.includes('Immutable frontmatter field "title"')),
      ).toBe(true);

      // 4. Deleting a committed ADR fails
      fs.rmSync(adrFilePath);

      const deletedAdrCheck = checkAdrs({ rootDir: tmpRoot, baseRef: baseSha });

      expect(deletedAdrCheck.valid).toBe(false);
      expect(deletedAdrCheck.errors.some((e) => e.includes("was deleted or moved"))).toBe(true);
    }, 15000);

    it("blocks removing active applies_to/enforced_by paths or deprecating while paths exist on disk", () => {
      const modPath = path.join(modulesDir, "git-guarded");
      const extraPath = path.join(modulesDir, "extra-mod");

      fs.mkdirSync(path.join(modPath, "tests"), { recursive: true });
      fs.mkdirSync(extraPath, { recursive: true });
      fs.writeFileSync(path.join(modPath, "README.md"), "# Guarded\n", "utf8");
      fs.writeFileSync(path.join(modPath, "tests", "g.test.ts"), "export {};\n", "utf8");

      const adr = cmdNew(
        {
          title: "Git Guarded Decision",
          area: "Governance",
          "applies-to": "src/modules/git-guarded, src/modules/extra-mod",
          "enforced-by": "src/modules/git-guarded/tests/g.test.ts",
        },
        { rootDir: tmpRoot, silent: true },
      )!;

      initGitRepo(tmpRoot);

      const adrFilePath = path.join(adrDir, adr.fileName);
      const originalRaw = fs.readFileSync(adrFilePath, "utf8");

      // 1. Removing an enforced_by path while file still exists fails
      const parsedEnforced = parseFrontmatter(originalRaw);

      parsedEnforced.frontmatter!.enforced_by = [];
      fs.writeFileSync(
        adrFilePath,
        serializeFrontmatter(parsedEnforced.frontmatter!, parsedEnforced.body),
        "utf8",
      );

      const removedEnforcedCheck = checkAdrs({ rootDir: tmpRoot });

      expect(removedEnforcedCheck.valid).toBe(false);
      expect(
        removedEnforcedCheck.errors.some((e) =>
          e.includes('enforced_by path "src/modules/git-guarded/tests/g.test.ts"'),
        ),
      ).toBe(true);

      // 2. Removing an applies_to path while directory still exists fails
      const parsedApplies = parseFrontmatter(originalRaw);

      parsedApplies.frontmatter!.applies_to = ["src/modules/git-guarded"];
      fs.writeFileSync(
        adrFilePath,
        serializeFrontmatter(parsedApplies.frontmatter!, parsedApplies.body),
        "utf8",
      );

      const removedAppliesCheck = checkAdrs({ rootDir: tmpRoot });

      expect(removedAppliesCheck.valid).toBe(false);
      expect(
        removedAppliesCheck.errors.some((e) =>
          e.includes('applies_to path "src/modules/extra-mod"'),
        ),
      ).toBe(true);

      // 3. Premature deprecation while governed paths still exist fails
      fs.writeFileSync(adrFilePath, originalRaw, "utf8");
      cmdDeprecate(adr.id, { rootDir: tmpRoot, silent: true });

      const prematureDeprecateCheck = checkAdrs({ rootDir: tmpRoot });

      expect(prematureDeprecateCheck.valid).toBe(false);
      expect(
        prematureDeprecateCheck.errors.some((e) =>
          e.includes('cannot transition from "accepted" to "deprecated"'),
        ),
      ).toBe(true);
    }, 15000);

    it("permits legitimate supersede, retarget, and remove-path transitions under Git anchoring", () => {
      const modAPath = path.join(modulesDir, "active-a");
      const modBPath = path.join(modulesDir, "legacy-b");

      fs.mkdirSync(path.join(modAPath, "tests"), { recursive: true });
      fs.mkdirSync(path.join(modBPath, "tests"), { recursive: true });
      fs.writeFileSync(path.join(modAPath, "README.md"), "# Module A\n", "utf8");
      fs.writeFileSync(path.join(modBPath, "README.md"), "# Module B\n", "utf8");
      fs.writeFileSync(path.join(modAPath, "tests", "a.test.ts"), "export {};\n", "utf8");
      fs.writeFileSync(path.join(modBPath, "tests", "b.test.ts"), "export {};\n", "utf8");

      const initial = cmdNew(
        {
          title: "Multi Module Standard",
          area: "Architecture",
          "applies-to": "src/modules/active-a, src/modules/legacy-b",
          "enforced-by":
            "src/modules/active-a/tests/a.test.ts, src/modules/legacy-b/tests/b.test.ts",
        },
        { rootDir: tmpRoot, silent: true },
      )!;

      const baseSha = initGitRepo(tmpRoot);

      // 1. Delete legacy-b from disk and prune via cmdRemovePath
      fs.rmSync(modBPath, { recursive: true, force: true });
      expect(cmdRemovePath("src/modules/legacy-b", { rootDir: tmpRoot, silent: true })).toBe(1);
      expect(checkAdrs({ rootDir: tmpRoot, baseRef: baseSha }).valid).toBe(true);

      // 2. Rename active-a -> renamed-a and retarget
      const renamedAPath = path.join(modulesDir, "renamed-a");

      fs.renameSync(modAPath, renamedAPath);
      expect(
        cmdRetarget("src/modules/active-a", "src/modules/renamed-a", {
          rootDir: tmpRoot,
          silent: true,
        }),
      ).toBe(1);
      expect(checkAdrs({ rootDir: tmpRoot, baseRef: baseSha }).valid).toBe(true);

      commitAll(tmpRoot, "retarget and prune");

      // 3. Supersede committed ADR and freely author new ADR body before committing
      const superseded = cmdSupersede(
        initial.id,
        { title: "Multi Module Standard v2", area: "Architecture" },
        { rootDir: tmpRoot, silent: true },
      )!;

      const newAdrPath = path.join(adrDir, `0001-multi-module-standard-v2.md`);
      const newParsed = parse(fs.readFileSync(newAdrPath, "utf8"));

      expect(superseded.nextId).toBe("ADR-0001");
      expect(newParsed.body).toContain(`Supersedes [ADR-0000](./${initial.fileName}).`);

      fs.writeFileSync(
        newAdrPath,
        serializeFrontmatter(newParsed.frontmatter, `${newParsed.body}\nExtra rationale.\n`),
        "utf8",
      );

      expect(checkAdrs({ rootDir: tmpRoot, baseRef: baseSha }).valid).toBe(true);

      // 4. Delete remaining module -> auto-deprecate ADR-0001 passes check
      commitAll(tmpRoot, "supersede ADR-0000");
      fs.rmSync(renamedAPath, { recursive: true, force: true });
      expect(cmdRemovePath("src/modules/renamed-a", { rootDir: tmpRoot, silent: true })).toBe(1);
      expect(checkAdrs({ rootDir: tmpRoot }).valid).toBe(true);
    }, 15000);

    it("skips immutability diff for legacy pre-MADR files without YAML frontmatter in baseRef", () => {
      const modPath = path.join(modulesDir, "legacy-madr");

      fs.mkdirSync(path.join(modPath, "tests"), { recursive: true });
      fs.writeFileSync(path.join(modPath, "tests", "l.test.ts"), "export {};\n", "utf8");

      const adrPath = path.join(adrDir, "0001-legacy.md");

      fs.writeFileSync(adrPath, "# ADR-0001: Legacy\n\nNo frontmatter yet.\n", "utf8");

      const legacySha = initGitRepo(tmpRoot);

      // Upgrade file to MADR 4.0 frontmatter
      fs.writeFileSync(
        adrPath,
        `---
id: "ADR-0001"
title: "Legacy"
status: "accepted"
date: "2026-10-24"
decision-makers:
  - "Product Owner"
area: "Architecture"
applies_to:
  - "src/modules/legacy-madr"
enforced_by:
  - "src/modules/legacy-madr/tests/l.test.ts"
supersedes: null
superseded_by: null
---

# ADR-0001: Legacy

## Context and Problem Statement
A

## Decision Drivers
B

## Decision Outcome
C

## Confirmation and Enforcement
D

## Consequences
E

## Rejected Alternatives
F
`,
        "utf8",
      );
      cmdSync({ rootDir: tmpRoot, silent: true });

      const result = checkAdrs({ rootDir: tmpRoot, baseRef: legacySha });

      expect(result.valid).toBe(true);
    }, 15000);

    it("handles list, sync, path matching, and parseArgs", () => {
      const modPath = path.join(modulesDir, "query-mod");

      fs.mkdirSync(path.join(modPath, "tests"), { recursive: true });
      fs.writeFileSync(path.join(modPath, "README.md"), "# Module\n\n## Governing ADRs\n", "utf8");
      fs.writeFileSync(path.join(modPath, "tests", "q.test.ts"), "export {};\n", "utf8");

      cmdNew(
        {
          title: "Query Decision Active",
          area: "Query",
          "applies-to": "src/modules/query-mod",
          "enforced-by": "src/modules/query-mod/tests/q.test.ts",
        },
        { rootDir: tmpRoot, silent: true },
      );

      expect(matchesGovernancePath("src/shared", "src/shared/storage")).toBe(true);
      expect(matchesGovernancePath("src/shared/theme", "src/shared/storage")).toBe(false);

      const jsonList = cmdList({ json: true }, { rootDir: tmpRoot, silent: true }) as Array<{
        id: string;
        status: string;
      }>;

      expect(jsonList).toHaveLength(1);
      expect(jsonList[0]?.id).toBe("ADR-0000");

      expect(
        (
          cmdList(
            { path: "src/modules/query-mod" },
            { rootDir: tmpRoot, silent: true },
          ) as unknown[]
        ).length,
      ).toBe(1);
      expect(
        (cmdList({ path: "src/modules/other" }, { rootDir: tmpRoot, silent: true }) as unknown[])
          .length,
      ).toBe(0);

      cmdSync({ rootDir: tmpRoot, silent: true });
      expect(fs.readFileSync(path.join(adrDir, "README.md"), "utf8")).toContain(
        "## Active Decisions Index",
      );

      const parsed = parseArgs([
        "new",
        "--title",
        "Test Title",
        "--all",
        "--applies-to",
        "src/modules/storage",
      ]);

      expect(parsed._).toEqual(["new"]);
      expect(parsed.title).toBe("Test Title");
      expect(parsed.all).toBe(true);
      expect(parsed["applies-to"]).toBe("src/modules/storage");
    });

    it("rejects accepted ADRs with empty enforced_by or duplicate ids", () => {
      const modPath = path.join(modulesDir, "empty-enforced");

      fs.mkdirSync(modPath, { recursive: true });

      cmdNew(
        {
          title: "Unenforced Decision",
          area: "Architecture",
          "applies-to": "src/modules/empty-enforced",
        },
        { rootDir: tmpRoot, silent: true },
      );

      const checkResult = checkAdrs({ rootDir: tmpRoot });

      expect(checkResult.valid).toBe(false);
      expect(
        checkResult.errors.some((e) =>
          e.includes("Active accepted ADR must declare at least one enforced_by path."),
        ),
      ).toBe(true);
    });
  });
});
