/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Warn or error when dependencies form a cycle",
      from: {},
      to: {
        circular: true,
      },
    },
    {
      name: "src-no-app",
      severity: "error",
      comment: "Layer violation: code in src/ must not depend on app shell/routing.",
      from: {
        path: "^src",
        pathNot: "^src/app",
      },
      to: {
        path: "^src/app",
      },
    },
    {
      name: "shared-no-modules-composition-or-app",
      severity: "error",
      comment: "Layer violation: src/shared must not depend on modules, composition root, or app.",
      from: {
        path: "^src/shared",
      },
      to: {
        path: "^src/(modules|composition|app)",
      },
    },
    {
      name: "modules-no-composition-or-app",
      severity: "error",
      comment: "Layer violation: src/modules must not depend on composition root or app.",
      from: {
        path: "^src/modules",
      },
      to: {
        path: "^src/(composition|app)",
      },
    },
    {
      name: "composition-no-app",
      severity: "error",
      comment: "Layer violation: src/composition must not depend on app routing.",
      from: {
        path: "^src/composition",
      },
      to: {
        path: "^src/app",
      },
    },
    {
      name: "app-no-modules",
      severity: "error",
      comment:
        "Layer violation: app shell must not depend directly on domain modules. Route via src/composition.",
      from: {
        path: "^src/app",
      },
      to: {
        path: "^src/modules",
      },
    },
    {
      name: "widget-isolation",
      severity: "error",
      comment:
        "Widget isolation: widgets (chart, order-book, time-and-sales) must not depend on each other or workspace.",
      from: {
        path: "^src/modules/(chart|order-book|time-and-sales)",
      },
      to: {
        path: "^src/modules/(workspace|chart|order-book|time-and-sales)",
        pathNot: "^src/modules/$1",
      },
    },
    {
      name: "workspace-widget-independence",
      severity: "error",
      comment: "Workspace independence: workspace module must not depend on concrete widgets.",
      from: {
        path: "^src/modules/workspace",
      },
      to: {
        path: "^src/modules/(chart|order-book|time-and-sales)",
      },
    },
    {
      name: "market-data-service-isolation",
      severity: "error",
      comment:
        "Service isolation: market-data stream service must not depend on any other domain module.",
      from: {
        path: "^src/modules/market-data",
      },
      to: {
        path: "^src/modules",
        pathNot: "^src/modules/market-data",
      },
    },
    {
      name: "indicators-isolation",
      severity: "error",
      comment:
        "Engine isolation: indicators is a pure calculation module and must not depend on other domain modules.",
      from: {
        path: "^src/modules/indicators",
      },
      to: {
        path: "^src/modules",
        pathNot: "^src/modules/indicators",
      },
    },
    {
      name: "instruments-isolation",
      severity: "error",
      comment:
        "Catalog isolation: instruments must not depend on widgets, workspace, or other domain modules.",
      from: {
        path: "^src/modules/instruments",
      },
      to: {
        path: "^src/modules",
        pathNot: "^src/modules/instruments",
      },
    },
    {
      name: "no-deep-imports-composition",
      severity: "error",
      comment:
        "Deep imports into composition are forbidden. Import only from public entry point '@/src/composition' (src/composition/index.ts).",
      from: {
        pathNot: "^src/composition/(?!tests/)",
      },
      to: {
        path: "^src/composition/",
        pathNot: "^src/composition/index\\.ts$",
      },
    },
    {
      name: "no-deep-imports-modules-external",
      severity: "error",
      comment:
        "Deep imports into modules are forbidden. Import only from public entry point '@/src/modules/<name>' (src/modules/<name>/index.ts).",
      from: {
        pathNot: "^src/modules/",
      },
      to: {
        path: "^src/modules/[^/]+/",
        pathNot: "^src/modules/[^/]+/index\\.ts$",
      },
    },
    {
      name: "no-deep-imports-modules-cross",
      severity: "error",
      comment:
        "Cross-module deep imports are forbidden. Import other modules only via their public entry point '@/src/modules/<name>'.",
      from: {
        path: "^src/modules/([^/]+)/",
        pathNot: "^src/modules/[^/]+/tests/",
      },
      to: {
        path: "^src/modules/[^/]+/",
        pathNot: ["^src/modules/$1/", "^src/modules/[^/]+/index\\.ts$"],
      },
    },
    {
      name: "no-deep-imports-modules-tests",
      severity: "error",
      comment:
        "Module tests must import only from public module contract ('@/src/modules/<name>' or '../index'). Internal implementation imports are forbidden.",
      from: {
        path: "^src/modules/([^/]+)/tests/",
      },
      to: {
        path: "^src/modules/[^/]+/",
        pathNot: ["^src/modules/[^/]+/index\\.ts$", "^src/modules/$1/tests/"],
      },
    },
    {
      name: "no-deep-imports-shared-external",
      severity: "error",
      comment:
        "Deep imports into shared segments are forbidden. Import only from public entry point '@/src/shared/<segment>' (src/shared/<segment>/index.ts).",
      from: {
        pathNot: "^src/shared/",
      },
      to: {
        path: "^src/shared/[^/]+/",
        pathNot: "^src/shared/[^/]+/index\\.ts$",
      },
    },
    {
      name: "no-deep-imports-shared-cross",
      severity: "error",
      comment:
        "Cross-segment deep imports in shared are forbidden. Import other shared segments only via '@/src/shared/<segment>'.",
      from: {
        path: "^src/shared/([^/]+)/",
        pathNot: "^src/shared/[^/]+/tests/",
      },
      to: {
        path: "^src/shared/[^/]+/",
        pathNot: ["^src/shared/$1/", "^src/shared/[^/]+/index\\.ts$"],
      },
    },
    {
      name: "no-deep-imports-shared-tests",
      severity: "error",
      comment:
        "Shared tests must import only from public shared contract ('@/src/shared/<segment>' or '../index'). Internal implementation imports are forbidden.",
      from: {
        path: "^src/shared/([^/]+)/tests/",
      },
      to: {
        path: "^src/shared/[^/]+/",
        pathNot: ["^src/shared/[^/]+/index\\.ts$", "^src/shared/$1/tests/"],
      },
    },
    {
      name: "production-not-to-test",
      severity: "error",
      comment: "Production code must not import from test files or test suites.",
      from: {
        path: "^src",
        pathNot: "tests?/",
      },
      to: {
        path: "(^tests/|/tests/|\\.test\\.(ts|tsx)$|\\.spec\\.(ts|tsx)$)",
      },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
    },
    tsConfig: {
      fileName: "tsconfig.json",
    },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
    reporterOptions: {
      dot: {
        collapsePattern: "node_modules/[^/]+",
      },
    },
  },
};
