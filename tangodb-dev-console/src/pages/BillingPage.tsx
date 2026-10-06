import { useEffect, useState } from "react";
import { invokeDevFunction } from "../lib/supabase";
import type { BillingRow, ManualBillingPlan } from "../lib/devConsoleEdition";

function toDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocal(value: string): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

function formatInstruments(row: BillingRow): string {
  if (!row.live_instruments?.length) return "—";
  return row.live_instruments.map((i) => `${i.instrument} (${i.status})`).join(", ");
}

export default function BillingPage() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState<BillingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [adjusting, setAdjusting] = useState<string | null>(null);
  const [editOrgId, setEditOrgId] = useState<string | null>(null);
  const [editNote, setEditNote] = useState("");
  const [editStatus, setEditStatus] = useState("");
  const [editPeriodStart, setEditPeriodStart] = useState("");
  const [editPeriodEnd, setEditPeriodEnd] = useState("");
  const [editExtendMonth, setEditExtendMonth] = useState(false);
  const [lifecycleEnabled, setLifecycleEnabled] = useState(false);
  const [lifecycleLoading, setLifecycleLoading] = useState(true);
  const [lifecycleNote, setLifecycleNote] = useState("");
  const [lifecycleSaving, setLifecycleSaving] = useState(false);
  const [quickStatusOrg, setQuickStatusOrg] = useState<string | null>(null);
  const [quickStatusValue, setQuickStatusValue] = useState("");
  const [quickStatusNote, setQuickStatusNote] = useState("");

  const loadLifecycle = async () => {
    setLifecycleLoading(true);
    try {
      const result = await invokeDevFunction<{
        editions_lifecycle: { enabled: boolean };
      }>("dev-console-runtime-flags", { action: "get" });
      setLifecycleEnabled(result.editions_lifecycle?.enabled === true);
    } catch {
      setError("Failed to load editions lifecycle flag");
    } finally {
      setLifecycleLoading(false);
    }
  };

  useEffect(() => {
    void loadLifecycle();
  }, []);

  const search = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await invokeDevFunction<{ organizations: BillingRow[] }>(
        "dev-console-search-billing",
        { query: query || undefined, status: status || undefined, limit: 50 }
      );
      setRows(result.organizations ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setLoading(false);
    }
  };

  const openEdit = (row: BillingRow) => {
    setEditOrgId(row.id);
    setEditNote("");
    setEditStatus(row.subscription?.status ?? "active");
    setEditPeriodStart(toDatetimeLocal(row.subscription?.current_period_start));
    setEditPeriodEnd(toDatetimeLocal(row.subscription?.current_period_end));
    setEditExtendMonth(false);
  };

  const adjust = async (orgId: string, payload: Record<string, unknown>) => {
    setAdjusting(orgId);
    setError("");
    try {
      await invokeDevFunction("dev-console-adjust-subscription", payload);
      await search();
      if (editOrgId === orgId) setEditOrgId(null);
      if (quickStatusOrg === orgId) setQuickStatusOrg(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Adjust failed");
    } finally {
      setAdjusting(null);
    }
  };

  const submitEdit = async () => {
    if (!editOrgId || !editNote.trim()) {
      setError("Reason / note is required");
      return;
    }
    await adjust(editOrgId, {
      organization_id: editOrgId,
      status: editStatus || undefined,
      provider: "manual",
      period_start: fromDatetimeLocal(editPeriodStart),
      period_end: fromDatetimeLocal(editPeriodEnd),
      extend_one_month: editExtendMonth,
      note: editNote.trim(),
    });
  };

  const submitQuickStatus = async () => {
    if (!quickStatusOrg || !quickStatusNote.trim()) {
      setError("Reason / note is required for status change");
      return;
    }
    await adjust(quickStatusOrg, {
      organization_id: quickStatusOrg,
      status: quickStatusValue,
      note: quickStatusNote.trim(),
    });
  };

  const createManualSubscription = async (orgId: string, plan: ManualBillingPlan) => {
    const note = window.prompt(`Reason for manual ${plan} (required):`);
    if (!note?.trim()) return;
    await adjust(orgId, {
      organization_id: orgId,
      provider: "manual",
      status: plan === "pro_lifetime" ? undefined : "active",
      manual_plan: plan,
      note: note.trim(),
    });
  };

  const saveLifecycle = async () => {
    if (!lifecycleNote.trim()) {
      setError("Reason required to change lifecycle flag");
      return;
    }
    setLifecycleSaving(true);
    setError("");
    try {
      await invokeDevFunction("dev-console-runtime-flags", {
        action: "set",
        enabled: lifecycleEnabled,
        note: lifecycleNote.trim(),
      });
      setLifecycleNote("");
      await loadLifecycle();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Flag update failed");
    } finally {
      setLifecycleSaving(false);
    }
  };

  return (
    <div className="space-y-4 max-w-6xl">
      <h2 className="text-2xl font-bold text-white">Billing</h2>
      <p className="text-sm text-slate-400">
        Edition entitlements + subscription mirror. Adjust writes entitlements and audit log. Filter «none» =
        no live month (not edition Lite).
      </p>

      <div className="rounded-xl border border-amber-900/40 bg-amber-950/20 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-amber-200">Editions lifecycle cutover</h3>
        <p className="text-xs text-amber-100/80">
          When off, write-path stays 2.11. Do not enable on production until E1–E9 complete (§22).
        </p>
        {lifecycleLoading ? (
          <p className="text-xs text-slate-500">Loading flag…</p>
        ) : (
          <>
            <label className="flex items-center gap-2 text-sm text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={lifecycleEnabled}
                onChange={(e) => setLifecycleEnabled(e.target.checked)}
              />
              editions_lifecycle enabled
            </label>
            <label className="block text-xs text-slate-400 space-y-1">
              Reason (required to save)
              <input
                value={lifecycleNote}
                onChange={(e) => setLifecycleNote(e.target.value)}
                className="w-full max-w-md px-2 py-1.5 bg-slate-950 border border-slate-700 rounded text-sm"
              />
            </label>
            <button
              type="button"
              disabled={lifecycleSaving}
              onClick={() => void saveLifecycle()}
              className="px-3 py-2 bg-amber-800 hover:bg-amber-700 rounded-lg text-sm font-medium cursor-pointer disabled:opacity-50"
            >
              {lifecycleSaving ? "Saving…" : "Save lifecycle flag"}
            </button>
          </>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name or slug"
          className="flex-1 min-w-[200px] px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm"
        >
          <option value="">All billing</option>
          <option value="lite">Edition Lite</option>
          <option value="studio">Edition Studio</option>
          <option value="pro">Edition Pro</option>
          <option value="lifetime">Pro lifetime</option>
          <option value="active">Month active</option>
          <option value="past_due">Past due</option>
          <option value="canceled">Canceled</option>
          <option value="none">No live month</option>
          <option value="orphan_licensed">Orphan licensed (drift)</option>
        </select>
        <button
          type="button"
          onClick={() => void search()}
          disabled={loading}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-lg text-sm font-medium cursor-pointer disabled:opacity-50"
        >
          {loading ? "Loading..." : "Search"}
        </button>
      </div>

      {error && <p className="text-sm text-rose-400">{error}</p>}

      <div className="overflow-x-auto rounded-lg border border-slate-800">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-900 text-slate-400 uppercase text-xs">
            <tr>
              <th className="px-3 py-2">Organization</th>
              <th className="px-3 py-2">Org status</th>
              <th className="px-3 py-2">Edition</th>
              <th className="px-3 py-2">Ceiling</th>
              <th className="px-3 py-2">Instruments</th>
              <th className="px-3 py-2">Mirror plan</th>
              <th className="px-3 py-2">Subscription</th>
              <th className="px-3 py-2">Period</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-slate-900/50">
                <td className="px-3 py-2 text-white">
                  {row.name}
                  {row.over_cap && (
                    <span className="ml-2 text-xs text-rose-400">over-cap</span>
                  )}
                </td>
                <td className="px-3 py-2 text-slate-300">{row.status}</td>
                <td className="px-3 py-2 text-slate-300 capitalize">{row.active_edition}</td>
                <td className="px-3 py-2 text-slate-400 capitalize">{row.effective_ceiling}</td>
                <td className="px-3 py-2 text-slate-400 text-xs">{formatInstruments(row)}</td>
                <td className="px-3 py-2 text-slate-400">{row.subscription?.plan ?? "—"}</td>
                <td className="px-3 py-2 text-slate-300">
                  {row.subscription?.status ?? "—"}
                  {row.subscription?.provider ? ` (${row.subscription.provider})` : ""}
                </td>
                <td className="px-3 py-2 text-slate-400 text-xs">
                  {row.subscription?.current_period_start
                    ? new Date(row.subscription.current_period_start).toLocaleString()
                    : "—"}
                  {row.subscription?.current_period_end
                    ? ` → ${new Date(row.subscription.current_period_end).toLocaleString()}`
                    : ""}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-col gap-1">
                    <div className="flex gap-1 flex-wrap">
                      {(["active", "past_due", "canceled"] as const).map((s) => (
                        <button
                          key={s}
                          type="button"
                          disabled={adjusting === row.id || !row.subscription}
                          onClick={() => {
                            setQuickStatusOrg(row.id);
                            setQuickStatusValue(s);
                            setQuickStatusNote("");
                          }}
                          className="px-2 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 cursor-pointer"
                        >
                          {s}
                        </button>
                      ))}
                      <button
                        type="button"
                        disabled={adjusting === row.id || !row.subscription}
                        onClick={() => openEdit(row)}
                        className="px-2 py-1 text-xs rounded bg-indigo-900 hover:bg-indigo-800 cursor-pointer disabled:opacity-40"
                      >
                        Edit
                      </button>
                    </div>
                    {!row.subscription && row.license_type !== "lifetime" && (
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          disabled={adjusting === row.id}
                          onClick={() => void createManualSubscription(row.id, "studio_month")}
                          className="px-2 py-1 text-xs rounded bg-violet-900 hover:bg-violet-800 cursor-pointer disabled:opacity-40"
                        >
                          + Studio month
                        </button>
                        <button
                          type="button"
                          disabled={adjusting === row.id}
                          onClick={() => void createManualSubscription(row.id, "pro_month")}
                          className="px-2 py-1 text-xs rounded bg-emerald-900 hover:bg-emerald-800 cursor-pointer disabled:opacity-40"
                        >
                          + Pro month
                        </button>
                        <button
                          type="button"
                          disabled={adjusting === row.id}
                          onClick={() => void createManualSubscription(row.id, "pro_lifetime")}
                          className="px-2 py-1 text-xs rounded bg-emerald-950 hover:bg-emerald-900 cursor-pointer disabled:opacity-40"
                        >
                          + Pro lifetime
                        </button>
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!rows.length && !loading && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-slate-500">
                  No results — run search
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {quickStatusOrg && (
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-4 space-y-3 max-w-lg">
          <h3 className="text-sm font-semibold text-white">Change status → {quickStatusValue}</h3>
          <label className="block text-xs text-slate-400 space-y-1">
            Reason (required)
            <input
              type="text"
              value={quickStatusNote}
              onChange={(e) => setQuickStatusNote(e.target.value)}
              className="w-full px-2 py-1.5 bg-slate-950 border border-slate-700 rounded text-sm"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={adjusting === quickStatusOrg}
              onClick={() => void submitQuickStatus()}
              className="px-3 py-2 bg-indigo-600 rounded-lg text-sm font-medium cursor-pointer disabled:opacity-50"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={() => setQuickStatusOrg(null)}
              className="px-3 py-2 bg-slate-800 rounded-lg text-sm cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {editOrgId && (
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-4 space-y-3 max-w-lg">
          <h3 className="text-sm font-semibold text-white">Adjust subscription</h3>
          <label className="block text-xs text-slate-400 space-y-1">
            Status
            <select
              value={editStatus}
              onChange={(e) => setEditStatus(e.target.value)}
              className="w-full px-2 py-1.5 bg-slate-950 border border-slate-700 rounded text-sm"
            >
              <option value="active">active</option>
              <option value="past_due">past_due</option>
              <option value="canceled">canceled</option>
            </select>
          </label>
          <label className="block text-xs text-slate-400 space-y-1">
            Period start
            <input
              type="datetime-local"
              value={editPeriodStart}
              onChange={(e) => setEditPeriodStart(e.target.value)}
              className="w-full px-2 py-1.5 bg-slate-950 border border-slate-700 rounded text-sm"
            />
          </label>
          <label className="block text-xs text-slate-400 space-y-1">
            Period end
            <input
              type="datetime-local"
              value={editPeriodEnd}
              onChange={(e) => setEditPeriodEnd(e.target.value)}
              className="w-full px-2 py-1.5 bg-slate-950 border border-slate-700 rounded text-sm"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={editExtendMonth}
              onChange={(e) => setEditExtendMonth(e.target.checked)}
            />
            Extend +1 calendar month from current end
          </label>
          <label className="block text-xs text-slate-400 space-y-1">
            Reason (required)
            <input
              type="text"
              value={editNote}
              onChange={(e) => setEditNote(e.target.value)}
              className="w-full px-2 py-1.5 bg-slate-950 border border-slate-700 rounded text-sm"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={adjusting === editOrgId}
              onClick={() => void submitEdit()}
              className="px-3 py-2 bg-indigo-600 rounded-lg text-sm font-medium cursor-pointer disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setEditOrgId(null)}
              className="px-3 py-2 bg-slate-800 rounded-lg text-sm cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
