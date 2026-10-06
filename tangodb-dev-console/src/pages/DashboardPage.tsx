import { useEffect, useState } from "react";
import { invokeDevFunction } from "../lib/supabase";

interface EditionMetrics {
  org_count: number;
  licensed_count: number;
  demo_active_count: number;
  demo_retention_count: number;
  suspended_count: number;
  purged_count: number;
  edition_lite: number;
  edition_studio: number;
  edition_pro: number;
  live_trial_pro: number;
  live_studio_monthly: number;
  live_pro_monthly: number;
  live_pro_lifetime: number;
  over_cap_lite: number;
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
  const [metrics, setMetrics] = useState<EditionMetrics | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    invokeDevFunction<{ metrics: EditionMetrics }>("dev-console-metrics")
      .then((r) => setMetrics(r.metrics))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }, []);

  if (error) {
    return (
      <div className="space-y-2">
        <p className="text-rose-400">{error}</p>
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

  const statusCards = [
    { label: "Organizations", value: metrics.org_count },
    { label: "Licensed", value: metrics.licensed_count },
    { label: "Suspended", value: metrics.suspended_count },
    { label: "Demo active", value: metrics.demo_active_count },
    { label: "Demo retention", value: metrics.demo_retention_count },
    { label: "Purged (total)", value: metrics.purged_count },
  ];

  const editionCards = [
    { label: "Edition Lite", value: metrics.edition_lite },
    { label: "Edition Studio", value: metrics.edition_studio },
    { label: "Edition Pro", value: metrics.edition_pro },
    { label: "Over-cap Lite", value: metrics.over_cap_lite },
  ];

  const instrumentCards = [
    { label: "Live trial Pro", value: metrics.live_trial_pro },
    { label: "Live Studio month", value: metrics.live_studio_monthly },
    { label: "Live Pro month", value: metrics.live_pro_monthly },
    { label: "Live Pro lifetime", value: metrics.live_pro_lifetime },
  ];

  const miscCards = [
    { label: "Pending keys", value: metrics.pending_keys_count },
    { label: "Active members", value: metrics.active_members_count },
    { label: "DB size (est.)", value: formatBytes(metrics.db_size_bytes_estimate) },
  ];

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Platform metrics</h2>

      <section>
        <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-2">Org status</h3>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {statusCards.map((c) => (
            <div key={c.label} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-xs uppercase tracking-wider text-slate-500">{c.label}</p>
              <p className="text-2xl font-bold text-white mt-1">{c.value}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-2">Licensed editions</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {editionCards.map((c) => (
            <div key={c.label} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-xs uppercase tracking-wider text-slate-500">{c.label}</p>
              <p className="text-2xl font-bold text-white mt-1">{c.value}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-2">Live instruments</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {instrumentCards.map((c) => (
            <div key={c.label} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-xs uppercase tracking-wider text-slate-500">{c.label}</p>
              <p className="text-2xl font-bold text-white mt-1">{c.value}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-2">Other</h3>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {miscCards.map((c) => (
            <div key={c.label} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-xs uppercase tracking-wider text-slate-500">{c.label}</p>
              <p className="text-2xl font-bold text-white mt-1">{c.value}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
