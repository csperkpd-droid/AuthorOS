import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Module boundaries (docs/ARCHITECTURE.md): other code may only import a
    // module through its public index, never its internals.
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/modules/*/*"],
              message: "Import modules through their public index: '@/modules/<name>'.",
            },
          ],
        },
      ],
    },
  },
  {
    // Routes are transport only: data access goes through module services.
    files: ["src/app/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/db",
              message: "Routes and components must call module services, not the database.",
            },
          ],
          patterns: [
            {
              group: ["@/modules/*/*"],
              message: "Import modules through their public index: '@/modules/<name>'.",
            },
            {
              group: ["@/generated/prisma/*"],
              message: "Routes and components must call module services, not Prisma.",
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
    "next-env.d.ts",
    "src/generated/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
