import { useCallback, useEffect, useState } from "react";
import { invokeDevFunction } from "../lib/supabase";

interface CrmVersion {
  id: string;
  code: string;
  name: string;
  schema_version: number;
  app_url: string;
  is_current: boolean;
}

interface OrgOption {
  id: string;
  name: string;
  status: string;
  crm_version_code: string | null;
  schema_version_locked: boolean;
}

interface MigrationRow {
  id: string;
  organization_id: string;
  status: string;
  dry_run: boolean;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
  metadata: {
    from_code?: string;
    to_code?: string;
    dry_run_result?: unknown;
    script_result?: unknown;
  };
}

export default function MigrationsPage() {
  const [versions, setVersions] = useState<CrmVersion[]>([]);
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [migrations, setMigrations] = useState<MigrationRow[]>([]);
  const [orgId, setOrgId] = useState("");
  const [targetVersionId, setTargetVersionId] = useState("");
  const [dryRun, setDryRun] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<unknown>(null);

  const loadVersions = useCallback(async () => {
    const data = await invokeDevFunction<{ versions: CrmVersion[] }>("dev-console-list-versions");
    setVersions(data.versions ?? []);
  }, []);

  const loadOrgs = useCallback(async () => {
    const data = await invokeDevFunction<{ organizations: OrgOption[] }>("dev-console-search-orgs", {
      limit: 100,
    });
    setOrgs(data.organizations ?? []);
  }, []);

  const loadMigrations = useCallback(async () => {
    const data = await invokeDevFunction<{ migrations: MigrationRow[] }>(
      "dev-console-list-migrations",
      { organization_id: orgId || undefined, limit: 30 }
    );
    setMigrations(data.migrations ?? []);
  }, [orgId]);

  useEffect(() => {
    loadVersions().catch(() => setError("Failed to load CRM versions"));
    loadOrgs().catch(() => {});
    loadMigrations().catch(() => {});
  }, [loadVersions, loadOrgs, loadMigrations]);

  const runMigration = async () => {
    if (!orgId || !targetVersionId) {
      setError("Select organization and target version");
      return;
    }
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const data = await invokeDevFunction<{ result: unknown }>("dev-console-trigger-migration", {
        organization_id: orgId,
        target_version_id: targetVersionId,
        dry_run: dryRun,
      });
      setResult(data.result);
      await loadMigrations();
      await loadOrgs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Migration failed");
    } finally {
      setLoading(false);
    }
  };

  const selectedOrg = orgs.find((o) => o.id === orgId);

  return (
    <div className="space-y-6 max-w-4xl">
      <h2 className="text-2xl font-bold text-white">Version migrations</h2>
      <p className="text-sm text-slate-500">
        Migrate an organization between major CRM versions. Always run dry-run first.
      </p>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-xs text-slate-500 uppercase">Organization</span>
            <select
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm"
            >
              <option value="">Select org…</option>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} ({o.crm_version_code ?? "?"})
                  {o.schema_version_locked ? " [locked]" : ""}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1">
            <span className="text-xs text-slate-500 uppercase">Target version</span>
            <select
              value={targetVersionId}
              onChange={(e) => setTargetVersionId(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm"
            >
              <option value="">Select version…</option>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.code} — {v.name}
                  {v.is_current ? " (current deploy)" : ""}
                </option>
              ))}
            </select>
          </label>
        </div>

        {selectedOrg && (
          <p className="text-xs text-slate-500">
            Current: {selectedOrg.crm_version_code ?? "unknown"} · status {selectedOrg.status}
            {selectedOrg.schema_version_locked ? " · migration lock active" : ""}
          </p>
        )}

        <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={dryRun}
            onChange={(e) => setDryRun(e.target.checked)}
            className="rounded border-slate-600"
          />
          Dry run (preview only, no changes)
        </label>

        <button
          type="button"
          onClick={runMigration}
          disabled={loading}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-semibold cursor-pointer disabled:opacity-50"
        >
          {loading ? "Running…" : dryRun ? "Run dry-run" : "Apply migration"}
        </button>

        {error && <p className="text-sm text-rose-400">{error}</p>}

        {result != null && (
          <pre className="text-xs bg-slate-950 border border-slate-800 rounded-lg p-3 overflow-x-auto text-slate-300">
            {JSON.stringify(result, null, 2)}
          </pre>
        )}
      </div>

      <div className="border border-slate-800 rounded-xl overflow-hidden">
        <div className="px-4 py-2 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-300">Migration history</h3>
          <button
            type="button"
            onClick={() => loadMigrations()}
            className="text-xs text-indigo-400 hover:text-indigo-300 cursor-pointer"
          >
            Refresh
          </button>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-900/50 text-slate-500 text-left">
            <tr>
              <th className="px-4 py-2 font-medium">When</th>
              <th className="px-4 py-2 font-medium">Path</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Mode</th>
            </tr>
          </thead>
          <tbody>
            {migrations.map((m) => (
              <tr key={m.id} className="border-t border-slate-800">
                <td className="px-4 py-2 text-slate-500">
                  {new Date(m.started_at).toLocaleString()}
                </td>
                <td className="px-4 py-2 text-slate-200">
                  {m.metadata?.from_code ?? "?"} → {m.metadata?.to_code ?? "?"}
                </td>
                <td className="px-4 py-2">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      m.status === "completed"
                        ? "bg-emerald-900/40 text-emerald-300"
                        : m.status === "failed"
                          ? "bg-rose-900/40 text-rose-300"
                          : "bg-slate-800 text-slate-300"
                    }`}
                  >
                    {m.status}
                  </span>
                  {m.error_message && (
                    <p className="text-xs text-rose-400 mt-1 truncate max-w-xs" title={m.error_message}>
                      {m.error_message}
                    </p>
                  )}
                </td>
                <td className="px-4 py-2 text-slate-500">{m.dry_run ? "dry-run" : "apply"}</td>
              </tr>
            ))}
            {migrations.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                  No migrations yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-slate-600 space-y-1">
        <p>Available paths: v2 ↔ v3 (stub transforms until v3 schema ships).</p>
        <p>Apply sets org status to licensed and updates organization_licenses.crm_version_id.</p>
      </div>
    </div>
  );
}
