import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import reactHooks from "eslint-plugin-react-hooks";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["**/*.{js,jsx,mjs,ts,tsx,mts,cts}"],
    rules: reactHooks.configs.flat["recommended-latest"].rules,
  },
  {
    files: ["app/types/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "ExportNamedDeclaration > VariableDeclaration",
          message: "Do not export runtime variables/constants from app/types/. Place constants in app/constants/.",
        },
        {
          selector: "ExportNamedDeclaration > FunctionDeclaration",
          message: "Do not export runtime functions from app/types/. Place functions in appropriate utility or domain files.",
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
