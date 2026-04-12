import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // Relax a few rules that are too strict for this frontend:
  //  - API responses are inherently untyped JSON, so `any` is pragmatic here.
  //  - `react-force-graph-2d` has loose typings.
  //  - `let` patterns are kept for readability in some places.
  // Real type safety is still enforced by `tsc --noEmit` during build.
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "prefer-const": "warn",
    },
  },
]);

export default eslintConfig;
