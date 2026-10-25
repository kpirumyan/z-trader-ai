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
      },
      to: {
        path: "^app",
      },
    },
    {
      name: "shared-no-modules-or-composition",
      severity: "error",
      comment: "Layer violation: src/shared must not depend on modules, composition root, or app.",
      from: {
        path: "^src/shared",
      },
      to: {
        path: "^(src/(modules|composition)|app)",
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
        path: "^(src/composition|app)",
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
        path: "^app",
      },
    },
    {
      name: "app-no-modules",
      severity: "error",
      comment:
        "Layer violation: app shell must not depend directly on domain modules. Route via src/composition.",
      from: {
        path: "^app",
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
      name: "production-not-to-test",
      severity: "error",
      comment: "Production code must not import from test files or test suites.",
      from: {
        path: "^(src|app)",
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
