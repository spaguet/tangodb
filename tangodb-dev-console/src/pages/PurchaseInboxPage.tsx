import { useEffect, useState } from "react";
import { Check, Copy, Inbox, KeyRound, RefreshCw, XCircle } from "lucide-react";
import { invokeDevFunction } from "../lib/supabase";

interface PurchaseRequestRow {
  id: string;
  organization_id: string;
  organization_name: string;
  requester_email: string | null;
  contact_email: string | null;
  contact_telegram: string | null;
  payment_comment: string;
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

export default function PurchaseInboxPage() {
  const [status, setStatus] = useState<InboxStatus>("new");
  const [rows, setRows] = useState<PurchaseRequestRow[]>([]);
  const [generatedKeys, setGeneratedKeys] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

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

  const activate = async (row: PurchaseRequestRow) => {
    setBusyId(row.id);
    setError("");
    try {
      const result = await invokeDevFunction<{ key: string }>("dev-console-purchase-inbox", {
        action: "activate",
        request_id: row.id,
      });
      setGeneratedKeys((current) => ({ ...current, [row.id]: result.key }));
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
            <Inbox className="w-6 h-6 text-gold-300" />
            Inbox
          </h2>
          <p className="text-sm text-ink-400">
            Входящие заявки из CRM на проверку ручной оплаты и активацию lifetime-доступа.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-2 px-3 py-2 bg-ink-800 hover:bg-ink-700 rounded-lg text-sm font-medium cursor-pointer disabled:opacity-50"
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
              status === value ? "bg-gold-700 text-white" : "bg-ink-800 text-ink-400 hover:text-ink-200"
            }`}
          >
            {value}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-garnet-400">{error}</p>}

      <div className="space-y-3">
        {rows.map((row) => (
          <article key={row.id} className="bg-ink-900 border border-ink-800 rounded-xl p-4 space-y-3">
            <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
              <div className="space-y-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-semibold text-white">{row.organization_name}</h3>
                  <span className="text-xs px-2 py-0.5 rounded bg-ink-800 text-ink-300">
                    CRM: {orgStatus(row)}
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded bg-gold-900/70 text-gold-300">
                    {row.status}
                  </span>
                  {row.email_sent && (
                    <span className="text-xs px-2 py-0.5 rounded bg-ink-800 text-ink-300">email sent</span>
                  )}
                </div>
                <p className="text-xs text-ink-500">
                  {new Date(row.created_at).toLocaleString()} · {row.organization_id}
                </p>
                <p className="text-sm text-ink-300">
                  Contact: {row.contact_email ?? row.requester_email ?? "no email"}
                  {row.contact_telegram ? ` · ${row.contact_telegram}` : ""}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {row.status === "new" && (
                  <button
                    type="button"
                    onClick={() => void activate(row)}
                    disabled={busyId === row.id}
                    className="inline-flex items-center gap-1.5 px-3 py-2 bg-gold-700 hover:bg-gold-800 rounded-lg text-sm font-semibold cursor-pointer disabled:opacity-50"
                  >
                    <KeyRound className="w-4 h-4" />
                    Activate full access
                  </button>
                )}
                {row.status === "new" && (
                  <button
                    type="button"
                    onClick={() => void close(row)}
                    disabled={busyId === row.id}
                    className="inline-flex items-center gap-1.5 px-3 py-2 bg-ink-800 hover:bg-ink-700 rounded-lg text-sm font-medium cursor-pointer disabled:opacity-50"
                  >
                    <XCircle className="w-4 h-4" />
                    Close
                  </button>
                )}
              </div>
            </div>

            <div className="rounded-lg bg-ink-950 border border-ink-800 px-3 py-2">
              <p className="text-xs uppercase tracking-wider font-semibold text-ink-500 mb-1">
                Payment comment
              </p>
              <p className="text-sm text-ink-200 whitespace-pre-wrap">{row.payment_comment}</p>
            </div>

            {generatedKeys[row.id] && (
              <div className="rounded-lg bg-gold-900/40 border border-gold-800 px-3 py-2 space-y-2">
                <p className="text-xs uppercase tracking-wider font-semibold text-gold-300">
                  Generated key — copy now
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-sm font-mono text-gold-100 break-all">
                    {generatedKeys[row.id]}
                  </code>
                  <button
                    type="button"
                    onClick={() => void copyKey(row.id)}
                    className="p-2 text-gold-300 hover:bg-gold-900/70 rounded cursor-pointer"
                  >
                    {copiedId === row.id ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            )}
          </article>
        ))}

        {!rows.length && !loading && (
          <div className="text-center py-12 text-ink-500 bg-ink-900 border border-ink-800 rounded-xl">
            No purchase requests in this status.
          </div>
        )}
      </div>
    </div>
  );
}
