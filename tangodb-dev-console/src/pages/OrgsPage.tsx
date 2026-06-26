import { useState } from "react";
import { Check, Copy, Key, Trash2, UserCog } from "lucide-react";
import { invokeDevFunction } from "../lib/supabase";

interface TenantRow {
  id: string;
  name: string;
  slug: string | null;
  status: string;
  demo_expires_at: string | null;
  demo_days_left: number | null;
  created_at: string;
  crm_version_code: string | null;
  schema_version_locked: boolean;
  payment_ref: string | null;
  owner_email: string | null;
  owner_display_name: string | null;
  last_sign_in_at: string | null;
  telegram_masked: string | null;
  license_badge: string;
  storage_rows: number;
  storage_display: string;
  key_metadata: {
    key_type: string;
    status: string;
    activated_at: string | null;
    recipient_email: string | null;
  } | null;
}

type ModalKind = "password" | "purge" | "issueKey" | null;

export default function OrgsPage() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [expiringSoon, setExpiringSoon] = useState(false);
  const [awaitingPayment, setAwaitingPayment] = useState(false);
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<ModalKind>(null);
  const [activeTenant, setActiveTenant] = useState<TenantRow | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState("");
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [issuedKey, setIssuedKey] = useState<string | null>(null);
  const [purgeNameConfirm, setPurgeNameConfirm] = useState("");
  const [purgeReason, setPurgeReason] = useState("");
  const [copied, setCopied] = useState(false);

  const search = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await invokeDevFunction<{ tenants: TenantRow[] }>("dev-console-list-tenants", {
        query: query || undefined,
        status: status || undefined,
        expiring_soon: expiringSoon || undefined,
        awaiting_payment: awaitingPayment || undefined,
        limit: 50,
      });
      setTenants(result.tenants ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setLoading(false);
    }
  };

  const openModal = (kind: ModalKind, tenant: TenantRow) => {
    setActiveTenant(tenant);
    setModal(kind);
    setModalError("");
    setTempPassword(null);
    setIssuedKey(null);
    setPurgeNameConfirm("");
    setPurgeReason("");
    setCopied(false);
  };

  const closeModal = () => {
    setModal(null);
    setActiveTenant(null);
    setModalError("");
    setTempPassword(null);
    setIssuedKey(null);
  };

  const resetPassword = async () => {
    if (!activeTenant) return;
    setModalLoading(true);
    setModalError("");
    try {
      const result = await invokeDevFunction<{ temporary_password: string }>(
        "dev-console-reset-owner-password",
        { organization_id: activeTenant.id }
      );
      setTempPassword(result.temporary_password);
    } catch (e) {
      setModalError(e instanceof Error ? e.message : "Reset failed");
    } finally {
      setModalLoading(false);
    }
  };

  const issueKey = async () => {
    if (!activeTenant?.owner_email) return;
    setModalLoading(true);
    setModalError("");
    try {
      const result = await invokeDevFunction<{ key: string }>("dev-console-issue-key", {
        email: activeTenant.owner_email,
        note: `org:${activeTenant.id}`,
      });
      setIssuedKey(result.key);
    } catch (e) {
      setModalError(e instanceof Error ? e.message : "Issue failed");
    } finally {
      setModalLoading(false);
    }
  };

  const purgeOrg = async () => {
    if (!activeTenant) return;
    setModalLoading(true);
    setModalError("");
    try {
      await invokeDevFunction("dev-console-purge-org", {
        organization_id: activeTenant.id,
        org_name_confirm: purgeNameConfirm,
        reason: purgeReason || undefined,
      });
      closeModal();
      await search();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Purge failed";
      if (msg === "licensed_org_purge_forbidden") {
        setModalError("Удаление licensed org запрещено без override.");
      } else if (msg === "org_name_mismatch") {
        setModalError("Название org не совпадает — введите точное имя.");
      } else {
        setModalError(msg);
      }
    } finally {
      setModalLoading(false);
    }
  };

  const copyText = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const badgeColor = (badge: string) => {
    if (badge === "Lifetime") return "bg-emerald-900/50 text-emerald-300";
    if (badge === "Subscription") return "bg-blue-900/50 text-blue-300";
    if (badge === "Demo") return "bg-amber-900/50 text-amber-300";
    return "bg-slate-800 text-slate-300";
  };

  const canPurge = (t: TenantRow) =>
    t.status !== "purged" && t.status !== "licensed" && t.license_badge !== "Lifetime";

  return (
    <div className="space-y-4 max-w-[1400px]">
      <div>
        <h2 className="text-2xl font-bold text-white">Tenants</h2>
        <p className="text-xs text-slate-500 mt-1">
          CRM-базы клиентов: owner, лицензия, размер данных, last login. Поиск по email, имени, payment_ref.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 items-end">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Email, name, slug или payment_ref"
          className="flex-1 min-w-[220px] px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm"
          onKeyDown={(e) => e.key === "Enter" && void search()}
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm"
        >
          <option value="">Все статусы</option>
          <option value="demo_active">demo_active</option>
          <option value="demo_retention">demo_retention</option>
          <option value="licensed">licensed</option>
          <option value="purged">purged</option>
          <option value="suspended">suspended</option>
        </select>
        <label className="flex items-center gap-1.5 text-xs text-slate-400 px-2">
          <input
            type="checkbox"
            checked={expiringSoon}
            onChange={(e) => setExpiringSoon(e.target.checked)}
            className="rounded"
          />
          Demo ≤7 дней
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-400 px-2">
          <input
            type="checkbox"
            checked={awaitingPayment}
            onChange={(e) => setAwaitingPayment(e.target.checked)}
            className="rounded"
          />
          Ожидают оплаты
        </label>
        <button
          type="button"
          onClick={() => void search()}
          disabled={loading}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-semibold cursor-pointer disabled:opacity-50"
        >
          {loading ? "…" : "Search"}
        </button>
      </div>

      {error && <p className="text-sm text-rose-400">{error}</p>}

      <div className="border border-slate-800 rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[1100px]">
          <thead className="bg-slate-900 text-slate-500 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">CRM</th>
              <th className="px-3 py-2 font-medium">Owner</th>
              <th className="px-3 py-2 font-medium">License</th>
              <th className="px-3 py-2 font-medium">Storage</th>
              <th className="px-3 py-2 font-medium">Demo до</th>
              <th className="px-3 py-2 font-medium">Last login</th>
              <th className="px-3 py-2 font-medium">Key</th>
              <th className="px-3 py-2 font-medium">Ref</th>
              <th className="px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((t) => (
              <tr key={t.id} className="border-t border-slate-800 align-top">
                <td className="px-3 py-2">
                  <p className="text-slate-200 font-medium">{t.name}</p>
                  <p className="text-xs text-slate-500">{t.crm_version_code ?? "—"}</p>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">{t.status}</span>
                </td>
                <td className="px-3 py-2 text-slate-300">
                  <p className="truncate max-w-[180px]" title={t.owner_email ?? undefined}>
                    {t.owner_email ?? "—"}
                  </p>
                  <p className="text-xs text-slate-500">{t.owner_display_name ?? "—"}</p>
                  {t.telegram_masked && (
                    <p className="text-xs text-slate-600">TG {t.telegram_masked}</p>
                  )}
                </td>
                <td className="px-3 py-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${badgeColor(t.license_badge)}`}>
                    {t.license_badge}
                  </span>
                </td>
                <td className="px-3 py-2 text-slate-400">
                  {t.storage_display}
                  <span className="text-xs text-slate-600 block">{t.storage_rows} rows</span>
                </td>
                <td className="px-3 py-2 text-slate-400">
                  {t.demo_expires_at ? (
                    <>
                      {new Date(t.demo_expires_at).toLocaleDateString("ru-RU")}
                      {t.demo_days_left != null && (
                        <span className="text-xs text-amber-400 block">{t.demo_days_left} дн.</span>
                      )}
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-2 text-slate-500 text-xs">
                  {t.last_sign_in_at
                    ? new Date(t.last_sign_in_at).toLocaleString("ru-RU")
                    : "—"}
                </td>
                <td className="px-3 py-2 text-xs text-slate-500">
                  {t.key_metadata ? (
                    <>
                      {t.key_metadata.key_type}/{t.key_metadata.status}
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-2 text-xs font-mono text-slate-400">{t.payment_ref ?? "—"}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      title="Восстановить доступ"
                      onClick={() => openModal("password", t)}
                      disabled={!t.owner_email || t.status === "purged"}
                      className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40 cursor-pointer"
                    >
                      <UserCog className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      title="Lifetime key"
                      onClick={() => openModal("issueKey", t)}
                      disabled={!t.owner_email}
                      className="p-1.5 rounded bg-slate-800 hover:bg-indigo-900/50 text-indigo-300 disabled:opacity-40 cursor-pointer"
                    >
                      <Key className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      title="Удалить базу"
                      onClick={() => openModal("purge", t)}
                      disabled={!canPurge(t)}
                      className="p-1.5 rounded bg-slate-800 hover:bg-rose-900/50 text-rose-400 disabled:opacity-40 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {tenants.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                  Нажмите Search для загрузки tenant org
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {modal && activeTenant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-md w-full p-5 space-y-4 shadow-xl">
            {modal === "password" && (
              <>
                <h3 className="text-lg font-semibold text-white">Восстановить доступ</h3>
                <p className="text-sm text-slate-400">
                  Org: <span className="text-slate-200">{activeTenant.name}</span>
                  <br />
                  Owner: {activeTenant.owner_email}
                </p>
                {!tempPassword ? (
                  <>
                    <p className="text-xs text-amber-400">
                      Одноразовый пароль показывается один раз. Передайте owner по email / Telegram / WhatsApp.
                      Пароль не сохраняется в audit log.
                    </p>
                    {modalError && <p className="text-sm text-rose-400">{modalError}</p>}
                    <div className="flex gap-2 justify-end">
                      <button type="button" onClick={closeModal} className="px-3 py-2 text-sm text-slate-400 cursor-pointer">
                        Отмена
                      </button>
                      <button
                        type="button"
                        onClick={() => void resetPassword()}
                        disabled={modalLoading}
                        className="px-4 py-2 bg-indigo-600 rounded-lg text-sm font-semibold cursor-pointer disabled:opacity-50"
                      >
                        {modalLoading ? "…" : "Сгенерировать пароль"}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-emerald-400 uppercase font-semibold">Пароль — скопируйте сейчас</p>
                    <div className="flex items-center gap-2 p-3 bg-slate-950 rounded-lg border border-emerald-900">
                      <code className="flex-1 text-sm font-mono text-emerald-200 break-all">{tempPassword}</code>
                      <button type="button" onClick={() => void copyText(tempPassword)} className="p-2 text-emerald-400 cursor-pointer">
                        {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </div>
                    <button type="button" onClick={closeModal} className="w-full py-2 text-sm text-slate-400 cursor-pointer">
                      Закрыть
                    </button>
                  </>
                )}
              </>
            )}

            {modal === "issueKey" && (
              <>
                <h3 className="text-lg font-semibold text-white">Lifetime key</h3>
                <p className="text-sm text-slate-400">
                  Email: {activeTenant.owner_email}
                </p>
                {!issuedKey ? (
                  <>
                    {modalError && <p className="text-sm text-rose-400">{modalError}</p>}
                    <div className="flex gap-2 justify-end">
                      <button type="button" onClick={closeModal} className="px-3 py-2 text-sm text-slate-400 cursor-pointer">
                        Отмена
                      </button>
                      <button
                        type="button"
                        onClick={() => void issueKey()}
                        disabled={modalLoading}
                        className="px-4 py-2 bg-indigo-600 rounded-lg text-sm font-semibold cursor-pointer disabled:opacity-50"
                      >
                        {modalLoading ? "…" : "Выдать ключ"}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-emerald-400 uppercase font-semibold">Key — copy now</p>
                    <div className="flex items-center gap-2 p-3 bg-slate-950 rounded-lg border border-emerald-900">
                      <code className="flex-1 text-sm font-mono text-emerald-200 break-all">{issuedKey}</code>
                      <button type="button" onClick={() => void copyText(issuedKey)} className="p-2 text-emerald-400 cursor-pointer">
                        {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </div>
                    <button type="button" onClick={closeModal} className="w-full py-2 text-sm text-slate-400 cursor-pointer">
                      Закрыть
                    </button>
                  </>
                )}
              </>
            )}

            {modal === "purge" && (
              <>
                <h3 className="text-lg font-semibold text-rose-300">Удалить базу</h3>
                <p className="text-sm text-slate-400">
                  Необратимо для demo org. Licensed org заблокированы.
                </p>
                <label className="block space-y-1">
                  <span className="text-xs text-slate-500">Подтвердите название org</span>
                  <input
                    value={purgeNameConfirm}
                    onChange={(e) => setPurgeNameConfirm(e.target.value)}
                    placeholder={activeTenant.name}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs text-slate-500">Причина (optional)</span>
                  <input
                    value={purgeReason}
                    onChange={(e) => setPurgeReason(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm"
                  />
                </label>
                {modalError && <p className="text-sm text-rose-400">{modalError}</p>}
                <div className="flex gap-2 justify-end">
                  <button type="button" onClick={closeModal} className="px-3 py-2 text-sm text-slate-400 cursor-pointer">
                    Отмена
                  </button>
                  <button
                    type="button"
                    onClick={() => void purgeOrg()}
                    disabled={modalLoading || purgeNameConfirm !== activeTenant.name}
                    className="px-4 py-2 bg-rose-700 hover:bg-rose-600 rounded-lg text-sm font-semibold cursor-pointer disabled:opacity-50"
                  >
                    {modalLoading ? "…" : "Удалить навсегда"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
