import { describe, expect, it } from "vitest";

import depCruiserConfig from "../../../.dependency-cruiser.cjs";
import knipConfig from "../../../knip.json";
import packageJson from "../../../package.json";

describe("Strict verification gates configuration", () => {
  describe("Dependency-cruiser architectural boundaries", () => {
    it("configures market-data-service-isolation rule with error severity", () => {
      const forbiddenRules = depCruiserConfig.forbidden;

      expect(forbiddenRules).toBeDefined();

      if (!forbiddenRules) {
        throw new Error("depCruiserConfig.forbidden is required");
      }

      const rule = forbiddenRules.find(
        (candidate) => candidate.name === "market-data-service-isolation",
      );

      expect(rule).toBeDefined();

      if (!rule || !("to" in rule)) {
        throw new Error("market-data-service-isolation regular forbidden rule is required");
      }

      expect(rule.severity).toBe("error");
      expect(rule.from.path).toBe("^src/modules/market-data");
      expect(rule.to.path).toBe("^src/modules/(chart|order-book|time-and-sales|workspace)");
    });

    it("verifies market-data-service-isolation rule correctly isolates market-data from UI widgets and workspace", () => {
      const forbiddenRules = depCruiserConfig.forbidden;

      expect(forbiddenRules).toBeDefined();

      if (!forbiddenRules) {
        throw new Error("depCruiserConfig.forbidden is required");
      }

      const rule = forbiddenRules.find(
        (candidate) => candidate.name === "market-data-service-isolation",
      );

      expect(rule).toBeDefined();

      if (!rule || !("to" in rule)) {
        throw new Error("market-data-service-isolation regular forbidden rule is required");
      }

      if (typeof rule.from.path !== "string" || typeof rule.to.path !== "string") {
        throw new Error("Rule paths must be configured as regex strings");
      }

      const fromRegex = new RegExp(rule.from.path);
      const toRegex = new RegExp(rule.to.path);

      // Verify matching 'from' path for market-data module files
      expect(fromRegex.test("src/modules/market-data/index.ts")).toBe(true);
      expect(fromRegex.test("src/modules/market-data/model/market-stream.ts")).toBe(true);
      expect(fromRegex.test("src/modules/market-data/model/demo-feed.ts")).toBe(true);

      // Verify non-matching 'from' path for other modules
      expect(fromRegex.test("src/modules/chart/index.ts")).toBe(false);
      expect(fromRegex.test("src/modules/order-book/index.ts")).toBe(false);
      expect(fromRegex.test("src/modules/workspace/index.ts")).toBe(false);
      expect(fromRegex.test("src/shared/contracts/index.ts")).toBe(false);

      // Verify forbidden destinations (UI widgets and workspace manager)
      expect(toRegex.test("src/modules/chart/index.ts")).toBe(true);
      expect(toRegex.test("src/modules/order-book/index.ts")).toBe(true);
      expect(toRegex.test("src/modules/time-and-sales/index.ts")).toBe(true);
      expect(toRegex.test("src/modules/workspace/index.ts")).toBe(true);
      expect(toRegex.test("src/modules/chart/ui/chart-view.tsx")).toBe(true);
      expect(toRegex.test("src/modules/workspace/model/workspace-store.ts")).toBe(true);

      // Verify allowed destinations (shared libraries and domain instruments)
      expect(toRegex.test("src/shared/contracts/market-data-contracts.ts")).toBe(false);
      expect(toRegex.test("src/shared/theme/index.ts")).toBe(false);
      expect(toRegex.test("src/shared/lib/cn.ts")).toBe(false);
      expect(toRegex.test("src/modules/instruments/index.ts")).toBe(false);
    });
  });

  describe("Knip dead-code analyzer configuration", () => {
    it("enforces strict zero-tolerance error rules for exports and types in knip.json", () => {
      expect(knipConfig.rules.files).toBe("error");
      expect(knipConfig.rules.dependencies).toBe("error");
      expect(knipConfig.rules.unlisted).toBe("error");
      expect(knipConfig.rules.unresolved).toBe("error");
      expect(knipConfig.rules.exports).toBe("error");
      expect(knipConfig.rules.types).toBe("error");
    });

    it("verifies expected knip entry points and ignored dependencies", () => {
      expect(knipConfig.entry).toContain("src/composition/widgets.ts");
      expect(knipConfig.entry).toContain("src/modules/*/index.ts");
      expect(knipConfig.entry).toContain("src/shared/*/index.ts");
      expect(knipConfig.ignoreDependencies).toContain("agent-browser");
    });
  });

  describe("Package.json scripts and verification pipeline", () => {
    it("configures knip script with --max-issues 0 flag", () => {
      expect(packageJson.scripts.knip).toBe("knip --max-issues 0");
    });

    it("ensures verification pipelines execute strict knip check", () => {
      expect(packageJson.scripts["check:fast"]).toContain("pnpm knip");
      expect(packageJson.scripts.check).toContain("pnpm knip");
    });
  });
});
