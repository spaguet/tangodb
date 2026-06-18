import { useState } from "react";
import { invokeDevFunction } from "../lib/supabase";

interface OrgRow {
  id: string;
  name: string;
  slug: string | null;
  status: string;
  demo_expires_at: string | null;
  created_at: string;
}

export default function OrgsPage() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const search = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await invokeDevFunction<{ organizations: OrgRow[] }>(
        "dev-console-search-orgs",
        { query: query || undefined, status: status || undefined, limit: 50 }
      );
      setOrgs(result.organizations ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <h2 className="text-2xl font-bold text-white">Organizations</h2>

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
          <option value="">All statuses</option>
          <option value="demo_active">demo_active</option>
          <option value="demo_retention">demo_retention</option>
          <option value="licensed">licensed</option>
          <option value="suspended">suspended</option>
        </select>
        <button
          type="button"
          onClick={search}
          disabled={loading}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-semibold cursor-pointer disabled:opacity-50"
        >
          {loading ? "…" : "Search"}
        </button>
      </div>

      {error && <p className="text-sm text-rose-400">{error}</p>}

      <div className="border border-slate-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-900 text-slate-500 text-left">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {orgs.map((o) => (
              <tr key={o.id} className="border-t border-slate-800">
                <td className="px-4 py-2 text-slate-200">{o.name}</td>
                <td className="px-4 py-2">
                  <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">
                    {o.status}
                  </span>
                </td>
                <td className="px-4 py-2 text-slate-500">
                  {new Date(o.created_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
            {orgs.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-slate-500">
                  Run search to load organizations
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
