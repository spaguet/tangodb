import { useEffect, useState } from "react";
import { Check, Copy, Inbox, KeyRound, Pause, Play, RefreshCw, Smartphone, XCircle } from "lucide-react";
import { invokeDevFunction } from "../lib/supabase";

type PurchaseRequestKind = "crm_license" | "renter_miniapp_addon";

interface PurchaseRequestRow {
  id: string;
  organization_id: string;
  organization_name: string;
  requester_email: string | null;
  contact_email: string | null;
  contact_telegram: string | null;
  payment_comment: string;
  request_kind?: PurchaseRequestKind | null;
  status: "new" | "activated" | "closed";
  email_sent: boolean;
  access_key_id: string | null;
  activated_at: string | null;
  closed_at: string | null;
  created_at: string;
  organization?: { status: string } | { status: string }[] | null;
}

type InboxStatus = "new" | "activated" | "closed" | "all";

function orgStatus(row: PurchaseRequestRow): string {
  const org = Array.isArray(row.organization) ? row.organization[0] : row.organization;
  return org?.status ?? "unknown";
}

function kindLabel(kind: PurchaseRequestKind): string {
  return kind === "renter_miniapp_addon" ? "Mini App add-on" : "CRM lifetime";
}

function rowKind(row: PurchaseRequestRow): PurchaseRequestKind {
  return row.request_kind === "renter_miniapp_addon" ? "renter_miniapp_addon" : "crm_license";
}

function defaultPeriod(): { start: string; end: string } {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  return {
    start: new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10),
    end: new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10),
  };
}

export default function PurchaseInboxPage() {
  const [status, setStatus] = useState<InboxStatus>("new");
  const [rows, setRows] = useState<PurchaseRequestRow[]>([]);
  const [generatedKeys, setGeneratedKeys] = useState<Record<string, string>>({});
  const [addonPeriods, setAddonPeriods] = useState<Record<string, { start: string; end: string }>>({});
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [addonSuccess, setAddonSuccess] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await invokeDevFunction<{ requests: PurchaseRequestRow[] }>(
        "dev-console-purchase-inbox",
        { action: "list", status }
      );
      setRows(result.requests ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load inbox");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [status]);

  const periodForRow = (row: PurchaseRequestRow) => {
    if (addonPeriods[row.id]) return addonPeriods[row.id];
    return defaultPeriod();
  };

  const activate = async (row: PurchaseRequestRow) => {
    setBusyId(row.id);
    setError("");
    try {
      const period = periodForRow(row);
      const payload =
        rowKind(row) === "renter_miniapp_addon"
          ? {
              action: "activate" as const,
              request_id: row.id,
              period_start: period.start,
              period_end: period.end,
            }
          : { action: "activate" as const, request_id: row.id };

      const result = await invokeDevFunction<{
        key?: string;
        period_start?: string;
        period_end?: string;
        request_kind?: PurchaseRequestKind;
      }>("dev-console-purchase-inbox", payload);

      if (result.key) {
        setGeneratedKeys((current) => ({ ...current, [row.id]: result.key! }));
      }
      if (rowKind(row) === "renter_miniapp_addon" && result.period_start && result.period_end) {
        setAddonSuccess((current) => ({
          ...current,
          [row.id]: `${result.period_start} — ${result.period_end}`,
        }));
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Activation failed");
    } finally {
      setBusyId(null);
    }
  };

  const close = async (row: PurchaseRequestRow) => {
    setBusyId(row.id);
    setError("");
    try {
      await invokeDevFunction("dev-console-purchase-inbox", {
        action: "close",
        request_id: row.id,
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Close failed");
    } finally {
      setBusyId(null);
    }
  };

  const addonAction = async (
    organizationId: string,
    action: "pause_addon" | "resume_addon" | "update_addon_period",
    period?: { start: string; end: string }
  ) => {
    setBusyId(organizationId);
    setError("");
    try {
      await invokeDevFunction("dev-console-purchase-inbox", {
        action,
        organization_id: organizationId,
        period_start: period?.start,
        period_end: period?.end,
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Add-on action failed");
    } finally {
      setBusyId(null);
    }
  };

  const copyKey = async (requestId: string) => {
    const key = generatedKeys[requestId];
    if (!key) return;
    await navigator.clipboard.writeText(key);
    setCopiedId(requestId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="space-y-4 max-w-6xl">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Inbox className="w-6 h-6 text-indigo-300" />
            Inbox
          </h2>
          <p className="text-sm text-slate-400">
            Заявки на оплату: lifetime CRM или ежемесячный модуль Mini App (add-on не лицензирует CRM).
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-sm font-medium cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["new", "activated", "closed", "all"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setStatus(value)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium cursor-pointer ${
              status === value ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-400 hover:text-slate-200"
            }`}
          >
            {value}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-rose-400">{error}</p>}

      <div className="space-y-3">
        {rows.map((row) => {
          const period = periodForRow(row);
          const isAddon = rowKind(row) === "renter_miniapp_addon";
          return (
            <article key={row.id} className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
                <div className="space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-white">{row.organization_name}</h3>
                    <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                      CRM: {orgStatus(row)}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded bg-violet-950/60 text-violet-300">
                      {kindLabel(rowKind(row))}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded bg-indigo-950/60 text-indigo-300">
                      {row.status}
                    </span>
                    {row.email_sent && (
                      <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300">email sent</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">
                    {new Date(row.created_at).toLocaleString()} · {row.organization_id}
                  </p>
                  <p className="text-sm text-slate-300">
                    Contact: {row.contact_email ?? row.requester_email ?? "no email"}
                    {row.contact_telegram ? ` · ${row.contact_telegram}` : ""}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {row.status === "new" && isAddon ? (
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="text-xs text-slate-400 space-y-1">
                        <span>Period start</span>
                        <input
                          type="date"
                          value={period.start}
                          onChange={(e) =>
                            setAddonPeriods((current) => ({
                              ...current,
                              [row.id]: { ...periodForRow(row), start: e.target.value },
                            }))
                          }
                          className="block bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-200"
                        />
                      </label>
                      <label className="text-xs text-slate-400 space-y-1">
                        <span>Period end</span>
                        <input
                          type="date"
                          value={period.end}
                          onChange={(e) =>
                            setAddonPeriods((current) => ({
                              ...current,
                              [row.id]: { ...periodForRow(row), end: e.target.value },
                            }))
                          }
                          className="block bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-200"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => void activate(row)}
                        disabled={busyId === row.id}
                        className="inline-flex items-center gap-1.5 px-3 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-sm font-semibold cursor-pointer disabled:opacity-50"
                      >
                        <Smartphone className="w-4 h-4" />
                        Activate add-on
                      </button>
                    </div>
                  ) : null}
                  {row.status === "new" && !isAddon ? (
                    <button
                      type="button"
                      onClick={() => void activate(row)}
                      disabled={busyId === row.id}
                      className="inline-flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-semibold cursor-pointer disabled:opacity-50"
                    >
                      <KeyRound className="w-4 h-4" />
                      Activate full access
                    </button>
                  ) : null}
                  {row.status === "new" && (
                    <button
                      type="button"
                      onClick={() => void close(row)}
                      disabled={busyId === row.id}
                      className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-sm font-medium cursor-pointer disabled:opacity-50"
                    >
                      <XCircle className="w-4 h-4" />
                      Close
                    </button>
                  )}
                </div>
              </div>

              <div className="rounded-lg bg-slate-950 border border-slate-800 px-3 py-2">
                <p className="text-xs uppercase tracking-wider font-semibold text-slate-500 mb-1">
                  Payment comment
                </p>
                <p className="text-sm text-slate-200 whitespace-pre-wrap">{row.payment_comment}</p>
              </div>

              {generatedKeys[row.id] && (
                <div className="rounded-lg bg-indigo-950/50 border border-indigo-800 px-3 py-2 space-y-2">
                  <p className="text-xs uppercase tracking-wider font-semibold text-indigo-300">
                    Generated key — copy now
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-sm font-mono text-indigo-100 break-all">
                      {generatedKeys[row.id]}
                    </code>
                    <button
                      type="button"
                      onClick={() => void copyKey(row.id)}
                      className="p-2 text-indigo-300 hover:bg-indigo-900/50 rounded cursor-pointer"
                    >
                      {copiedId === row.id ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              )}

              {addonSuccess[row.id] && (
                <div className="rounded-lg bg-violet-950/40 border border-violet-800 px-3 py-2">
                  <p className="text-xs text-violet-200">
                    Add-on active · period {addonSuccess[row.id]} (no CRM key issued)
                  </p>
                </div>
              )}

              {row.status === "activated" && isAddon ? (
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => void addonAction(row.organization_id, "pause_addon")}
                    disabled={busyId === row.organization_id}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 rounded text-xs cursor-pointer disabled:opacity-50"
                  >
                    <Pause className="w-3.5 h-3.5" />
                    Pause add-on
                  </button>
                  <button
                    type="button"
                    onClick={() => void addonAction(row.organization_id, "resume_addon")}
                    disabled={busyId === row.organization_id}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 rounded text-xs cursor-pointer disabled:opacity-50"
                  >
                    <Play className="w-3.5 h-3.5" />
                    Resume add-on
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const next = periodForRow(row);
                      void addonAction(row.organization_id, "update_addon_period", next);
                    }}
                    disabled={busyId === row.organization_id}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 rounded text-xs cursor-pointer disabled:opacity-50"
                  >
                    Update period ({period.start} — {period.end})
                  </button>
                </div>
              ) : null}
            </article>
          );
        })}

        {!rows.length && !loading && (
          <div className="text-center py-12 text-slate-500 bg-slate-900 border border-slate-800 rounded-xl">
            No purchase requests in this status.
          </div>
        )}
      </div>
    </div>
  );
}
