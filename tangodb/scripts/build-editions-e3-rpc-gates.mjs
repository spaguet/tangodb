/**
 * Builds editions E3 RPC gate migration. Run: node scripts/build-editions-e3-rpc-gates.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "../supabase/migrations");
const outPath = path.join(migrationsDir, "20261218000004_editions_e3_rpc_gates.sql");

const migrations = fs
  .readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql") && !f.includes("editions_e3"))
  .sort();

function extractCreateOrReplace(sql, funcName) {
  const marker = `CREATE OR REPLACE FUNCTION ${funcName}(`;
  const start = sql.indexOf(marker);
  if (start < 0) return null;
  const asMatch = sql.slice(start).match(/\bAS\s+(\$[a-zA-Z_]*\$)/);
  if (!asMatch) return null;
  const dollarTag = asMatch[1];
  const bodyStart = start + asMatch.index + asMatch[0].length;
  let pos = bodyStart;
  while (pos < sql.length) {
    if (sql.startsWith(dollarTag, pos)) {
      const after = pos + dollarTag.length;
      if (sql[after] === ";") return sql.slice(start, after + 1);
    }
    pos++;
  }
  return null;
}

function latestFunction(funcName) {
  let last = null;
  let lastFile = null;
  for (const file of migrations) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    const block = extractCreateOrReplace(sql, funcName);
    if (block) {
      last = block;
      lastFile = file;
    }
  }
  return { block: last, file: lastFile };
}

function gateJsonb(cap) {
  return `  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, '${cap}') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

`;
}

function gateVoid(block, cap) {
  const declareSection = block.split(/\r?\nBEGIN\r?\n/)[0] ?? "";
  const orgId = /\bp_org_id uuid\b/.test(declareSection) ? "p_org_id" : "v_org_id";
  return `  IF editions_lifecycle_enabled() AND NOT edition_allows(${orgId}, '${cap}') THEN
    PERFORM _edition_raise('edition_forbidden');
  END IF;

`;
}

function injectGateAfterBegin(block, cap) {
  const injection = /\nRETURNS void\s*\n/.test(block) ? gateVoid(block, cap) : gateJsonb(cap);
  const m = block.match(/\r?\nBEGIN\r?\n/);
  if (!m) throw new Error("no BEGIN");
  const idx = m.index + m[0].length;
  return block.slice(0, idx) + injection + block.slice(idx);
}

/** Must declare v_org_id in DECLARE before BEGIN */
function ensureOrgIdInDeclare(block) {
  if (/v_org_id uuid := auth_organization_id\(\)/.test(block)) return block;
  return block.replace(
    /(DECLARE\s*\n)/,
    `$1  v_org_id uuid := auth_organization_id();\n`
  );
}

const JSONB_GATE_RPCS = {
  create_group_subscription: "group_subscriptions",
  create_renter: "hall_rent",
  create_rental: "hall_rent",
  create_rental_series: "hall_rent",
  record_subscription_payment: "group_subscriptions",
  record_personal_lesson_payment: "personal_lessons",
  record_single_visit: "single_visits",
  replace_subscription_partner: "group_subscriptions",
  finish_subscription_with_refund: "group_subscriptions",
  create_subscription_refund: "group_subscriptions",
  complete_subscription_refund: "group_subscriptions",
  cancel_subscription_refund: "group_subscriptions",
  apply_subscription_freeze_period: "group_subscriptions",
  cancel_subscription_freeze_period: "group_subscriptions",
  add_group_waitlist_entry: "group_subscriptions",
  update_group_waitlist_status: "group_subscriptions",
  update_personal_lesson: "personal_lessons",
  delete_personal_lesson: "personal_lessons",
  delete_personal_lesson_series_from_date: "personal_lessons",
  void_personal_lesson_payment: "personal_lessons",
  write_off_personal_lesson_debt: "finance",
  save_teacher_pay_rate: "payroll",
  save_teacher_pay_rule: "payroll",
  recalculate_teacher_settlement: "payroll",
  record_teacher_settlement_payment: "payroll",
  create_rental_invoice: "hall_rent",
  record_rental_payment: "hall_rent",
  record_rental_invoice_payment: "hall_rent",
  correct_rental_payment: "hall_rent",
  record_rental_advance: "hall_rent",
  allocate_rental_advance: "hall_rent",
  cancel_rental_advance_allocation: "hall_rent",
  record_rental_deposit_movement: "hall_rent",
  apply_rental_pricing_adjustment: "hall_rent",
  upsert_rental_tariff: "hall_rent",
  upsert_location_rental_hour_rate: "hall_rent",
  staff_renter_wallet_topup: "hall_rent",
  staff_renter_wallet_adjust: "hall_rent",
  archive_renter: "hall_rent",
  accept_venue_cost_rule_version: "hall_rent",
  save_venue_cost_rule_draft: "hall_rent",
  delete_venue_cost_rule_draft: "hall_rent",
  confirm_venue_cost_rule_gap: "hall_rent",
  create_calendar_event_with_cancellations: "calendar_events",
  update_calendar_event: "calendar_events",
  update_calendar_event_with_cancellations: "calendar_events",
  record_calendar_event_payment: "calendar_events",
  renter_create_booking: "renter_miniapp",
  renter_create_recurring_pack: "renter_miniapp",
  renter_quote_booking: "renter_miniapp",
  renter_submit_topup: "renter_miniapp",
  renter_cancel_occurrence: "renter_miniapp",
  renter_cancel_pack_from_date: "renter_miniapp",
  renter_cancel_bookings_from_date: "renter_miniapp",
  renter_delete_hold: "renter_miniapp",
  sync_offline_mark_attendance: "offline_attendance",
};

const VENUE_ACK_BLOCK = `  v_status := venue_cost_status_for_org(v_org_id, current_date);
  IF COALESCE((v_status ->> 'acknowledgement_required')::boolean, false)
    AND NOT COALESCE(p_venue_rule_acknowledged, false)
  THEN
    RETURN jsonb_build_object(
      'success', false, 'error_code', 'venue_rule_ack_required',
      'error', 'venue_rule_ack_required', 'venue_rule_status', v_status
    );
  END IF;`;

const VENUE_ACK_WRAPPED = `  IF editions_lifecycle_enabled() AND edition_allows(v_org_id, 'hall_rent') THEN
    v_status := venue_cost_status_for_org(v_org_id, current_date);
    IF COALESCE((v_status ->> 'acknowledgement_required')::boolean, false)
      AND NOT COALESCE(p_venue_rule_acknowledged, false)
    THEN
      RETURN jsonb_build_object(
        'success', false, 'error_code', 'venue_rule_ack_required',
        'error', 'venue_rule_ack_required', 'venue_rule_status', v_status
      );
    END IF;
  END IF;`;

function patchPaymentVenue(block) {
  let b = block;
  if (b.includes(VENUE_ACK_BLOCK)) b = b.replace(VENUE_ACK_BLOCK, VENUE_ACK_WRAPPED);
  b = b.replace(
    /IF v_existing_payment_id IS NULL\s+AND NOT COALESCE\(\(v_result ->> 'already_applied'\)::boolean, false\)\s+THEN\s+PERFORM store_venue_payment_ack_if_required\(/g,
    `IF v_existing_payment_id IS NULL
      AND NOT COALESCE((v_result ->> 'already_applied')::boolean, false)
      AND editions_lifecycle_enabled()
      AND edition_allows(v_org_id, 'hall_rent')
    THEN
      PERFORM store_venue_payment_ack_if_required(`
  );
  return b;
}

const parts = [
  `-- E3 / 2.12.4: edition_allows on write-RPCs (§18.9), venue-ack skip (F95), GCal enqueue no-op (F96).
-- Built by scripts/build-editions-e3-rpc-gates.mjs

BEGIN;

CREATE OR REPLACE FUNCTION _edition_require_capability(p_org_id uuid, p_capability text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF editions_lifecycle_enabled() AND NOT edition_allows(p_org_id, p_capability) THEN
    PERFORM _edition_raise('edition_forbidden');
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION _edition_require_capability(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION _edition_require_capability(uuid, text) TO service_role;

`,
];

const missing = [];
const seen = new Set();

for (const [funcName, cap] of Object.entries(JSONB_GATE_RPCS)) {
  if (seen.has(funcName)) continue;
  seen.add(funcName);
  const { block, file } = latestFunction(funcName);
  if (!block) {
    missing.push(funcName);
    continue;
  }
  try {
    let patched = ensureOrgIdInDeclare(block);
    patched = injectGateAfterBegin(patched, cap);
    if (
      funcName === "record_subscription_payment" ||
      funcName === "record_personal_lesson_payment" ||
      funcName === "record_single_visit"
    ) {
      patched = patchPaymentVenue(patched);
    }
    parts.push(`-- ${funcName} from ${file}\n${patched}\n\n`);
  } catch (e) {
    missing.push(`${funcName}: ${e.message}`);
  }
}

// restate_personal_lesson_amount — org from lesson row
{
  const { block, file } = latestFunction("restate_personal_lesson_amount");
  if (block) {
    const injection = `  SELECT organization_id INTO v_org_id FROM personal_lessons WHERE id = p_lesson_id;
  IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'personal_lessons') THEN
    RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
  END IF;

`;
    let patched = block;
    if (!/v_org_id uuid/.test(patched)) {
      if (/(DECLARE\s*\r?\n)/.test(patched)) {
        patched = patched.replace(/(DECLARE\s*\r?\n)/, `$1  v_org_id uuid;\r\n`);
      } else {
        patched = patched.replace(/AS \$\$\r?\nBEGIN\r?\n/, `AS $$\nDECLARE\n  v_org_id uuid;\nBEGIN\n`);
      }
    }
    patched = patched.replace(/\r?\nBEGIN\r?\n/, (m) => `${m}${injection}`);
    parts.push(`-- restate_personal_lesson_amount from ${file}\n${patched}\n\n`);
  } else missing.push("restate_personal_lesson_amount");
}

// enqueue_calendar_sync
{
  const { block, file } = latestFunction("enqueue_calendar_sync");
  if (block) {
    const injection = `  IF editions_lifecycle_enabled() AND NOT edition_allows(p_organization_id, 'google_calendar') THEN
    RETURN;
  END IF;

`;
    const patched = block.replace(/\r?\nBEGIN\r?\n/, (m) => `${m}${injection}`);
    parts.push(`-- enqueue_calendar_sync from ${file}\n${patched}\n\n`);
  } else missing.push("enqueue_calendar_sync");
}

// upsert_renter INSERT gate
{
  const { block, file } = latestFunction("upsert_renter");
  if (block) {
    const injection = `    IF editions_lifecycle_enabled() AND NOT edition_allows(v_org_id, 'hall_rent') THEN
      RETURN jsonb_build_object('success', false, 'error', 'edition_forbidden', 'error_code', 'edition_forbidden');
    END IF;

`;
    const patched = block.replace(
      /IF v_id IS NULL THEN\s*\n\s*IF v_duplicate_reason IS NULL/,
      `IF v_id IS NULL THEN\n${injection}    IF v_duplicate_reason IS NULL`
    );
    parts.push(`-- upsert_renter from ${file}\n${patched}\n\n`);
  }
}

// close_group / close_personal venue skip
for (const fn of ["close_group_lesson_occurrence", "close_personal_lesson_occurrence"]) {
  const { block, file } = latestFunction(fn);
  if (!block) continue;
  let patched = block;
  if (patched.includes("post_venue_cost_for_closure")) {
    patched = patched.replace(
      /v_result := post_venue_cost_for_closure\(v_closure_id, v_member_id\);/,
      `IF editions_lifecycle_enabled() AND edition_allows(v_org_id, 'hall_rent') THEN
    v_result := post_venue_cost_for_closure(v_closure_id, v_member_id);
  ELSE
    v_result := jsonb_build_object('success', true, 'closure_id', v_closure_id);
  END IF;`
    );
  }
  if (patched.includes("post_venue_cost_for_personal_closure")) {
    patched = patched.replace(
      /v_result := post_venue_cost_for_personal_closure\(v_closure_id, v_member_id\);/,
      `IF editions_lifecycle_enabled() AND edition_allows(v_org_id, 'hall_rent') THEN
    v_result := post_venue_cost_for_personal_closure(v_closure_id, v_member_id);
  ELSE
    v_result := jsonb_build_object('success', true, 'closure_id', v_closure_id);
  END IF;`
    );
  }
  parts.push(`-- ${fn} from ${file}\n${patched}\n\n`);
}

// can_export_data / can_export_financial
{
  const { block: dataBlock, file: dataFile } = latestFunction("can_export_data");
  if (dataBlock) {
    const patched = dataBlock.replace(
      /AS \$\$\s*\n\s*SELECT\s+/,
      `AS $$
  SELECT (
    `
    ).replace(
      /;\s*\$\$;/,
      `
  )
  AND (
    NOT editions_lifecycle_enabled()
    OR edition_allows(auth_organization_id(), 'export_operational')
  );
$$;`
    );
    parts.push(`-- can_export_data from ${dataFile}\n${patched}\n\n`);
  }
  const { block: finBlock, file: finFile } = latestFunction("can_export_financial");
  if (finBlock) {
    const patched = finBlock.replace(
      /SELECT current_member_role\(\) IN \('owner', 'director', 'accountant'\);/,
      `SELECT
    current_member_role() IN ('owner', 'director', 'accountant')
    AND (
      NOT editions_lifecycle_enabled()
      OR edition_allows(auth_organization_id(), 'export_financial')
    );`
    );
    parts.push(`-- can_export_financial from ${finFile}\n${patched}\n\n`);
  }
}

parts.push("COMMIT;\n");

fs.writeFileSync(outPath, parts.join("\n"), "utf8");
console.log(`Wrote ${outPath} (${parts.length} sections)`);
if (missing.length) console.log("Missing:", missing.join(", "));
