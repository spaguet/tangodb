import { useEffect, useState } from "react";
import { invokeDevFunction } from "../lib/supabase";

interface ErrorRow {
  id: string;
  action: string;
  target_type: string;
  target_id: string | null;
  actor_user_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

function formatMetadata(metadata: Record<string, unknown>): string {
  return JSON.stringify(metadata, null, 2);
}

export default function ErrorsPage() {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<ErrorRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const search = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await invokeDevFunction<{ errors: ErrorRow[] }>(
        "dev-console-list-errors",
        { query: query || undefined, limit: 50 }
      );
      setRows(result.errors ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void search();
    // Load latest errors once on page entry; filtering stays explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4 max-w-6xl">
      <div>
        <h2 className="text-2xl font-bold text-white">Errors</h2>
        <p className="text-sm text-slate-400">
          Recent platform diagnostics from Edge Functions and activation flow.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search action, type, code, message"
          className="flex-1 min-w-[240px] px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm"
        />
        <button
          type="button"
          onClick={() => void search()}
          disabled={loading}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-semibold cursor-pointer disabled:opacity-50"
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {error && <p className="text-sm text-rose-400">{error}</p>}

      <div className="overflow-x-auto rounded-lg border border-slate-800">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-900 text-slate-400 uppercase text-xs">
            <tr>
              <th className="px-3 py-2">Time</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Target</th>
              <th className="px-3 py-2">Metadata</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {rows.map((row) => (
              <tr key={row.id} className="align-top hover:bg-slate-900/50">
                <td className="px-3 py-2 text-slate-500 whitespace-nowrap">
                  {new Date(row.created_at).toLocaleString()}
                </td>
                <td className="px-3 py-2">
                  <span className="text-xs px-2 py-0.5 rounded-full bg-rose-950 text-rose-300">
                    {row.action}
                  </span>
                </td>
                <td className="px-3 py-2 text-slate-400">
                  <div>{row.target_type}</div>
                  <div className="text-xs text-slate-600">{row.target_id ?? "—"}</div>
                </td>
                <td className="px-3 py-2">
                  <pre className="max-w-xl whitespace-pre-wrap break-words text-xs text-slate-300 bg-slate-950 border border-slate-800 rounded-lg p-2">
                    {formatMetadata(row.metadata)}
                  </pre>
                </td>
              </tr>
            ))}
            {!rows.length && !loading && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                  No errors found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
