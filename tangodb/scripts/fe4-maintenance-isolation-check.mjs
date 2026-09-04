/**
 * FE4: apply migration + SQL regression for maintenance batch isolation.
 */
import { execSync } from "node:child_process";
import { loadDbTestEnv } from "./load-db-test-env.mjs";

loadDbTestEnv();

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("DATABASE_URL is not set (.env.local / .env.migrate)");
  process.exit(1);
}

const q = (s) => `"${s.replace(/"/g, '""')}"`;

execSync(
  `psql ${q(dbUrl)} -v ON_ERROR_STOP=1 -f supabase/migrations/20261078000001_renter_miniapp_fe4_maintenance_isolation.sql`,
  {
    stdio: "inherit",
    shell: true,
  }
);

execSync(
  `psql ${q(dbUrl)} -v ON_ERROR_STOP=1 -f supabase/tests/_hall_rent_test_jwt.sql -f supabase/tests/renter_miniapp_fe4_maintenance_isolation_test.sql`,
  {
    stdio: "inherit",
    shell: true,
  }
);

console.log("fe4-maintenance-isolation-check: OK");
