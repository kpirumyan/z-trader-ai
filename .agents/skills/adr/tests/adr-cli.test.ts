import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  parseFrontmatter,
  serializeFrontmatter,
  computeBodyHash,
  generateAdrReadme,
  getGoverningAdrsForModule,
  updateModuleReadmeContent,
  cmdNew,
  cmdRetarget,
  cmdRemovePath,
  cmdDeprecate,
  cmdSupersede,
  cmdList,
  cmdSync,
  checkAdrs,
  readLockFile,
  parseArgs,
} from "../scripts/adr-cli.mjs";

interface ParsedResult {
  frontmatter: Record<string, unknown>;
  body: string;
}

function parse(raw: string): ParsedResult {
  return parseFrontmatter(raw) as unknown as ParsedResult;
}

describe("ADR Governance CLI Unit Suite", () => {
  describe("Frontmatter Parsing & Serialization", () => {
    it("parses valid MADR 4.0 frontmatter with arrays and nulls", () => {
      const raw = `---
id: "ADR-0099"
title: "Test Architecture"
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

# ADR-0099: Test Architecture

## Context and Problem Statement
Context text.
`;

      const { frontmatter, body } = parse(raw);

      expect(frontmatter).toBeDefined();
      expect(frontmatter.id).toBe("ADR-0099");
      expect(frontmatter.title).toBe("Test Architecture");
      expect(frontmatter.status).toBe("accepted");
      expect(frontmatter.date).toBe("2026-11-06");

      expect(frontmatter["decision-makers"]).toEqual([
        "Product Owner",
        "Architect Agent",
      ]);

      expect(frontmatter.area).toBe("Tooling & Governance");

      expect(frontmatter.applies_to).toEqual([
        "src/modules/chart",
        "src/modules/order-book",
      ]);

      expect(frontmatter.enforced_by).toEqual([
        "src/modules/chart/tests/chart.test.tsx",
      ]);

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

  describe("Cryptographic Body Hash", () => {
    it("computes deterministic SHA-256 hash on normalized trimmed body", () => {
      const bodyLF = "\n# Title\n\n## Context and Problem Statement\nText\n";
      const bodyCRLF = "\r\n# Title\r\n\r\n## Context and Problem Statement\r\nText\r\n";

      const hash1 = computeBodyHash(bodyLF);
      const hash2 = computeBodyHash(bodyCRLF);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });

    it("detects body tampering when text changes", () => {
      const original = "# Title\n\n## Context\nOriginal text";
      const tampered = "# Title\n\n## Context\nTampered text";

      const originalHash = computeBodyHash(original);
      const tamperedHash = computeBodyHash(tampered);

      expect(originalHash).not.toBe(tamperedHash);
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

    it("filters active governing ADRs for a given module", () => {
      const chartAdrs = getGoverningAdrsForModule(
        "chart",
        mockAdrs as unknown as Parameters<typeof getGoverningAdrsForModule>[1]
      );

      expect(chartAdrs.map((a: { frontmatter: { id: string } }) => a.frontmatter.id)).toEqual(["ADR-0001", "ADR-0006"]);
      // Deprecated ADR-0099 is not included because it is not active ("accepted")
      expect(chartAdrs.some((a: { frontmatter: { id: string } }) => a.frontmatter.id === "ADR-0099")).toBe(false);
    });

    it("generates markdown bullet list for module README", () => {
      const existingReadme = `# Module Passport: chart\n\n## Verification\n\n- Black box tests.\n\n## Governing ADRs\n\n- Stale text\n`;
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
        governing as unknown as Parameters<typeof updateModuleReadmeContent>[1]
      );

      expect(updated).toContain("## Governing ADRs");
      expect(updated).toContain("- [ADR-0001: Modular Architecture](../../../docs/adr/0001-modular.md) \u2014 Architecture");
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
        adrs as unknown as Parameters<typeof generateAdrReadme>[0]
      );

      expect(generated).toContain("## Active Decisions Index");
      expect(generated).toContain("[ADR-0000](./0000-exec.md)");
      expect(generated).toContain("## Historical Decisions Index");
      expect(generated).toContain("[ADR-0008](./0008-old.md)");
    });
  });

  describe("Module Lifecycle Workflows: Creation, Refactoring, Deletion", () => {
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
        "utf8"
      );
    });

    afterEach(() => {
      try {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors on windows locks
      }
    });

    it("handles full lifecycle: module creation, ADR allocation, and README sync", () => {
      // 1. Create a new vertical module fixture
      const modPath = path.join(modulesDir, "order-analytics");

      fs.mkdirSync(path.join(modPath, "tests"), { recursive: true });

      fs.writeFileSync(
        path.join(modPath, "README.md"),
        "# Module: order-analytics\n\n## Governing ADRs\n*None*\n",
        "utf8"
      );

      fs.writeFileSync(
        path.join(modPath, "tests", "analytics.test.ts"),
        "export const testAnalytics = true;\n",
        "utf8"
      );

      // 2. Execute cmdNew to allocate ADR for new module
      const result = cmdNew(
        {
          title: "Order Analytics Subsystem",
          area: "Analytics & Orders",
          "applies-to": "src/modules/order-analytics",
          "enforced-by": "src/modules/order-analytics/tests/analytics.test.ts",
        },
        { rootDir: tmpRoot, silent: true }
      )!;

      expect(result).toBeDefined();
      expect(result.id).toBe("ADR-0000");

      // Verify ADR file was written
      const adrFilePath = path.join(adrDir, result.fileName);

      expect(fs.existsSync(adrFilePath)).toBe(true);

      const parsed = parse(fs.readFileSync(adrFilePath, "utf8"));

      expect(parsed.frontmatter.id).toBe("ADR-0000");
      expect(parsed.frontmatter.title).toBe("Order Analytics Subsystem");
      expect(parsed.frontmatter.status).toBe("accepted");
      expect(parsed.frontmatter.applies_to).toEqual(["src/modules/order-analytics"]);

      expect(parsed.frontmatter.enforced_by).toEqual([
        "src/modules/order-analytics/tests/analytics.test.ts",
      ]);

      // Verify lockfile entry
      const lock = readLockFile(path.join(adrDir, ".adr-lock.json"));

      expect(lock.records["ADR-0000"]).toBeDefined();
      expect(lock.records["ADR-0000"]).toBe(computeBodyHash(parsed.body));

      // Verify module README synchronization
      const modReadme = fs.readFileSync(path.join(modPath, "README.md"), "utf8");

      expect(modReadme).toContain("## Governing ADRs");
      expect(modReadme).toContain("[ADR-0000: Order Analytics Subsystem]");

      // Verify docs/adr/README.md synchronization
      const adrReadme = fs.readFileSync(path.join(adrDir, "README.md"), "utf8");

      expect(adrReadme).toContain("## Active Decisions Index");
      expect(adrReadme).toContain("[ADR-0000](./" + result.fileName + ")");

      // Verify checkAdrs passes with zero violations
      const checkResult = checkAdrs({ rootDir: tmpRoot });

      expect(checkResult.valid).toBe(true);
      expect(checkResult.errors).toHaveLength(0);
    });

    it("handles module refactoring/renaming: retargets paths while preserving immutable body hash", () => {
      // Setup initial module & ADR
      const oldModPath = path.join(modulesDir, "order-analytics");

      fs.mkdirSync(path.join(oldModPath, "tests"), { recursive: true });

      fs.writeFileSync(
        path.join(oldModPath, "README.md"),
        "# Module: order-analytics\n\n## Governing ADRs\n",
        "utf8"
      );

      fs.writeFileSync(
        path.join(oldModPath, "tests", "analytics.test.ts"),
        "export const testAnalytics = true;\n",
        "utf8"
      );

      const newAdrResult = cmdNew(
        {
          title: "Order Analytics Subsystem",
          area: "Analytics & Orders",
          "applies-to": "src/modules/order-analytics",
          "enforced-by": "src/modules/order-analytics/tests/analytics.test.ts",
        },
        { rootDir: tmpRoot, silent: true }
      )!;

      const initialLock = readLockFile(path.join(adrDir, ".adr-lock.json"));
      const initialHash = initialLock.records[newAdrResult.id];

      // Simulate refactoring/renaming module directory on filesystem
      const newModPath = path.join(modulesDir, "execution-analytics");

      fs.renameSync(oldModPath, newModPath);

      // Verify that before retargeting, checkAdrs catches missing path
      const preCheck = checkAdrs({ rootDir: tmpRoot });

      expect(preCheck.valid).toBe(false);

      expect(
        preCheck.errors.some((e) =>
          e.includes("Active applies_to path does not exist on filesystem: \"src/modules/order-analytics\"")
        )
      ).toBe(true);

      // Execute cmdRetarget
      const retargetCount = cmdRetarget(
        "src/modules/order-analytics",
        "src/modules/execution-analytics",
        { rootDir: tmpRoot, silent: true }
      );

      expect(retargetCount).toBe(1);

      // Verify frontmatter was updated
      const adrContent = fs.readFileSync(
        path.join(adrDir, newAdrResult.fileName),
        "utf8"
      );
      const parsed = parse(adrContent);

      expect(parsed.frontmatter.applies_to).toEqual(["src/modules/execution-analytics"]);

      expect(parsed.frontmatter.enforced_by).toEqual([
        "src/modules/execution-analytics/tests/analytics.test.ts",
      ]);

      // CRITICAL INVARIANT: Body hash in lockfile remains IDENTICAL!
      const postLock = readLockFile(path.join(adrDir, ".adr-lock.json"));

      expect(postLock.records[newAdrResult.id]).toBe(initialHash);
      expect(computeBodyHash(parsed.body)).toBe(initialHash);

      // Verify module README at new location is synchronized
      const newModReadme = fs.readFileSync(path.join(newModPath, "README.md"), "utf8");

      expect(newModReadme).toContain("## Governing ADRs");
      expect(newModReadme).toContain("[ADR-0000: Order Analytics Subsystem]");

      // Verify checkAdrs passes cleanly after retargeting
      const postCheck = checkAdrs({ rootDir: tmpRoot });

      expect(postCheck.valid).toBe(true);
      expect(postCheck.errors).toHaveLength(0);
    });

    it("handles module deletion: single-module ADR auto-deprecates and passes checkAdrs without requiring deleted path", () => {
      // Setup module & ADR
      const modPath = path.join(modulesDir, "legacy-terminal");

      fs.mkdirSync(path.join(modPath, "tests"), { recursive: true });

      fs.writeFileSync(
        path.join(modPath, "README.md"),
        "# Module: legacy-terminal\n\n## Governing ADRs\n",
        "utf8"
      );

      fs.writeFileSync(
        path.join(modPath, "tests", "terminal.test.ts"),
        "export const test = 1;\n",
        "utf8"
      );

      const adr = cmdNew(
        {
          title: "Legacy Terminal Subsystem",
          area: "UI & Layout",
          "applies-to": "src/modules/legacy-terminal",
          "enforced-by": "src/modules/legacy-terminal/tests/terminal.test.ts",
        },
        { rootDir: tmpRoot, silent: true }
      )!;

      const lockBefore = readLockFile(path.join(adrDir, ".adr-lock.json"));
      const hashBefore = lockBefore.records[adr.id];

      // Simulate deleting the module from the filesystem
      fs.rmSync(modPath, { recursive: true, force: true });

      // Before removing path from governance, checkAdrs fails
      const preCheck = checkAdrs({ rootDir: tmpRoot });

      expect(preCheck.valid).toBe(false);

      expect(
        preCheck.errors.some((e) =>
          e.includes("Active applies_to path does not exist on filesystem")
        )
      ).toBe(true);

      // Execute cmdRemovePath
      const removedCount = cmdRemovePath("src/modules/legacy-terminal", {
        rootDir: tmpRoot,
        silent: true,
      });

      expect(removedCount).toBe(1);

      // Verify that because ADR exclusively governed the removed module, it auto-deprecated
      const adrContent = fs.readFileSync(path.join(adrDir, adr.fileName), "utf8");
      const parsed = parse(adrContent);

      expect(parsed.frontmatter.status).toBe("deprecated");

      // Verify lockfile hash is unchanged
      const lockAfter = readLockFile(path.join(adrDir, ".adr-lock.json"));

      expect(lockAfter.records[adr.id]).toBe(hashBefore);
      expect(computeBodyHash(parsed.body)).toBe(hashBefore);

      // Verify docs/adr/README.md moved the ADR to Historical Decisions Index
      const adrReadme = fs.readFileSync(path.join(adrDir, "README.md"), "utf8");

      expect(adrReadme).toContain("## Historical Decisions Index");
      expect(adrReadme).toContain("[ADR-0000](./" + adr.fileName + ")");

      const activeSection = adrReadme.split("## Historical Decisions Index")[0];

      expect(activeSection).not.toContain("[ADR-0000]");

      // CRITICAL: checkAdrs now passes even though src/modules/legacy-terminal is gone!
      const postCheck = checkAdrs({ rootDir: tmpRoot });

      expect(postCheck.valid).toBe(true);
      expect(postCheck.errors).toHaveLength(0);
    });

    it("handles multi-module ADR deletion: prunes removed module without deprecating when other modules remain", () => {
      // Setup two modules
      const modAPath = path.join(modulesDir, "active-a");
      const modBPath = path.join(modulesDir, "legacy-b");

      fs.mkdirSync(path.join(modAPath, "tests"), { recursive: true });
      fs.mkdirSync(path.join(modBPath, "tests"), { recursive: true });
      fs.writeFileSync(path.join(modAPath, "README.md"), "# Module A\n\n## Governing ADRs\n", "utf8");
      fs.writeFileSync(path.join(modBPath, "README.md"), "# Module B\n\n## Governing ADRs\n", "utf8");
      fs.writeFileSync(path.join(modAPath, "tests", "a.test.ts"), "export const a = 1;\n", "utf8");
      fs.writeFileSync(path.join(modBPath, "tests", "b.test.ts"), "export const b = 2;\n", "utf8");

      // Multi-module ADR
      const adr = cmdNew(
        {
          title: "Multi Module Standard",
          area: "Architecture",
          "applies-to": "src/modules/active-a, src/modules/legacy-b",
          "enforced-by": "src/modules/active-a/tests/a.test.ts, src/modules/legacy-b/tests/b.test.ts",
        },
        { rootDir: tmpRoot, silent: true }
      )!;

      // Delete module B
      fs.rmSync(modBPath, { recursive: true, force: true });

      // Run remove-path on module B
      cmdRemovePath("src/modules/legacy-b", { rootDir: tmpRoot, silent: true });

      // Verify ADR is STILL accepted because active-a remains
      const adrContent = fs.readFileSync(path.join(adrDir, adr.fileName), "utf8");
      const parsed = parse(adrContent);

      expect(parsed.frontmatter.status).toBe("accepted");
      expect(parsed.frontmatter.applies_to).toEqual(["src/modules/active-a"]);
      expect(parsed.frontmatter.enforced_by).toEqual(["src/modules/active-a/tests/a.test.ts"]);

      // Verify checkAdrs passes
      const checkResult = checkAdrs({ rootDir: tmpRoot });

      expect(checkResult.valid).toBe(true);
      expect(checkResult.errors).toHaveLength(0);
    });

    it("fails checkAdrs when ADR body or lockfile is tampered with directly", () => {
      const modPath = path.join(modulesDir, "tamper-test");

      fs.mkdirSync(path.join(modPath, "tests"), { recursive: true });
      fs.writeFileSync(path.join(modPath, "README.md"), "# Module\n\n## Governing ADRs\n", "utf8");
      fs.writeFileSync(path.join(modPath, "tests", "t.test.ts"), "export const t = 1;\n", "utf8");

      const adr = cmdNew(
        {
          title: "Tamper Test Decision",
          area: "Security",
          "applies-to": "src/modules/tamper-test",
          "enforced-by": "src/modules/tamper-test/tests/t.test.ts",
        },
        { rootDir: tmpRoot, silent: true }
      )!;

      // 1. Tamper with body text directly
      const adrFilePath = path.join(adrDir, adr.fileName);
      const originalContent = fs.readFileSync(adrFilePath, "utf8");

      fs.writeFileSync(adrFilePath, originalContent + "\nIllegal unauthorized modification\n", "utf8");

      const bodyTamperCheck = checkAdrs({ rootDir: tmpRoot });

      expect(bodyTamperCheck.valid).toBe(false);
      expect(bodyTamperCheck.errors.some((e) => e.includes("Body hash mismatch!"))).toBe(true);

      // Restore
      fs.writeFileSync(adrFilePath, originalContent, "utf8");
      expect(checkAdrs({ rootDir: tmpRoot }).valid).toBe(true);

      // 2. Tamper with lockfile directly
      const lockPath = path.join(adrDir, ".adr-lock.json");
      const lockData = readLockFile(lockPath);

      lockData.records[adr.id] = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
      fs.writeFileSync(lockPath, JSON.stringify(lockData, null, 2), "utf8");

      const lockTamperCheck = checkAdrs({ rootDir: tmpRoot });

      expect(lockTamperCheck.valid).toBe(false);
      expect(lockTamperCheck.errors.some((e) => e.includes("Body hash mismatch!"))).toBe(true);
    });

    it("handles supersede workflow: creates new ADR, links bidirectionally, and preserves old body hash", () => {
      const modPath = path.join(modulesDir, "supersede-mod");

      fs.mkdirSync(path.join(modPath, "tests"), { recursive: true });
      fs.writeFileSync(path.join(modPath, "README.md"), "# Module\n\n## Governing ADRs\n", "utf8");
      fs.writeFileSync(path.join(modPath, "tests", "s.test.ts"), "export const s = 1;\n", "utf8");

      const initialAdr = cmdNew(
        {
          title: "Initial Decision",
          area: "Architecture",
          "applies-to": "src/modules/supersede-mod",
          "enforced-by": "src/modules/supersede-mod/tests/s.test.ts",
        },
        { rootDir: tmpRoot, silent: true }
      )!;

      const initialLock = readLockFile(path.join(adrDir, ".adr-lock.json"));
      const initialHash = initialLock.records[initialAdr.id];

      // Execute supersede
      const supersedeResult = cmdSupersede(
        initialAdr.id,
        {
          title: "Superseding Decision",
          area: "Architecture",
        },
        { rootDir: tmpRoot, silent: true }
      )!;

      expect(supersedeResult).toBeDefined();
      expect(supersedeResult.nextId).toBe("ADR-0001");

      // Verify old ADR frontmatter updated
      const oldParsed = parse(fs.readFileSync(path.join(adrDir, initialAdr.fileName), "utf8"));

      expect(oldParsed.frontmatter.status).toBe("superseded by ADR-0001");
      expect(oldParsed.frontmatter.superseded_by).toBe("ADR-0001");
      expect(oldParsed.frontmatter.supersedes).toBeNull();

      // Verify old ADR body hash in lockfile remains completely unchanged!
      const updatedLock = readLockFile(path.join(adrDir, ".adr-lock.json"));

      expect(updatedLock.records[initialAdr.id]).toBe(initialHash);
      expect(computeBodyHash(oldParsed.body)).toBe(initialHash);

      // Verify new ADR frontmatter
      const newParsed = parse(fs.readFileSync(path.join(adrDir, "0001-superseding-decision.md"), "utf8"));

      expect(newParsed.frontmatter.id).toBe("ADR-0001");
      expect(newParsed.frontmatter.status).toBe("accepted");
      expect(newParsed.frontmatter.supersedes).toBe("ADR-0000");
      expect(newParsed.frontmatter.superseded_by).toBeNull();
      expect(updatedLock.records["ADR-0001"]).toBe(computeBodyHash(newParsed.body));

      // Verify bidirectional integrity pass
      const checkResult = checkAdrs({ rootDir: tmpRoot });

      expect(checkResult.valid).toBe(true);
      expect(checkResult.errors).toHaveLength(0);

      // Verify docs/adr/README.md partitions old to Historical and new to Active
      const adrReadme = fs.readFileSync(path.join(adrDir, "README.md"), "utf8");

      expect(adrReadme).toContain("## Active Decisions Index");
      expect(adrReadme).toContain("[ADR-0001](./0001-superseding-decision.md)");
      expect(adrReadme).toContain("## Historical Decisions Index");
      expect(adrReadme).toContain("[ADR-0000](./" + initialAdr.fileName + ")");
    });

    it("handles explicit deprecate workflow: marks ADR as deprecated and updates indexes", () => {
      const modPath = path.join(modulesDir, "deprecate-mod");

      fs.mkdirSync(path.join(modPath, "tests"), { recursive: true });
      fs.writeFileSync(path.join(modPath, "README.md"), "# Module\n\n## Governing ADRs\n", "utf8");
      fs.writeFileSync(path.join(modPath, "tests", "d.test.ts"), "export const d = 1;\n", "utf8");

      const adr = cmdNew(
        {
          title: "Decision to Deprecate",
          area: "Storage",
          "applies-to": "src/modules/deprecate-mod",
          "enforced-by": "src/modules/deprecate-mod/tests/d.test.ts",
        },
        { rootDir: tmpRoot, silent: true }
      )!;

      const lockBefore = readLockFile(path.join(adrDir, ".adr-lock.json"));
      const hashBefore = lockBefore.records[adr.id];

      // Explicitly deprecate
      cmdDeprecate(adr.id, { rootDir: tmpRoot, silent: true });

      const parsed = parse(fs.readFileSync(path.join(adrDir, adr.fileName), "utf8"));

      expect(parsed.frontmatter.status).toBe("deprecated");

      // Hash untouched
      const lockAfter = readLockFile(path.join(adrDir, ".adr-lock.json"));

      expect(lockAfter.records[adr.id]).toBe(hashBefore);

      // Verify check passes
      const checkResult = checkAdrs({ rootDir: tmpRoot });

      expect(checkResult.valid).toBe(true);
      expect(checkResult.errors).toHaveLength(0);

      // Verify module README does not list deprecated ADR
      const modReadme = fs.readFileSync(path.join(modPath, "README.md"), "utf8");

      expect(modReadme).toContain("*No module-specific governing ADRs.*");
    });

    it("handles list and sync commands with filters and JSON output", () => {
      const modPath = path.join(modulesDir, "query-mod");

      fs.mkdirSync(path.join(modPath, "tests"), { recursive: true });
      fs.writeFileSync(path.join(modPath, "README.md"), "# Module\n\n## Governing ADRs\n", "utf8");
      fs.writeFileSync(path.join(modPath, "tests", "q.test.ts"), "export const q = 1;\n", "utf8");

      cmdNew(
        {
          title: "Query Decision Active",
          area: "Query",
          "applies-to": "src/modules/query-mod",
          "enforced-by": "src/modules/query-mod/tests/q.test.ts",
        },
        { rootDir: tmpRoot, silent: true }
      );

      // 1. JSON output
      const jsonList = cmdList({ json: true }, { rootDir: tmpRoot, silent: true }) as Array<{ id: string; status: string }>;

      expect(Array.isArray(jsonList)).toBe(true);
      expect(jsonList.length).toBe(1);
      expect(jsonList[0].id).toBe("ADR-0000");
      expect(jsonList[0].status).toBe("accepted");

      // 2. Module filter match & mismatch
      const match = cmdList({ module: "query-mod" }, { rootDir: tmpRoot, silent: true }) as Array<unknown>;

      expect(match.length).toBe(1);

      const mismatch = cmdList({ module: "non-existent" }, { rootDir: tmpRoot, silent: true }) as Array<unknown>;

      expect(mismatch.length).toBe(0);

      // 3. Explicit sync
      cmdSync({ rootDir: tmpRoot, silent: true });

      const adrReadme = fs.readFileSync(path.join(adrDir, "README.md"), "utf8");

      expect(adrReadme).toContain("## Active Decisions Index");
    });

    it("parses CLI arguments correctly via parseArgs", () => {
      const parsed = parseArgs([
        "new",
        "--title",
        "Test Title",
        "--area",
        "Storage",
        "--all",
        "--applies-to",
        "src/modules/storage",
      ]) as unknown as { _: string[]; title: string; area: string; all: boolean; "applies-to": string };

      expect(parsed._).toEqual(["new"]);
      expect(parsed.title).toBe("Test Title");
      expect(parsed.area).toBe("Storage");
      expect(parsed.all).toBe(true);
      expect(parsed["applies-to"]).toBe("src/modules/storage");
    });
  });
});
