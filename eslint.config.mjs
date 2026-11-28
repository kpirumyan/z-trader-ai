import path from "node:path";

import stylistic from "@stylistic/eslint-plugin";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettierConfig from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

const STYLESHEET_EXT_RE = /\.(css|scss|sass|less)(?:\?.*)?$/i;
const MODULE_CSS_EXT_RE = /\.module\.css(?:\?.*)?$/i;
const LITERAL_COLOR_RE =
  /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|oklab|oklch|lab|lch|color)\s*\(/i;

const ALLOWED_INLINE_GEOMETRY_PROPS = new Set([
  "left",
  "top",
  "right",
  "bottom",
  "width",
  "height",
  "minWidth",
  "maxWidth",
  "minHeight",
  "maxHeight",
  "zIndex",
  "transform",
]);

function getPropertyKeyName(prop) {
  if (prop.computed) return null;

  if (prop.key.type === "Identifier") return prop.key.name;

  if (prop.key.type === "Literal" && typeof prop.key.value === "string") {
    return prop.key.value;
  }

  return null;
}

function getLiteralColorMatch(node) {
  if (!node) return false;

  if (node.type === "Literal" && typeof node.value === "string") {
    return LITERAL_COLOR_RE.test(node.value);
  }

  if (node.type === "TemplateLiteral") {
    return node.quasis.some((q) => LITERAL_COLOR_RE.test(q.value.raw));
  }

  return false;
}

function validateInlineStyleExpression(expr, context, inConditional = false) {
  if (!expr) return;

  if (
    (expr.type === "Identifier" && expr.name === "undefined") ||
    (expr.type === "Literal" && expr.value === null)
  ) {
    return;
  }

  if (expr.type === "ConditionalExpression") {
    validateInlineStyleExpression(expr.consequent, context, true);
    validateInlineStyleExpression(expr.alternate, context, true);

    return;
  }

  if (expr.type === "LogicalExpression" && expr.operator === "&&") {
    validateInlineStyleExpression(expr.right, context, true);

    return;
  }

  if (expr.type !== "ObjectExpression") {
    context.report({
      node: expr,
      message:
        "Inline style props must only be plain objects setting runtime geometry/layout or CSS variables. Move styles to *.module.css.",
    });

    return;
  }

  for (const prop of expr.properties) {
    if (prop.type !== "Property") {
      context.report({
        node: prop,
        message:
          "Spread properties inside JSX style props are forbidden. Move styles to *.module.css.",
      });

      continue;
    }

    const keyName = getPropertyKeyName(prop);

    if (!keyName) {
      context.report({
        node: prop,
        message: "Computed style keys are forbidden. Move styles to *.module.css.",
      });

      continue;
    }

    const isCssVar = keyName.startsWith("--");
    const isConditionalDisplay = inConditional && keyName === "display";

    if (!isCssVar && !isConditionalDisplay && !ALLOWED_INLINE_GEOMETRY_PROPS.has(keyName)) {
      context.report({
        node: prop,
        message: `Inline CSS property '${keyName}' is forbidden by ADR-0003. Move styles to a co-located *.module.css file.`,
      });

      continue;
    }

    if (getLiteralColorMatch(prop.value)) {
      context.report({
        node: prop.value,
        message:
          "Raw color values are forbidden in inline styles. Reference tokens in *.module.css.",
      });
    }
  }
}

const stylePolicyPlugin = {
  rules: {
    "only-module-css": {
      meta: {
        type: "problem",
        docs: {
          description: "Restrict styling in UI code to co-located CSS Modules (*.module.css)",
        },
        schema: [],
      },
      create(context) {
        const relFile = path.relative(import.meta.dirname, context.filename).replace(/\\/g, "/");
        const isSrcFile = relFile.startsWith("src/");

        return {
          ImportDeclaration(node) {
            const source = node.source.value;

            if (typeof source !== "string" || !STYLESHEET_EXT_RE.test(source)) return;

            if (MODULE_CSS_EXT_RE.test(source)) return;

            if (relFile === "src/app/layout.tsx" && source === "./globals.css") return;

            context.report({
              node: node.source,
              message:
                "Only *.module.css stylesheets may be imported (except ./globals.css in src/app/layout.tsx).",
            });
          },
          JSXOpeningElement(node) {
            if (node.name.type === "JSXIdentifier" && node.name.name === "style") {
              context.report({
                node,
                message:
                  "Inline <style> elements are forbidden. Use a co-located *.module.css file.",
              });
            }
          },
          JSXAttribute(node) {
            if (!isSrcFile) return;

            if (node.name.type !== "JSXIdentifier" || node.name.name !== "style") return;

            if (!node.value || node.value.type !== "JSXExpressionContainer") {
              context.report({
                node,
                message: "Static JSX style attributes are forbidden. Use *.module.css.",
              });

              return;
            }

            validateInlineStyleExpression(node.value.expression, context);
          },
        };
      },
    },
  },
};

const englishCodePlugin = {
  rules: {
    "only-english": {
      meta: {
        type: "problem",
        docs: {
          description: "Enforce English-only comments and identifiers in source files",
        },
        schema: [],
      },
      create(context) {
        const sourceCode = context.sourceCode;

        return {
          Program() {
            const comments = sourceCode.getAllComments();

            for (const comment of comments) {
              if (/\p{Script=Cyrillic}/u.test(comment.value)) {
                context.report({
                  loc: comment.loc,
                  message:
                    "In-code comments must be strictly in English. Cyrillic characters are forbidden.",
                });
              }
            }
          },
          Identifier(node) {
            if (/\p{Script=Cyrillic}/u.test(node.name)) {
              context.report({
                node,
                message: `Identifier '${node.name}' must be strictly in English. Cyrillic characters are forbidden.`,
              });
            }
          },
        };
      },
    },
  },
};

const SAFE_STORAGE_ERROR =
  "Direct localStorage access is forbidden outside src/shared/storage. Use safeStorage from @/src/shared/storage.";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    extends: [...tseslint.configs.recommendedTypeCheckedOnly],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["vitest.config.mts"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: ["**/*.{js,jsx,mjs,ts,tsx,mts,cts}"],
    plugins: {
      "@stylistic": stylistic,
      "english-code": englishCodePlugin,
      "style-policy": stylePolicyPlugin,
    },
    settings: {
      "import/internal-regex": "^@/",
    },
    rules: {
      "english-code/only-english": "error",
      "style-policy/only-module-css": "error",
      ...reactHooks.configs.flat["recommended-latest"].rules,
      "import/order": [
        "error",
        {
          groups: [
            "builtin",
            "external",
            "internal",
            ["parent", "sibling"],
            "index",
            "object",
            "type",
          ],
          "newlines-between": "always",
          alphabetize: {
            order: "asc",
            caseInsensitive: true,
          },
        },
      ],
      "import/newline-after-import": ["error", { count: 1 }],
      "@stylistic/padding-line-between-statements": [
        "error",
        { blankLine: "always", prev: "*", next: "return" },
        { blankLine: "always", prev: "*", next: ["const", "let", "var"] },
        { blankLine: "always", prev: ["const", "let", "var"], next: "*" },
        { blankLine: "always", prev: "block-like", next: "*" },
        { blankLine: "always", prev: "*", next: "block-like" },
        { blankLine: "any", prev: ["const", "let", "var"], next: ["const", "let", "var"] },
        { blankLine: "always", prev: "directive", next: "*" },
        { blankLine: "any", prev: "directive", next: "directive" },
        { blankLine: "always", prev: ["case", "default"], next: "*" },
        { blankLine: "always", prev: "import", next: "*" },
        { blankLine: "any", prev: "import", next: "import" },
      ],
    },
  },
  {
    files: ["src/**/types.ts", "src/**/types/**/*.{ts,tsx}", ".agents/tracing/types.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "ExportNamedDeclaration > VariableDeclaration",
          message:
            "Do not export runtime variables/constants from types files. Place constants in constants.ts.",
        },
        {
          selector: "ExportNamedDeclaration > FunctionDeclaration",
          message:
            "Do not export runtime functions from types files. Place functions in appropriate utility or domain files.",
        },
        {
          selector: "ExportDefaultDeclaration",
          message: "Do not use default export in types files. Export explicit types.",
        },
      ],
    },
  },
  {
    files: ["src/modules/*/index.ts", "src/shared/*/index.ts", "src/composition/index.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "FunctionDeclaration",
          message:
            "Do not declare functions in public barrel index.ts. Re-export from implementation files.",
        },
        {
          selector: "VariableDeclaration",
          message:
            "Do not declare variables in public barrel index.ts. Re-export from implementation files.",
        },
        {
          selector: "ClassDeclaration",
          message:
            "Do not declare classes in public barrel index.ts. Re-export from implementation files.",
        },
        {
          selector: "ExportDefaultDeclaration",
          message:
            "Do not use default export in public barrel index.ts. Export named public contract symbols.",
        },
      ],
    },
  },
  {
    files: ["src/**/*.{js,jsx,mjs,ts,tsx,mts,cts}"],
    ignores: [
      "src/shared/storage/**",
      "**/*.test.{js,jsx,mjs,ts,tsx,mts,cts}",
      "**/*.spec.{js,jsx,mjs,ts,tsx,mts,cts}",
    ],
    rules: {
      "no-restricted-globals": [
        "error",
        {
          name: "localStorage",
          message: SAFE_STORAGE_ERROR,
        },
      ],
      "no-restricted-properties": [
        "error",
        {
          object: "window",
          property: "localStorage",
          message: SAFE_STORAGE_ERROR,
        },
        {
          object: "globalThis",
          property: "localStorage",
          message: SAFE_STORAGE_ERROR,
        },
        {
          object: "self",
          property: "localStorage",
          message: SAFE_STORAGE_ERROR,
        },
      ],
    },
  },
  {
    files: ["**/*.test.{ts,tsx,mts,cts}", "**/*.spec.{ts,tsx,mts,cts}"],
    rules: {
      "@typescript-eslint/unbound-method": "off",
    },
  },
  prettierConfig,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "test-results/**",
    "playwright-report/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
