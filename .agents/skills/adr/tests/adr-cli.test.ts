import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  checkAdrs,
  createNewAdr,
  deprecateAdr,
  listAdrs,
  removeAdrPath,
  retargetAdrPaths,
  runCli,
  supersedeAdr,
  syncAdrs,
} from "../scripts/adr-cli.mjs";

const tempDirs: string[] = [];

function createFixtureWorkspace(): string {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "z-trader-adr-test-"));

  tempDirs.push(rootDir);

  fs.mkdirSync(path.join(rootDir, "docs", "adr"), { recursive: true });
  fs.mkdirSync(path.join(rootDir, "src", "modules", "chart", "tests"), { recursive: true });
  fs.mkdirSync(path.join(rootDir, "src", "modules", "indicators", "tests"), { recursive: true });

  fs.writeFileSync(
    path.join(rootDir, "src", "modules", "chart", "tests", "chart.test.ts"),
    "export {};\n",
    "utf8",
  );

  fs.writeFileSync(
    path.join(rootDir, "src", "modules", "indicators", "tests", "indicators.test.ts"),
    "export {};\n",
    "utf8",
  );

  fs.writeFileSync(
    path.join(rootDir, "src", "modules", "chart", "README.md"),
    "# Module Passport: `chart`\n\n## Verification\n\n- Tested.\n",
    "utf8",
  );

  fs.writeFileSync(
    path.join(rootDir, "src", "modules", "indicators", "README.md"),
    "# Module Passport: `indicators`\n\n## Verification\n\n- Tested.\n",
    "utf8",
  );

  return rootDir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();

    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("ADR Governance CLI & Lifecycle", () => {
  it("validates the live repository ADR log with zero errors", () => {
    const repoRoot = process.cwd();
    const result = checkAdrs(repoRoot);

    expect(result).toEqual({ ok: true, errors: [] });
  });

  it("scaffolds a new ADR, locks its body hash, and synchronizes READMEs", () => {
    const rootDir = createFixtureWorkspace();

    const created = createNewAdr(rootDir, {
      title: "Canvas Chart Rendering",
      area: "Charting & Performance",
      appliesTo: ["src/modules/chart"],
      enforcedBy: ["src/modules/chart/tests/chart.test.ts"],
    });

    expect(created.id).toBe("ADR-0001");
    expect(created.filename).toBe("0001-canvas-chart-rendering.md");
    expect(fs.existsSync(created.filePath)).toBe(true);

    const checkResult = checkAdrs(rootDir);

    expect(checkResult).toEqual({ ok: true, errors: [] });

    const chartReadme = fs.readFileSync(
      path.join(rootDir, "src", "modules", "chart", "README.md"),
      "utf8",
    );

    expect(chartReadme).toContain("## Governing ADRs");

    expect(chartReadme).toContain(
      "- [ADR-0001: Canvas Chart Rendering](../../../docs/adr/0001-canvas-chart-rendering.md) — Charting & Performance",
    );

    const listChart = listAdrs(rootDir, { module: "chart" });

    expect(listChart).toHaveLength(1);
    expect(listChart[0]?.id).toBe("ADR-0001");
  });

  it("supersedes an accepted ADR, preserves historical immutability, and updates indexes", () => {
    const rootDir = createFixtureWorkspace();

    createNewAdr(rootDir, {
      title: "SVG Chart Engine",
      area: "Charting",
      appliesTo: ["src/modules/chart"],
      enforcedBy: ["src/modules/chart/tests/chart.test.ts"],
    });

    const { supersededId, newAdr } = supersedeAdr(rootDir, "ADR-0001", {
      title: "Lightweight Charts Canvas Engine",
    });

    expect(supersededId).toBe("ADR-0001");
    expect(newAdr.id).toBe("ADR-0002");

    const checkResult = checkAdrs(rootDir);

    expect(checkResult).toEqual({ ok: true, errors: [] });

    const activeForChart = listAdrs(rootDir, { module: "chart" });

    expect(activeForChart.map((a) => a.id)).toEqual(["ADR-0002"]);

    const allForChart = listAdrs(rootDir, { module: "chart", all: true });

    expect(allForChart.map((a) => a.id)).toEqual(["ADR-0001", "ADR-0002"]);

    const adrReadme = fs.readFileSync(path.join(rootDir, "docs", "adr", "README.md"), "utf8");

    expect(adrReadme).toContain("## Active Decisions Index");
    expect(adrReadme).toContain("## Historical Decisions Index");
    expect(adrReadme).toContain("superseded by ADR-0002");
  });

  it("retargets active ADRs on module rename while leaving historical ADRs untouched", () => {
    const rootDir = createFixtureWorkspace();

    createNewAdr(rootDir, {
      title: "Legacy Indicators V1",
      area: "Indicators",
      appliesTo: ["src/modules/indicators"],
      enforcedBy: ["src/modules/indicators/tests/indicators.test.ts"],
    });

    supersedeAdr(rootDir, "ADR-0001", {
      title: "Streaming Indicators V2",
    });

    // Rename src/modules/indicators -> src/modules/indicators-engine on disk
    fs.renameSync(
      path.join(rootDir, "src", "modules", "indicators"),
      path.join(rootDir, "src", "modules", "indicators-engine"),
    );

    const { updatedIds } = retargetAdrPaths(
      rootDir,
      "src/modules/indicators",
      "src/modules/indicators-engine",
    );

    expect(updatedIds).toEqual(["ADR-0002"]);

    const allAdrs = listAdrs(rootDir, { all: true });
    const historical = allAdrs.find((a) => a.id === "ADR-0001");
    const active = allAdrs.find((a) => a.id === "ADR-0002");

    // Historical ADR keeps old path without failing checkAdrs
    expect(historical?.appliesTo).toEqual(["src/modules/indicators"]);
    expect(active?.appliesTo).toEqual(["src/modules/indicators-engine"]);

    expect(active?.enforcedBy).toEqual([
      "src/modules/indicators-engine/tests/indicators.test.ts",
    ]);

    expect(checkAdrs(rootDir)).toEqual({ ok: true, errors: [] });
  });

  it("prunes removed paths from multi-module ADRs and auto-deprecates single-module ADRs", () => {
    const rootDir = createFixtureWorkspace();

    // ADR-0001 governs both chart and indicators
    createNewAdr(rootDir, {
      title: "Shared Module Conventions",
      area: "Architecture",
      appliesTo: ["src/modules/chart", "src/modules/indicators"],
      enforcedBy: [
        "src/modules/chart/tests/chart.test.ts",
        "src/modules/indicators/tests/indicators.test.ts",
      ],
    });

    // ADR-0002 governs exclusively indicators
    createNewAdr(rootDir, {
      title: "Indicators Calculation Rules",
      area: "Indicators",
      appliesTo: ["src/modules/indicators"],
      enforcedBy: ["src/modules/indicators/tests/indicators.test.ts"],
    });

    // Remove indicators directory and run remove-path
    fs.rmSync(path.join(rootDir, "src", "modules", "indicators"), {
      recursive: true,
      force: true,
    });

    const { prunedIds, autoDeprecatedIds } = removeAdrPath(rootDir, "src/modules/indicators");

    expect(prunedIds).toEqual(["ADR-0001"]);
    expect(autoDeprecatedIds).toEqual(["ADR-0002"]);

    const allAdrs = listAdrs(rootDir, { all: true });

    expect(allAdrs.find((a) => a.id === "ADR-0001")?.status).toBe("accepted");
    expect(allAdrs.find((a) => a.id === "ADR-0001")?.appliesTo).toEqual(["src/modules/chart"]);
    expect(allAdrs.find((a) => a.id === "ADR-0002")?.status).toBe("deprecated");

    expect(checkAdrs(rootDir)).toEqual({ ok: true, errors: [] });
  });

  it("detects body tampering, git HEAD lockfile modification, and rejects bypass flags", () => {
    const rootDir = createFixtureWorkspace();

    const created = createNewAdr(rootDir, {
      title: "Immutable Decision Record",
      area: "Governance",
      appliesTo: ["src/modules/chart"],
      enforcedBy: ["src/modules/chart/tests/chart.test.ts"],
    });

    // Initialize git repository and commit initial state
    execFileSync("git", ["init"], { cwd: rootDir, stdio: "ignore" });

    execFileSync("git", ["config", "user.email", "test@example.com"], {
      cwd: rootDir,
      stdio: "ignore",
    });

    execFileSync("git", ["config", "user.name", "Test Agent"], {
      cwd: rootDir,
      stdio: "ignore",
    });

    execFileSync("git", ["add", "."], { cwd: rootDir, stdio: "ignore" });

    execFileSync("git", ["commit", "-m", "chore: initial adr lock"], {
      cwd: rootDir,
      stdio: "ignore",
    });

    // Tamper with the ADR body
    const originalContent = fs.readFileSync(created.filePath, "utf8");
    const tamperedContent = originalContent.replace(
      "Chosen option: **Immutable Decision Record**",
      "Chosen option: **Silently Hacked Decision**",
    );

    fs.writeFileSync(created.filePath, tamperedContent, "utf8");

    // syncAdrs must not overwrite existing locked hash
    syncAdrs(rootDir);

    const tamperCheck = checkAdrs(rootDir);

    expect(tamperCheck.ok).toBe(false);
    expect(tamperCheck.errors.some((e) => e.includes("Tampering violation"))).toBe(true);

    // Even if an attacker manually rewrites .adr-lock.json, git HEAD anchoring catches it
    const lockPath = path.join(rootDir, "docs", "adr", ".adr-lock.json");

    fs.writeFileSync(
      lockPath,
      JSON.stringify({ version: 1, records: { "ADR-0001": "0".repeat(64) } }, null, 2),
      "utf8",
    );

    const headTamperCheck = checkAdrs(rootDir);

    expect(headTamperCheck.ok).toBe(false);

    expect(
      headTamperCheck.errors.some((e) => e.includes("modified relative to git HEAD")),
    ).toBe(true);

    // Bypass flags must be rejected
    expect(() => runCli(["check", "--force"], rootDir)).toThrow(/Forbidden bypass flag/);
    expect(() => runCli(["sync", "--allow-edit"], rootDir)).toThrow(/Forbidden bypass flag/);
  });

  it("supports deprecate command via CLI", () => {
    const rootDir = createFixtureWorkspace();

    createNewAdr(rootDir, {
      title: "Temporary Feature Decision",
      area: "Features",
      appliesTo: ["src/modules/chart"],
      enforcedBy: ["src/modules/chart/tests/chart.test.ts"],
    });

    deprecateAdr(rootDir, "0001");

    const all = listAdrs(rootDir, { all: true });

    expect(all[0]?.status).toBe("deprecated");
    expect(checkAdrs(rootDir)).toEqual({ ok: true, errors: [] });
  });
});
