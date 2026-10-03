import "dotenv/config";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://authoros:authoros@localhost:5432/authoros_test";
