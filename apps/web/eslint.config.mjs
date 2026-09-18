import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // eslint-config-next 16 enables React Compiler diagnostics that were not
    // part of the React 18 lint contract. Keep the existing React 18 source
    // checks while those rules are migrated with the affected components.
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      // Introduced by eslint-config-next 16; this rejects a pre-existing
      // browser-compatible CommonJS adapter in file-drafts.ts.
      "@next/next/no-assign-module-variable": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // These are generated third-party PDF assets, not application sources.
    "public/document-assets/**",
  ]),
]);

export default eslintConfig;
