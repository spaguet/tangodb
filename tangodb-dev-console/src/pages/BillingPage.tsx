import { useState } from "react";
import { invokeDevFunction } from "../lib/supabase";

interface BillingRow {
  id: string;
  name: string;
  slug: string | null;
  status: string;
  license_type: string | null;
  license_activated_at: string | null;
  subscription: {
    plan: string;
    billing_period: string;
    status: string;
    provider: string;
    current_period_start: string | null;
    current_period_end: string | null;
    provider_subscription_id: string | null;
  } | null;
}

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
  const [editProvider, setEditProvider] = useState("");
  const [editPeriodStart, setEditPeriodStart] = useState("");
  const [editPeriodEnd, setEditPeriodEnd] = useState("");
  const [editExtendMonth, setEditExtendMonth] = useState(false);

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
    setEditProvider(row.subscription?.provider ?? "manual");
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Adjust failed");
    } finally {
      setAdjusting(null);
    }
  };

  const adjustStatus = async (orgId: string, newStatus: string) => {
    await adjust(orgId, {
      organization_id: orgId,
      status: newStatus,
      note: "Quick status change from Dev Console",
    });
  };

  const submitEdit = async () => {
    if (!editOrgId || !editNote.trim()) {
      setError("Reason / note is required");
      return;
    }
    await adjust(editOrgId, {
      organization_id: editOrgId,
      status: editStatus || undefined,
      provider: editProvider || undefined,
      period_start: fromDatetimeLocal(editPeriodStart),
      period_end: fromDatetimeLocal(editPeriodEnd),
      extend_one_month: editExtendMonth,
      note: editNote.trim(),
    });
  };

  const createManualSubscription = async (orgId: string) => {
    const note = window.prompt("Reason for creating manual subscription (required):");
    if (!note?.trim()) return;
    await adjust(orgId, {
      organization_id: orgId,
      provider: "manual",
      status: "active",
      note: note.trim(),
    });
  };

  return (
    <div className="space-y-4 max-w-5xl">
      <h2 className="text-2xl font-bold text-white">Billing</h2>
      <p className="text-sm text-slate-400">
        Subscription status (manual / stripe), period dates, extend month — all audited.
      </p>

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
          <option value="lifetime">Lifetime only</option>
          <option value="active">Subscription active</option>
          <option value="past_due">Past due</option>
          <option value="canceled">Canceled</option>
          <option value="none">No subscription</option>
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
              <th className="px-3 py-2">License</th>
              <th className="px-3 py-2">Subscription</th>
              <th className="px-3 py-2">Provider</th>
              <th className="px-3 py-2">Period</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-slate-900/50">
                <td className="px-3 py-2 text-white">{row.name}</td>
                <td className="px-3 py-2 text-slate-300">{row.status}</td>
                <td className="px-3 py-2 text-slate-300">{row.license_type ?? "—"}</td>
                <td className="px-3 py-2 text-slate-300">
                  {row.subscription?.status ?? "—"}
                  {row.subscription?.billing_period ? ` (${row.subscription.billing_period})` : ""}
                </td>
                <td className="px-3 py-2 text-slate-400 text-xs">
                  {row.subscription?.provider ?? "—"}
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
                  {row.license_type === "lifetime" && (
                    <span className="text-xs text-emerald-400">grandfathered</span>
                  )}
                  {row.license_type !== "lifetime" && row.subscription && (
                    <div className="flex flex-col gap-1">
                      <div className="flex gap-1 flex-wrap">
                        {(["active", "past_due", "canceled"] as const).map((s) => (
                          <button
                            key={s}
                            type="button"
                            disabled={adjusting === row.id || row.subscription?.status === s}
                            onClick={() => void adjustStatus(row.id, s)}
                            className="px-2 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 cursor-pointer"
                          >
                            {s}
                          </button>
                        ))}
                        <button
                          type="button"
                          disabled={adjusting === row.id}
                          onClick={() => openEdit(row)}
                          className="px-2 py-1 text-xs rounded bg-indigo-900 hover:bg-indigo-800 cursor-pointer disabled:opacity-40"
                        >
                          Edit
                        </button>
                      </div>
                    </div>
                  )}
                  {row.license_type !== "lifetime" && !row.subscription && (
                    <button
                      type="button"
                      disabled={adjusting === row.id}
                      onClick={() => void createManualSubscription(row.id)}
                      className="px-2 py-1 text-xs rounded bg-emerald-900 hover:bg-emerald-800 cursor-pointer disabled:opacity-40"
                    >
                      Create manual
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!rows.length && !loading && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                  No results — run search
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

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
            Provider
            <select
              value={editProvider}
              onChange={(e) => setEditProvider(e.target.value)}
              className="w-full px-2 py-1.5 bg-slate-950 border border-slate-700 rounded text-sm"
            >
              <option value="manual">manual</option>
              <option value="stripe">stripe</option>
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
