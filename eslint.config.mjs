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
  // Baseline overrides for release — new code should still aim for strictness.
  {
    rules: {
      // Legacy `any` usage tracked as warnings, not build-breaking errors.
      // Remove this override when legacy types are cleaned up.
      "@typescript-eslint/no-explicit-any": "warn",
      // setState-in-effect: several patterns (URL-state sync, localStorage init,
      // data-fetching on mount) trigger this. Downgrade to warning for now.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
