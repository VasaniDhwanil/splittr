import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // New in eslint-config-next 16.4 (React Compiler rules). Existing code
    // trips them in patterns that work today (hydrating from localStorage
    // in effects, random confetti offsets); surface as warnings to fix
    // incrementally instead of blocking lint.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
    },
  },
  {
    // Playwright fixtures use `use` callbacks that the hooks rule mistakes
    // for React's use().
    files: ["e2e/**"],
    rules: { "react-hooks/rules-of-hooks": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Separate Remotion project with its own toolchain
    "video/**",
    // Installed agent skills, not app code
    ".agents/**",
  ]),
]);

export default eslintConfig;
