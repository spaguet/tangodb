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

export default function BillingPage() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState<BillingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [adjusting, setAdjusting] = useState<string | null>(null);

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

  const adjustStatus = async (orgId: string, newStatus: string) => {
    setAdjusting(orgId);
    setError("");
    try {
      await invokeDevFunction("dev-console-adjust-subscription", {
        organization_id: orgId,
        status: newStatus,
        note: "Manual correction from Dev Console",
      });
      await search();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Adjust failed");
    } finally {
      setAdjusting(null);
    }
  };

  return (
    <div className="space-y-4 max-w-5xl">
      <h2 className="text-2xl font-bold text-white">Billing</h2>
      <p className="text-sm text-ink-400">
        Subscription status, lifetime grandfathering, manual corrections with audit.
      </p>

      <div className="flex flex-wrap gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name or slug"
          className="flex-1 min-w-[200px] px-3 py-2 bg-ink-900 border border-ink-800 rounded-lg text-sm"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="px-3 py-2 bg-ink-900 border border-ink-800 rounded-lg text-sm"
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
          className="px-4 py-2 bg-gold-700 hover:bg-gold-800 text-white rounded-lg text-sm font-medium cursor-pointer disabled:opacity-50"
        >
          {loading ? "Loading..." : "Search"}
        </button>
      </div>

      {error && <p className="text-sm text-garnet-400">{error}</p>}

      <div className="overflow-x-auto rounded-lg border border-ink-800">
        <table className="w-full text-sm text-left">
          <thead className="bg-ink-900 text-ink-400 uppercase text-xs">
            <tr>
              <th className="px-3 py-2">Organization</th>
              <th className="px-3 py-2">Org status</th>
              <th className="px-3 py-2">License</th>
              <th className="px-3 py-2">Subscription</th>
              <th className="px-3 py-2">Period end</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-800">
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-ink-900/70">
                <td className="px-3 py-2 text-white">{row.name}</td>
                <td className="px-3 py-2 text-ink-300">{row.status}</td>
                <td className="px-3 py-2 text-ink-300">{row.license_type ?? "—"}</td>
                <td className="px-3 py-2 text-ink-300">
                  {row.subscription?.status ?? "—"}
                  {row.subscription?.billing_period ? ` (${row.subscription.billing_period})` : ""}
                </td>
                <td className="px-3 py-2 text-ink-400 text-xs">
                  {row.subscription?.current_period_end
                    ? new Date(row.subscription.current_period_end).toLocaleDateString()
                    : "—"}
                </td>
                <td className="px-3 py-2">
                  {row.subscription && row.license_type !== "lifetime" && (
                    <div className="flex gap-1">
                      {(["active", "past_due", "canceled"] as const).map((s) => (
                        <button
                          key={s}
                          type="button"
                          disabled={adjusting === row.id || row.subscription?.status === s}
                          onClick={() => void adjustStatus(row.id, s)}
                          className="px-2 py-1 text-xs rounded bg-ink-800 hover:bg-ink-700 disabled:opacity-40 cursor-pointer"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                  {row.license_type === "lifetime" && (
                    <span className="text-xs text-sage-400">grandfathered</span>
                  )}
                </td>
              </tr>
            ))}
            {!rows.length && !loading && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-ink-500">
                  No results — run search
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
