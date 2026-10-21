import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import reactHooks from "eslint-plugin-react-hooks";
import reactCompiler from "eslint-plugin-react-compiler";
import stylistic from "@stylistic/eslint-plugin";
import prettierConfig from "eslint-config-prettier";

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
    },
  },
  {
    files: ["app/types/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "ExportNamedDeclaration > VariableDeclaration",
          message:
            "Do not export runtime variables/constants from app/types/. Place constants in app/constants/.",
        },
        {
          selector: "ExportNamedDeclaration > FunctionDeclaration",
          message:
            "Do not export runtime functions from app/types/. Place functions in appropriate utility or domain files.",
        },
        {
          selector: "ExportDefaultDeclaration",
          message: "Do not use default export in app/types/. Export explicit types.",
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
