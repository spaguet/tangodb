/**
 * resolveLessonGoogleSyncUiStatus regression (H8 / M12).
 * Run: node scripts/google-calendar-sync-status-check.mjs
 */
import assert from "node:assert/strict";

const GOOGLE_CALENDAR_SYNC_MAX_POLL_COUNT = 20;

function resolveLessonGoogleSyncUiStatus(row) {
  if (!row) return null;
  if (!row.teacher_has_binding) return "not_connected";
  if (row.has_pending_job || row.sync_status === "pending") return "pending";
  if (row.sync_status === "failed" || Boolean(row.last_error)) return "error";
  if (row.sync_status === "synced") return "synced";
  if (row.sync_status === "detached") return "detached";
  return "unknown";
}

function resolveLessonGoogleSyncUiStatusWithPollCap(row, dataUpdateCount) {
  const ui = resolveLessonGoogleSyncUiStatus(row);
  if (ui === "pending" && dataUpdateCount >= GOOGLE_CALENDAR_SYNC_MAX_POLL_COUNT) {
    return "stale";
  }
  return ui;
}

const bound = {
  teacher_has_binding: true,
  has_pending_job: false,
  sync_status: null,
  last_synced_at: null,
  last_error: null,
  calendar_name: "Work",
};

assert.equal(resolveLessonGoogleSyncUiStatus({ ...bound, sync_status: "detached" }), "detached");
assert.notEqual(resolveLessonGoogleSyncUiStatus({ ...bound, sync_status: "detached" }), "pending");

assert.equal(resolveLessonGoogleSyncUiStatus({ ...bound, sync_status: "weird" }), "unknown");
assert.notEqual(resolveLessonGoogleSyncUiStatus({ ...bound, sync_status: "weird" }), "pending");

assert.equal(resolveLessonGoogleSyncUiStatus({ ...bound, sync_status: "synced" }), "synced");
assert.equal(
  resolveLessonGoogleSyncUiStatus({ ...bound, sync_status: "pending", has_pending_job: true }),
  "pending"
);
assert.equal(
  resolveLessonGoogleSyncUiStatus({ ...bound, sync_status: "pending", has_pending_job: false }),
  "pending"
);

assert.equal(
  resolveLessonGoogleSyncUiStatusWithPollCap(
    { ...bound, sync_status: "pending", has_pending_job: true },
    20
  ),
  "stale"
);
assert.equal(
  resolveLessonGoogleSyncUiStatusWithPollCap({ ...bound, sync_status: "detached" }, 99),
  "detached"
);

console.log("google-calendar-sync-status-check: ok");
