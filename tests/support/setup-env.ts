import { TEST_DATABASE_URL } from "./test-database-url";

// Runs before each test file imports anything, so `lib/db` connects to the
// test database and never the development one.
process.env.DATABASE_URL = TEST_DATABASE_URL;
