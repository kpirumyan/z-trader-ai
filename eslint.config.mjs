import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import reactHooks from "eslint-plugin-react-hooks";
import reactCompiler from "eslint-plugin-react-compiler";
import stylistic from "@stylistic/eslint-plugin";
import prettierConfig from "eslint-config-prettier";
import boundaries from "eslint-plugin-boundaries";

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
              if (/[\u0400-\u04FF]/.test(comment.value)) {
                context.report({
                  loc: comment.loc,
                  message:
                    "In-code comments must be strictly in English. Cyrillic characters are forbidden.",
                });
              }
            }
          },
          Identifier(node) {
            if (/[\u0400-\u04FF]/.test(node.name)) {
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

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  reactCompiler.configs.recommended,
  {
    files: ["**/*.{js,jsx,mjs,ts,tsx,mts,cts}"],
    plugins: {
      "@stylistic": stylistic,
      "english-code": englishCodePlugin,
      boundaries,
    },
    settings: {
      "boundaries/include": ["src/**/*", "app/**/*"],
      "boundaries/elements": [
        {
          type: "app",
          pattern: "app/**",
        },
        {
          type: "composition",
          pattern: "src/composition/**",
        },
        {
          type: "shared",
          pattern: "src/shared/**",
        },
        {
          type: "module",
          pattern: "src/modules/*",
          capture: ["moduleName"],
        },
      ],
    },
    rules: {
      "english-code/only-english": "error",
      ...reactHooks.configs.flat["recommended-latest"].rules,
      "@stylistic/padding-line-between-statements": [
        "error",
        { blankLine: "always", prev: "*", next: "return" },
        { blankLine: "always", prev: "*", next: ["const", "let", "var"] },
        { blankLine: "always", prev: ["const", "let", "var"], next: "*" },
        { blankLine: "any", prev: ["const", "let", "var"], next: ["const", "let", "var"] },
        { blankLine: "always", prev: "multiline-block-like", next: "*" },
        { blankLine: "always", prev: "*", next: "multiline-block-like" },
        { blankLine: "always", prev: "multiline-expression", next: "*" },
        { blankLine: "always", prev: "*", next: "multiline-expression" },
        { blankLine: "always", prev: "directive", next: "*" },
        { blankLine: "any", prev: "directive", next: "directive" },
        { blankLine: "always", prev: ["case", "default"], next: "*" },
      ],
      "boundaries/dependencies": [
        "error",
        {
          default: "disallow",
          policies: [
            // app (legacy) can import composition, modules, shared, and itself during transition
            {
              from: { element: { type: "app" } },
              allow: {
                to: {
                  element: { types: { anyOf: ["app", "composition", "module", "shared"] } },
                },
              },
            },
            // composition root can import modules and shared
            {
              from: { element: { type: "composition" } },
              allow: {
                to: {
                  element: { types: { anyOf: ["composition", "module", "shared"] } },
                },
              },
            },
            // modules can import other modules and shared, but NEVER app or composition
            {
              from: { element: { type: "module" } },
              allow: {
                to: {
                  element: { types: { anyOf: ["module", "shared"] } },
                },
              },
            },
            // shared cannot import modules, composition, or app
            {
              from: { element: { type: "shared" } },
              allow: {
                to: {
                  element: { type: "shared" },
                },
              },
            },
          ],
        },
      ],
    },
  },
  {
    files: ["app/types/**/*.{ts,tsx}", "src/**/types.ts", "src/**/types/**/*.{ts,tsx}"],
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
    files: ["src/modules/*/index.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "FunctionDeclaration",
          message:
            "Do not declare functions in module index.ts. Re-export from implementation files.",
        },
        {
          selector: "VariableDeclaration",
          message:
            "Do not declare variables in module index.ts. Re-export from implementation files.",
        },
        {
          selector: "ClassDeclaration",
          message:
            "Do not declare classes in module index.ts. Re-export from implementation files.",
        },
        {
          selector: "ExportDefaultDeclaration",
          message:
            "Do not use default export in module index.ts. Export named public contract symbols.",
        },
      ],
    },
  },
  {
    files: ["app/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/tests/*", "**/tests/*"],
              message: "Production code in app/ must not import from tests/.",
            },
            {
              group: ["@/src/modules/*/*", "**/src/modules/*/*"],
              message:
                "Deep imports into modules are forbidden. Import only from public entry point '@/src/modules/<name>'.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/app/**", "**/app/**", "../app/**", "../../app/**", "../../../app/**"],
              message: "Quarantine violation: code in src/ must not import legacy code from app/.",
            },
            {
              group: ["@/tests/*", "**/tests/*"],
              message: "Production code in src/ must not import from tests/.",
            },
            {
              group: ["@/src/modules/*/*", "**/src/modules/*/*"],
              message:
                "Deep imports into modules are forbidden. Import only from public entry point '@/src/modules/<name>'.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/modules/*/tests/**/*.{ts,tsx}", "tests/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/src/modules/*/*",
                "../model/**",
                "../ui/**",
                "../constants",
                "../constants.ts",
                "../schema",
                "../schema.ts",
                "../../model/**",
                "../../ui/**",
              ],
              message:
                "Tests must import only from public module contract ('@/src/modules/<name>' or '../index'). Internal implementation imports are forbidden.",
            },
          ],
        },
      ],
    },
  },
  prettierConfig,
  globalIgnores([
    ".next/**",
    ".agents/**",
    ".codex/**",
    "out/**",
    "build/**",
    "coverage/**",
    "test-results/**",
    "playwright-report/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
