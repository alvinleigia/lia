import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

config({ path: ".env.local" });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required.");
}

const globalForDatabase = globalThis as unknown as {
  liaQueryClient?: ReturnType<typeof postgres>;
};
const queryClient =
  globalForDatabase.liaQueryClient ??
  postgres(databaseUrl, {
    connect_timeout: 10,
    idle_timeout: 20,
    max: 5,
    prepare: false,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDatabase.liaQueryClient = queryClient;
}

export const db = drizzle(queryClient);
