import { execSync } from "node:child_process";

import { TEST_DATABASE_URL } from "./test-database-url";

// Bring the test database up to the latest migration before any test runs.
export default function setup() {
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: TEST_DATABASE_URL };
  delete env.DATABASE_URL_UNPOOLED;
  execSync("pnpm exec prisma migrate deploy", {
    env,
    stdio: "pipe",
  });
}
