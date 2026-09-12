import { useCallback, useEffect, useState } from "react";
import { LifeBuoy, RefreshCw } from "lucide-react";
import { invokeDevFunction } from "../lib/supabase";

type SupportTicketKind = "login_help" | "forgot_password" | "license_help" | "other";
type SupportStatus = "new" | "open" | "closed";

interface SupportTicketRow {
  id: string;
  ticket_kind: SupportTicketKind;
  status: SupportStatus;
  email: string | null;
  contact_telegram: string | null;
  organization_id: string | null;
  organization_name: string | null;
  locale: string | null;
  message: string;
  page_path: string;
  close_reason: string | null;
  close_note: string | null;
  created_at: string;
  updated_at: string;
  opened_at: string | null;
  closed_at: string | null;
}

function kindLabel(kind: SupportTicketKind): string {
  if (kind === "login_help") return "Login help";
  if (kind === "forgot_password") return "Forgot password";
  if (kind === "license_help") return "License";
  return "Other";
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

interface SupportInboxPanelProps {
  highlightTicketId?: string | null;
}

export default function SupportInboxPanel({ highlightTicketId }: SupportInboxPanelProps) {
  const [status, setStatus] = useState<"new" | "open" | "closed" | "all">("new");
  const [kind, setKind] = useState<"all" | SupportTicketKind>("all");
  const [rows, setRows] = useState<SupportTicketRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [closeReason, setCloseReason] = useState<Record<string, string>>({});
  const [closeNote, setCloseNote] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await invokeDevFunction<{ tickets: SupportTicketRow[] }>(
        "dev-console-support-inbox",
        {
          action: "list",
          status: status === "all" ? undefined : status,
          kind: kind === "all" ? undefined : kind,
        }
      );
      setRows(result.tickets ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load support tickets");
    } finally {
      setLoading(false);
    }
  }, [status, kind]);

  useEffect(() => {
    void load();
  }, [load]);

  const openTicket = async (ticketId: string) => {
    setBusyId(ticketId);
    try {
      await invokeDevFunction("dev-console-support-inbox", { action: "open", ticket_id: ticketId });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Open failed");
    } finally {
      setBusyId(null);
    }
  };

  const closeTicket = async (ticketId: string) => {
    const reason = (closeReason[ticketId] ?? "").trim();
    if (!reason) {
      setError("Close reason is required");
      return;
    }
    setBusyId(ticketId);
    setError("");
    try {
      await invokeDevFunction("dev-console-support-inbox", {
        action: "close",
        ticket_id: ticketId,
        close_reason: reason,
        close_note: closeNote[ticketId]?.trim() || undefined,
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Close failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <LifeBuoy className="w-5 h-5 text-sky-300" />
            Support tickets
          </h3>
          <p className="text-sm text-slate-400">Login / forgot / license / header messages. Not purchase or org_created.</p>
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
        {(["new", "open", "closed", "all"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setStatus(value)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium cursor-pointer ${
              status === value ? "bg-sky-600 text-white" : "bg-slate-800 text-slate-400 hover:text-slate-200"
            }`}
          >
            {value}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["all", "All kinds"],
            ["login_help", "Login"],
            ["forgot_password", "Forgot pwd"],
            ["license_help", "License"],
            ["other", "Other"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setKind(value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${
              kind === value ? "bg-violet-600 text-white" : "bg-slate-800 text-slate-400 hover:text-slate-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-rose-400">{error}</p>}

      <div className="space-y-3">
        {rows.length === 0 && !loading && (
          <p className="text-sm text-slate-500">No tickets in this filter.</p>
        )}
        {rows.map((row) => {
          const highlighted = highlightTicketId === row.id;
          return (
            <article
              key={row.id}
              id={`support-ticket-${row.id}`}
              className={`rounded-xl border p-4 space-y-3 ${
                highlighted ? "border-sky-400 bg-slate-900/80" : "border-slate-800 bg-slate-900/40"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-white">
                    {kindLabel(row.ticket_kind)} · <span className="text-slate-400">{row.status}</span>
                  </p>
                  <p className="text-xs text-slate-500 font-mono">{row.id}</p>
                </div>
                <p className="text-xs text-slate-500">{formatDateTime(row.created_at)}</p>
              </div>
              <p className="text-sm text-slate-200 whitespace-pre-wrap">{row.message}</p>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-400">
                <div>
                  <dt className="text-slate-500">Email</dt>
                  <dd>{row.email ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Telegram</dt>
                  <dd>{row.contact_telegram ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Org</dt>
                  <dd>{row.organization_name ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Page</dt>
                  <dd>{row.page_path}</dd>
                </div>
              </dl>
              {row.status !== "closed" && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {row.status === "new" && (
                    <button
                      type="button"
                      disabled={busyId === row.id}
                      onClick={() => void openTicket(row.id)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-700 hover:bg-slate-600 cursor-pointer disabled:opacity-50"
                    >
                      Mark open
                    </button>
                  )}
                  <input
                    type="text"
                    placeholder="Close reason (required)"
                    value={closeReason[row.id] ?? ""}
                    onChange={(e) => setCloseReason((m) => ({ ...m, [row.id]: e.target.value }))}
                    className="flex-1 min-w-[12rem] px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs"
                  />
                  <input
                    type="text"
                    placeholder="Internal note (optional)"
                    value={closeNote[row.id] ?? ""}
                    onChange={(e) => setCloseNote((m) => ({ ...m, [row.id]: e.target.value }))}
                    className="flex-1 min-w-[12rem] px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs"
                  />
                  <button
                    type="button"
                    disabled={busyId === row.id}
                    onClick={() => void closeTicket(row.id)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-700 hover:bg-rose-600 cursor-pointer disabled:opacity-50"
                  >
                    Close
                  </button>
                </div>
              )}
              {row.status === "closed" && row.close_reason && (
                <p className="text-xs text-slate-500">
                  Closed: {row.close_reason}
                  {row.close_note ? ` — ${row.close_note}` : ""}
                </p>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
