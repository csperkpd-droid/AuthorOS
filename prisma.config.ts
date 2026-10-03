import "dotenv/config";
import { defineConfig } from "prisma/config";

// The CLI (migrations) needs a direct connection. On Vercel + Neon,
// DATABASE_URL is the pooled URL and DATABASE_URL_UNPOOLED is the direct one.
// Locally both point at the same database, so the fallback is fine.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || "",
  },
});
