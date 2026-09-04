/**
 * FC3 permission smoke: accountant finance read without contacts read.
 */
import { can } from "../src/lib/permissions.ts";

const opts = {};
const finance = can("accountant", "renters.finance.read", opts);
const contacts = can("accountant", "renters.contacts.read", opts);

if (!finance) {
  console.error("FAIL: accountant must have renters.finance.read");
  process.exit(1);
}
if (contacts) {
  console.error("FAIL: accountant must not have renters.contacts.read");
  process.exit(1);
}

console.log("fc3-permissions-check: OK");
