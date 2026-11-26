import path from "node:path";

import stylelint from "stylelint";

const ONLY_MODULE_CSS_RULE = "z-trader/only-module-css";

const ALLOWED_NON_MODULE_CSS = new Set(["src/app/globals.css", "src/shared/theme/tokens.css"]);

const onlyModuleCssPlugin = stylelint.createPlugin(
  ONLY_MODULE_CSS_RULE,
  (primaryOption) => (root, result) => {
    if (!primaryOption) return;

    const rawFrom = result.opts.from;

    if (!rawFrom) return;

    const relPath = path.relative(process.cwd(), rawFrom).replace(/\\/g, "/");

    if (ALLOWED_NON_MODULE_CSS.has(relPath)) return;

    if (/^src\/.+\.module\.css$/i.test(relPath)) return;

    stylelint.utils.report({
      result,
      ruleName: ONLY_MODULE_CSS_RULE,
      message: `Stylesheet "${relPath}" is forbidden by ADR-0003. Only *.module.css files under src/ (plus globals.css and tokens.css) are allowed.`,
      node: root,
    });
  },
);

/** @type {import('stylelint').Config} */
const config = {
  plugins: [onlyModuleCssPlugin],
  rules: {
    [ONLY_MODULE_CSS_RULE]: true,
    "color-no-hex": true,
    "color-named": "never",
    "function-disallowed-list": [
      "rgb",
      "rgba",
      "hsl",
      "hsla",
      "hwb",
      "lab",
      "lch",
      "oklab",
      "oklch",
      "color",
    ],
    "selector-class-pattern": [
      "^(?:[a-z][a-zA-Z0-9]*|theme-(?:light|dark)-only)$",
      {
        message: (selector) =>
          `Expected class selector "${selector}" to use concise camelCase without BEM prefixes or "__".`,
      },
    ],
  },
  overrides: [
    {
      files: ["src/shared/theme/tokens.css"],
      rules: {
        "color-no-hex": null,
        "color-named": null,
        "function-disallowed-list": null,
      },
    },
    {
      files: ["src/app/globals.css"],
      rules: {
        "selector-class-pattern": null,
        "selector-max-class": 0,
        "selector-max-id": 0,
      },
    },
  ],
};

export default config;
