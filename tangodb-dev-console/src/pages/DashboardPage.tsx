import { useEffect, useState } from "react";
import { invokeDevFunction } from "../lib/supabase";

interface Metrics {
  org_count: number;
  licensed_count: number;
  demo_active_count: number;
  demo_retention_count: number;
  pending_keys_count: number;
  active_members_count: number;
  db_size_bytes_estimate: number | null;
}

function formatBytes(n: number | null): string {
  if (n == null) return "—";
  if (n < 1_000_000) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1_000_000).toFixed(1)} MB`;
}

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    invokeDevFunction<{ metrics: Metrics }>("dev-console-metrics")
      .then((r) => setMetrics(r.metrics))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }, []);

  if (error) {
    return (
      <div className="space-y-2">
        <p className="text-rose-400">{error}</p>
        {(error.includes("VITE_SUPABASE") ||
          error.includes("ALLOWED_ORIGINS") ||
          error.includes("origin_not_allowed") ||
          error.includes("Edge Function")) && (
          <p className="text-xs text-slate-500">
            Vercel → Dev Console → Settings → Environment Variables: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY.
            Supabase → Edge Functions → Secrets: ALLOWED_ORIGINS с https://tangodb-dev-console.vercel.app
          </p>
        )}
      </div>
    );
  }
  if (!metrics) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const cards = [
    { label: "Organizations", value: metrics.org_count },
    { label: "Licensed", value: metrics.licensed_count },
    { label: "Demo active", value: metrics.demo_active_count },
    { label: "Demo retention", value: metrics.demo_retention_count },
    { label: "Pending keys", value: metrics.pending_keys_count },
    { label: "Active members", value: metrics.active_members_count },
    { label: "DB size (est.)", value: formatBytes(metrics.db_size_bytes_estimate) },
  ];

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Platform metrics</h2>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <p className="text-xs uppercase tracking-wider text-slate-500">{c.label}</p>
            <p className="text-2xl font-bold text-white mt-1">{c.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
