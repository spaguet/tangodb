import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, RefreshCw, Trash2, Users } from "lucide-react";
import { invokeDevFunction } from "../lib/supabase";

interface UserMembership {
  organization_id: string;
  organization_name: string;
  organization_status: string;
  role: string;
  is_active: boolean;
  display_name: string | null;
}

interface RegisteredUserRow {
  user_id: string;
  email: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed: boolean;
  is_developer: boolean;
  is_orphan: boolean;
  memberships: UserMembership[];
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function roleBadge(role: string): string {
  const map: Record<string, string> = {
    owner: "Owner",
    director: "Director",
    admin: "Admin",
    teacher: "Teacher",
    accountant: "Accountant",
    reception: "Reception",
  };
  return map[role] ?? role;
}

export default function UsersPage() {
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<RegisteredUserRow[]>([]);
  const [orphanCount, setOrphanCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [cleanupPreview, setCleanupPreview] = useState<{ count: number; users: { email: string | null }[] } | null>(
    null
  );
  const [confirmPhrase, setConfirmPhrase] = useState("");
  const [showCleanupModal, setShowCleanupModal] = useState(false);
  const [cleanupMessage, setCleanupMessage] = useState("");

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await invokeDevFunction<{ users: RegisteredUserRow[]; orphan_count: number }>(
        "dev-console-list-users",
        { query: query.trim() || undefined, limit: 300 }
      );
      setUsers(result.users ?? []);
      setOrphanCount(result.orphan_count ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const handlePreviewCleanup = async () => {
    setCleanupLoading(true);
    setCleanupMessage("");
    try {
      const result = await invokeDevFunction<{
        count: number;
        users: { email: string | null }[];
        dry_run: boolean;
      }>("dev-console-cleanup-orphan-users", { dry_run: true });
      setCleanupPreview({ count: result.count, users: result.users ?? [] });
      setShowCleanupModal(true);
      setConfirmPhrase("");
    } catch (e) {
      setCleanupMessage(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setCleanupLoading(false);
    }
  };

  const handleConfirmCleanup = async () => {
    setCleanupLoading(true);
    setCleanupMessage("");
    try {
      const result = await invokeDevFunction<{ count: number }>("dev-console-cleanup-orphan-users", {
        dry_run: false,
        confirm: "DELETE ORPHAN USERS",
      });
      setCleanupMessage(`Removed ${result.count} orphan account(s).`);
      setShowCleanupModal(false);
      setCleanupPreview(null);
      await loadUsers();
    } catch (e) {
      setCleanupMessage(e instanceof Error ? e.message : "Cleanup failed");
    } finally {
      setCleanupLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Users className="w-6 h-6 text-indigo-400" />
            Registered users
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            All auth accounts and their organization memberships. Orphans have no active org.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadUsers()}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => void handlePreviewCleanup()}
            disabled={cleanupLoading || orphanCount === 0}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-rose-950 text-rose-200 border border-rose-900 hover:bg-rose-900 disabled:opacity-50"
          >
            <Trash2 className="w-4 h-4" />
            Clean orphans ({orphanCount})
          </button>
        </div>
      </div>

      {cleanupMessage && (
        <p className="text-sm text-emerald-400 bg-emerald-950/40 border border-emerald-900 rounded-lg px-3 py-2">
          {cleanupMessage}
        </p>
      )}

      <div className="flex gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by email…"
          className="flex-1 max-w-md bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500"
        />
        <button
          type="button"
          onClick={() => void loadUsers()}
          className="px-3 py-2 rounded-lg text-sm bg-indigo-600 text-white hover:bg-indigo-500"
        >
          Search
        </button>
      </div>

      {error && <p className="text-rose-400">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-900 text-slate-400 uppercase text-xs tracking-wider">
              <tr>
                <th className="px-4 py-3 text-left">Email</th>
                <th className="px-4 py-3 text-left">Created</th>
                <th className="px-4 py-3 text-left">Last sign-in</th>
                <th className="px-4 py-3 text-left">Organizations / roles</th>
                <th className="px-4 py-3 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 bg-slate-950">
              {users.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    No users found
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr key={user.user_id} className="hover:bg-slate-900/60">
                    <td className="px-4 py-3 text-white font-medium">{user.email ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-300">{formatDate(user.created_at)}</td>
                    <td className="px-4 py-3 text-slate-300">{formatDate(user.last_sign_in_at)}</td>
                    <td className="px-4 py-3 text-slate-300">
                      {user.memberships.length === 0 ? (
                        <span className="text-slate-500">No memberships</span>
                      ) : (
                        <ul className="space-y-1">
                          {user.memberships.map((m) => (
                            <li key={`${user.user_id}-${m.organization_id}`}>
                              <span className="text-white">{m.organization_name}</span>
                              <span className="text-slate-500"> · </span>
                              <span>{roleBadge(m.role)}</span>
                              <span className="text-slate-500"> · </span>
                              <span>{m.organization_status}</span>
                              {!m.is_active && <span className="text-amber-400"> · inactive</span>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {user.is_developer ? (
                        <span className="text-indigo-300 text-xs font-semibold uppercase">Developer</span>
                      ) : user.is_orphan ? (
                        <span className="text-rose-300 text-xs font-semibold uppercase">Orphan</span>
                      ) : (
                        <span className="text-emerald-300 text-xs font-semibold uppercase">Active</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {showCleanupModal && cleanupPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-xl p-5 space-y-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-lg font-semibold text-white">Delete orphan accounts</h3>
                <p className="text-sm text-slate-400 mt-1">
                  {cleanupPreview.count} account(s) without active organization will be permanently removed,
                  including demo keys and retention records for their emails.
                </p>
              </div>
            </div>

            {cleanupPreview.users.length > 0 && (
              <ul className="max-h-40 overflow-y-auto text-sm text-slate-300 bg-slate-950 rounded-lg p-3 space-y-1">
                {cleanupPreview.users.map((u, i) => (
                  <li key={`${u.email ?? "unknown"}-${i}`}>{u.email ?? "—"}</li>
                ))}
              </ul>
            )}

            <label className="block text-sm text-slate-400">
              Type <span className="text-white font-mono">DELETE ORPHAN USERS</span> to confirm
              <input
                type="text"
                value={confirmPhrase}
                onChange={(e) => setConfirmPhrase(e.target.value)}
                className="mt-2 w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
              />
            </label>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowCleanupModal(false);
                  setCleanupPreview(null);
                }}
                className="px-3 py-2 rounded-lg text-sm text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmCleanup()}
                disabled={cleanupLoading || confirmPhrase !== "DELETE ORPHAN USERS"}
                className="px-3 py-2 rounded-lg text-sm bg-rose-600 text-white hover:bg-rose-500 disabled:opacity-50"
              >
                {cleanupLoading ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
