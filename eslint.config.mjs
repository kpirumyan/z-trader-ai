import stylistic from "@stylistic/eslint-plugin";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettierConfig from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

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

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    extends: [...tseslint.configs.recommendedTypeCheckedOnly],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            "vitest.config.mts",
            ".agents/evals/*.ts",
            ".agents/evals/tests/*.ts",
          ],
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
    },
    settings: {
      "import/internal-regex": "^@/",
    },
    rules: {
      "english-code/only-english": "error",
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
        { blankLine: "any", prev: ["const", "let", "var"], next: ["const", "let", "var"] },
        { blankLine: "always", prev: "multiline-block-like", next: "*" },
        { blankLine: "always", prev: "*", next: "multiline-block-like" },
        { blankLine: "always", prev: "multiline-expression", next: "*" },
        { blankLine: "always", prev: "*", next: "multiline-expression" },
        { blankLine: "always", prev: "directive", next: "*" },
        { blankLine: "any", prev: "directive", next: "directive" },
        { blankLine: "always", prev: ["case", "default"], next: "*" },
        { blankLine: "always", prev: "import", next: "*" },
        { blankLine: "any", prev: "import", next: "import" },
        { blankLine: "always", prev: "*", next: "multiline-export" },
        { blankLine: "always", prev: "multiline-export", next: "*" },
        { blankLine: "never", prev: "singleline-export", next: "singleline-export" },
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
