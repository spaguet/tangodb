import { useCallback, useEffect, useState } from "react";
import { invokeDevFunction } from "../lib/supabase";

type Period = "7d" | "30d" | "365d";

interface LandingAnalytics {
  period: Period;
  pageviews: number;
  unique_visitors: number;
  new_demo_orgs: number;
  demo_active_new_in_period: number;
  counts_by_event: Record<string, number>;
  top_referrers: { referrer: string; pageviews: number }[];
  daily: { date: string; pageviews: number; cta_register: number }[];
  funnel: {
    unique_visitors: number;
    register_clicks: number;
    new_demo_orgs: number;
    register_ctr: number | null;
    trial_start_conversion: number | null;
  };
  rates: {
    register_ctr: number | null;
    trial_start_conversion: number | null;
    demo_distraction_ratio: number | null;
    telegram_intent_rate: number | null;
    login_confusion_rate: number | null;
  };
}

const PERIODS: { id: Period; label: string }[] = [
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "365d", label: "365 days" },
];

const CLICK_EVENTS = [
  { key: "cta_register", label: "Register" },
  { key: "cta_demo", label: "Demo" },
  { key: "cta_telegram", label: "Telegram" },
  { key: "cta_login", label: "Login" },
  { key: "scroll_pricing", label: "Scroll pricing" },
  { key: "scroll_faq", label: "Scroll FAQ" },
] as const;

function formatRate(value: number | null): string {
  if (value == null) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

function formatRatio(value: number | null): string {
  if (value == null) return "—";
  return value.toFixed(2);
}

function envHint(error: string): boolean {
  return (
    error.includes("VITE_SUPABASE") ||
    error.includes("ALLOWED_ORIGINS") ||
    error.includes("origin_not_allowed") ||
    error.includes("Edge Function")
  );
}

export default function LandingAnalyticsPage() {
  const [period, setPeriod] = useState<Period>("30d");
  const [analytics, setAnalytics] = useState<LandingAnalytics | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (nextPeriod: Period) => {
    setLoading(true);
    setError("");
    try {
      const result = await invokeDevFunction<{ analytics: LandingAnalytics }>(
        "dev-console-landing-analytics",
        { period: nextPeriod },
      );
      setAnalytics(result.analytics);
    } catch (e) {
      setAnalytics(null);
      setError(e instanceof Error ? e.message : "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(period);
  }, [load, period]);

  if (error) {
    return (
      <div className="space-y-2">
        <p className="text-rose-400">{error}</p>
        {envHint(error) && (
          <p className="text-xs text-slate-500">
            Vercel → Dev Console → Settings → Environment Variables: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY.
            Supabase → Edge Functions → Secrets: ALLOWED_ORIGINS с https://tangodb-dev-console.vercel.app
          </p>
        )}
      </div>
    );
  }

  const maxClickCount = Math.max(
    1,
    ...CLICK_EVENTS.map((item) => analytics?.counts_by_event[item.key] ?? 0),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white">Landing analytics</h2>
          <p className="mt-1 text-sm text-slate-500">
            Traffic and CTA clicks from tangodb-landing (aggregate, not per-user).
          </p>
        </div>
        <div className="flex rounded-lg border border-slate-800 bg-slate-900 p-1">
          {PERIODS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setPeriod(item.id)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                period === item.id
                  ? "bg-indigo-600/30 text-indigo-200"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {loading || !analytics ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-white">Landing funnel</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Attribution is aggregate, not per-user. Register clicks and new demo orgs are not linked at visitor level.
                </p>
              </div>
              <p className="text-xs text-slate-500">
                New demo orgs: created in period with status demo_active, demo_retention, or licensed.
              </p>
            </div>
            <div className="mt-4 grid grid-cols-2 lg:grid-cols-5 gap-4">
              <div>
                <p className="text-xs uppercase tracking-wider text-slate-500">Unique visitors</p>
                <p className="text-2xl font-bold text-white mt-1">{analytics.funnel.unique_visitors}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-slate-500">Register clicks</p>
                <p className="text-2xl font-bold text-white mt-1">{analytics.funnel.register_clicks}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-slate-500">New demo orgs</p>
                <p className="text-2xl font-bold text-white mt-1">{analytics.funnel.new_demo_orgs}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {analytics.demo_active_new_in_period} still demo_active
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-slate-500">Register CTR</p>
                <p className="text-2xl font-bold text-white mt-1">{formatRate(analytics.funnel.register_ctr)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-slate-500">Trial start conversion</p>
                <p className="text-2xl font-bold text-white mt-1">
                  {formatRate(analytics.funnel.trial_start_conversion)}
                </p>
                <p className="mt-1 text-xs text-slate-500">new demo orgs ÷ register clicks</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-xs uppercase tracking-wider text-slate-500">Pageviews</p>
              <p className="text-2xl font-bold text-white mt-1">{analytics.pageviews}</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-xs uppercase tracking-wider text-slate-500">Demo distraction</p>
              <p className="text-2xl font-bold text-white mt-1">
                {formatRatio(analytics.rates.demo_distraction_ratio)}
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-xs uppercase tracking-wider text-slate-500">Telegram intent</p>
              <p className="text-2xl font-bold text-white mt-1">
                {formatRate(analytics.rates.telegram_intent_rate)}
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-xs uppercase tracking-wider text-slate-500">Login confusion</p>
              <p className="text-2xl font-bold text-white mt-1">
                {formatRate(analytics.rates.login_confusion_rate)}
              </p>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-white">Clicks (selected period)</h3>
              <ul className="mt-4 space-y-3">
                {CLICK_EVENTS.map((item) => {
                  const count = analytics.counts_by_event[item.key] ?? 0;
                  const width = `${Math.max(4, (count / maxClickCount) * 100)}%`;
                  return (
                    <li key={item.key}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-400">{item.label}</span>
                        <span className="font-medium text-white">{count}</span>
                      </div>
                      <div className="mt-1 h-2 rounded-full bg-slate-800">
                        <div className="h-2 rounded-full bg-indigo-500/70" style={{ width }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-white">Derived rates</h3>
              <dl className="mt-4 space-y-3 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-400">Register CTR</dt>
                  <dd className="text-white font-medium">{formatRate(analytics.rates.register_ctr)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-400">Trial start conversion</dt>
                  <dd className="text-white font-medium">{formatRate(analytics.rates.trial_start_conversion)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-400">Demo distraction ratio</dt>
                  <dd className="text-white font-medium">{formatRatio(analytics.rates.demo_distraction_ratio)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-400">Telegram intent rate</dt>
                  <dd className="text-white font-medium">{formatRate(analytics.rates.telegram_intent_rate)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-400">Login confusion rate</dt>
                  <dd className="text-white font-medium">{formatRate(analytics.rates.login_confusion_rate)}</dd>
                </div>
              </dl>
              <p className="mt-4 text-xs text-slate-500">
                History only since landing tracker deployment. 365-day view may be partial early on.
              </p>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 overflow-x-auto">
              <h3 className="text-sm font-semibold text-white">Top referrers</h3>
              {analytics.top_referrers.length === 0 ? (
                <p className="mt-4 text-sm text-slate-500">No referrer data yet.</p>
              ) : (
                <table className="mt-4 w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-500">
                      <th className="pb-2 font-medium">Referrer</th>
                      <th className="pb-2 font-medium text-right">Pageviews</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.top_referrers.map((row) => (
                      <tr key={row.referrer} className="border-t border-slate-800">
                        <td className="py-2 pr-4 text-slate-300 break-all">{row.referrer}</td>
                        <td className="py-2 text-right text-white">{row.pageviews}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 overflow-x-auto">
              <h3 className="text-sm font-semibold text-white">Daily pageviews & register clicks</h3>
              {analytics.daily.length === 0 ? (
                <p className="mt-4 text-sm text-slate-500">No daily data yet.</p>
              ) : (
                <table className="mt-4 w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-500">
                      <th className="pb-2 font-medium">Date</th>
                      <th className="pb-2 font-medium text-right">Pageviews</th>
                      <th className="pb-2 font-medium text-right">Register</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.daily.map((row) => (
                      <tr key={row.date} className="border-t border-slate-800">
                        <td className="py-2 text-slate-300">{row.date}</td>
                        <td className="py-2 text-right text-white">{row.pageviews}</td>
                        <td className="py-2 text-right text-white">{row.cta_register}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
