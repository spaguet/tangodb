import { useState } from "react";
import { Check, Copy, Key, Mail, Trash2, UserCog } from "lucide-react";
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

type ModalKind = "password" | "purge" | "issueKey" | "transferOwner" | null;

type TransferVerification = {
  recovery_code: string;
  payment_ref_verified: boolean;
  lifetime_license_verified: boolean;
  telegram_binding_verified: boolean;
  purchase_contact_verified: boolean;
  org_data_verified: boolean;
};

const EMPTY_TRANSFER_VERIFICATION: TransferVerification = {
  recovery_code: "",
  payment_ref_verified: false,
  lifetime_license_verified: false,
  telegram_binding_verified: false,
  purchase_contact_verified: false,
  org_data_verified: false,
};

function countTransferFactors(v: TransferVerification): number {
  let n = 0;
  if (v.recovery_code.trim()) n += 1;
  if (v.payment_ref_verified) n += 1;
  if (v.lifetime_license_verified) n += 1;
  if (v.telegram_binding_verified) n += 1;
  if (v.purchase_contact_verified) n += 1;
  if (v.org_data_verified) n += 1;
  return n;
}

function transferErrorMessage(code: string): string {
  const map: Record<string, string> = {
    insufficient_verification_factors: "Нужно минимум 2 фактора проверки владения.",
    invalid_recovery_code: "Emergency Recovery Code не совпадает.",
    no_active_recovery_code: "У owner нет активного recovery code.",
    payment_ref_not_available: "У org нет payment_ref — снимите галочку.",
    lifetime_license_not_confirmed: "Org не licensed/lifetime — снимите галочку.",
    telegram_not_bound: "Telegram не привязан — снимите галочку.",
    anti_abuse_purged_demo_email: "Новый email в anti-abuse (purged demo) — перенос запрещён.",
    new_email_same_as_current: "Новый email совпадает с текущим.",
    new_email_already_registered: "Email занят другим аккаунтом — используйте reassign или другой email.",
  };
  return map[code] ?? code;
}

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
  const [purgeForceLicensed, setPurgeForceLicensed] = useState(false);
  const [issueKeySignature, setIssueKeySignature] = useState("");
  const [copied, setCopied] = useState(false);
  const [transferEmail, setTransferEmail] = useState("");
  const [transferReason, setTransferReason] = useState("");
  const [transferVerification, setTransferVerification] = useState<TransferVerification>(
    EMPTY_TRANSFER_VERIFICATION
  );
  const [transferSuccess, setTransferSuccess] = useState<string | null>(null);

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
    setPurgeForceLicensed(false);
    setIssueKeySignature("");
    setCopied(false);
    setTransferEmail("");
    setTransferReason("");
    setTransferVerification(EMPTY_TRANSFER_VERIFICATION);
    setTransferSuccess(null);
  };

  const closeModal = () => {
    setModal(null);
    setActiveTenant(null);
    setModalError("");
    setTempPassword(null);
    setIssuedKey(null);
    setIssueKeySignature("");
    setTransferEmail("");
    setTransferReason("");
    setTransferVerification(EMPTY_TRANSFER_VERIFICATION);
    setTransferSuccess(null);
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
        issuer_signature: issueKeySignature,
      });
      setIssuedKey(result.key);
    } catch (e) {
      const raw = e instanceof Error ? e.message : "Issue failed";
      const map: Record<string, string> = {
        invalid_issuer_signature: "Неверная подпись выдающего.",
        issuer_signature_required: "Введите подпись выдающего.",
        issuer_signature_not_configured:
          "Секрет DEV_CONSOLE_ISSUER_SIGNATURE не настроен в Supabase.",
        recipient_email_required: "Email получателя обязателен.",
      };
      setModalError(map[raw] ?? raw);
    } finally {
      setModalLoading(false);
    }
  };

  const transferOwnerEmail = async () => {
    if (!activeTenant) return;
    setModalLoading(true);
    setModalError("");
    setTransferSuccess(null);
    try {
      const result = await invokeDevFunction<{ transfer_mode: string; message: string }>(
        "dev-console-transfer-owner-email",
        {
          organization_id: activeTenant.id,
          new_email: transferEmail.trim(),
          reason: transferReason.trim(),
          verification: {
            recovery_code: transferVerification.recovery_code.trim() || undefined,
            payment_ref_verified: transferVerification.payment_ref_verified || undefined,
            lifetime_license_verified: transferVerification.lifetime_license_verified || undefined,
            telegram_binding_verified: transferVerification.telegram_binding_verified || undefined,
            purchase_contact_verified: transferVerification.purchase_contact_verified || undefined,
            org_data_verified: transferVerification.org_data_verified || undefined,
          },
        }
      );
      setTransferSuccess(
        result.transfer_mode === "reassign_user"
          ? "Owner переназначен на существующий аккаунт. Старый owner потерял доступ."
          : "Email owner обновлён. Передайте инструкции входа один раз."
      );
      await search();
    } catch (e) {
      const raw = e instanceof Error ? e.message : "Transfer failed";
      setModalError(transferErrorMessage(raw));
    } finally {
      setModalLoading(false);
    }
  };

  const purgeOrg = async () => {
    if (!activeTenant) return;
    setModalLoading(true);
    setModalError("");
    try {
      const needsForce = isLicensedTenant(activeTenant);
      await invokeDevFunction("dev-console-purge-org", {
        organization_id: activeTenant.id,
        org_name_confirm: purgeNameConfirm,
        reason: purgeReason || undefined,
        force_licensed: needsForce ? purgeForceLicensed : undefined,
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

  const isLicensedTenant = (t: TenantRow) =>
    t.status === "licensed" || t.license_badge === "Lifetime";

  const canPurge = (t: TenantRow) => t.status !== "purged";

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
                      title="Сменить owner email (S9)"
                      onClick={() => openModal("transferOwner", t)}
                      disabled={!t.owner_email || t.status === "purged"}
                      className="p-1.5 rounded bg-slate-800 hover:bg-amber-900/40 text-amber-300 disabled:opacity-40 cursor-pointer"
                    >
                      <Mail className="w-3.5 h-3.5" />
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
                      Если owner email доступен — сначала попросите «Забыли пароль?» в CRM. Здесь — сброс
                      support-пароля, если email недоступен или письмо не доходит. Пароль не сохраняется в audit log.
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

            {modal === "transferOwner" && (
              <>
                <h3 className="text-lg font-semibold text-white">Смена owner email (emergency)</h3>
                <p className="text-sm text-slate-400">
                  Org: <span className="text-slate-200">{activeTenant.name}</span>
                  <br />
                  Текущий owner: {activeTenant.owner_email}
                </p>
                {!transferSuccess ? (
                  <>
                    <p className="text-xs text-amber-400">
                      Минимум 2 фактора владения. Recovery code — только дополнительный фактор, не единственный.
                      Все действия пишутся в audit log (email — только hash).
                    </p>
                    <label className="block space-y-1">
                      <span className="text-xs text-slate-500">Новый email owner</span>
                      <input
                        type="email"
                        value={transferEmail}
                        onChange={(e) => setTransferEmail(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-xs text-slate-500">Причина (support ticket / заметка)</span>
                      <input
                        value={transferReason}
                        onChange={(e) => setTransferReason(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-xs text-slate-500">Emergency Recovery Code (optional)</span>
                      <input
                        value={transferVerification.recovery_code}
                        onChange={(e) =>
                          setTransferVerification((v) => ({ ...v, recovery_code: e.target.value }))
                        }
                        placeholder="XXXX-XXXX-XXXX"
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm font-mono"
                      />
                    </label>
                    <div className="space-y-2 text-xs text-slate-400">
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={transferVerification.payment_ref_verified}
                          disabled={!activeTenant.payment_ref}
                          onChange={(e) =>
                            setTransferVerification((v) => ({
                              ...v,
                              payment_ref_verified: e.target.checked,
                            }))
                          }
                          className="mt-0.5 rounded"
                        />
                        <span>
                          Payment ref подтверждён
                          {activeTenant.payment_ref ? ` (${activeTenant.payment_ref})` : " — нет ref"}
                        </span>
                      </label>
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={transferVerification.lifetime_license_verified}
                          disabled={activeTenant.license_badge !== "Lifetime" && activeTenant.status !== "licensed"}
                          onChange={(e) =>
                            setTransferVerification((v) => ({
                              ...v,
                              lifetime_license_verified: e.target.checked,
                            }))
                          }
                          className="mt-0.5 rounded"
                        />
                        <span>Lifetime / licensed org ({activeTenant.license_badge})</span>
                      </label>
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={transferVerification.telegram_binding_verified}
                          disabled={!activeTenant.telegram_masked}
                          onChange={(e) =>
                            setTransferVerification((v) => ({
                              ...v,
                              telegram_binding_verified: e.target.checked,
                            }))
                          }
                          className="mt-0.5 rounded"
                        />
                        <span>
                          Telegram binding проверен
                          {activeTenant.telegram_masked ? ` (${activeTenant.telegram_masked})` : " — нет TG"}
                        </span>
                      </label>
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={transferVerification.purchase_contact_verified}
                          onChange={(e) =>
                            setTransferVerification((v) => ({
                              ...v,
                              purchase_contact_verified: e.target.checked,
                            }))
                          }
                          className="mt-0.5 rounded"
                        />
                        <span>Контакт покупки (email/TG/WA) подтверждён</span>
                      </label>
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={transferVerification.org_data_verified}
                          onChange={(e) =>
                            setTransferVerification((v) => ({
                              ...v,
                              org_data_verified: e.target.checked,
                            }))
                          }
                          className="mt-0.5 rounded"
                        />
                        <span>Данные организации проверены вручную</span>
                      </label>
                    </div>
                    <p className="text-xs text-slate-500">
                      Факторов: {countTransferFactors(transferVerification)} / мин. 2
                    </p>
                    {modalError && <p className="text-sm text-rose-400">{modalError}</p>}
                    <div className="flex gap-2 justify-end">
                      <button type="button" onClick={closeModal} className="px-3 py-2 text-sm text-slate-400 cursor-pointer">
                        Отмена
                      </button>
                      <button
                        type="button"
                        onClick={() => void transferOwnerEmail()}
                        disabled={
                          modalLoading ||
                          !transferEmail.trim() ||
                          !transferReason.trim() ||
                          countTransferFactors(transferVerification) < 2
                        }
                        className="px-4 py-2 bg-amber-700 hover:bg-amber-600 rounded-lg text-sm font-semibold cursor-pointer disabled:opacity-50"
                      >
                        {modalLoading ? "…" : "Сменить owner email"}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-emerald-400">{transferSuccess}</p>
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
                  Ключ будет привязан к email owner и активируется только этим аккаунтом.
                </p>
                <label className="block space-y-1">
                  <span className="text-xs text-slate-500">Email получателя</span>
                  <input
                    type="email"
                    value={activeTenant.owner_email ?? ""}
                    readOnly
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm text-slate-300"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs text-slate-500">Подпись выдающего</span>
                  <input
                    type="password"
                    value={issueKeySignature}
                    onChange={(e) => setIssueKeySignature(e.target.value)}
                    placeholder="Ваша секретная подпись"
                    autoComplete="off"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm"
                  />
                </label>
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
                        disabled={modalLoading || !issueKeySignature.trim()}
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
                  {isLicensedTenant(activeTenant)
                    ? "Licensed / Lifetime org — необратимое удаление. Требуется подтверждение и причина."
                    : "Необратимое удаление demo org и всех данных."}
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
                  <span className="text-xs text-slate-500">
                    Причина{isLicensedTenant(activeTenant) ? " *" : " (optional)"}
                  </span>
                  <input
                    value={purgeReason}
                    onChange={(e) => setPurgeReason(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm"
                  />
                </label>
                {isLicensedTenant(activeTenant) && (
                  <label className="flex items-start gap-2 text-xs text-amber-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={purgeForceLicensed}
                      onChange={(e) => setPurgeForceLicensed(e.target.checked)}
                      className="mt-0.5 rounded"
                    />
                    <span>
                      Подтверждаю принудительное удаление licensed org (тест, мошенничество, украденный ключ)
                    </span>
                  </label>
                )}
                {modalError && <p className="text-sm text-rose-400">{modalError}</p>}
                <div className="flex gap-2 justify-end">
                  <button type="button" onClick={closeModal} className="px-3 py-2 text-sm text-slate-400 cursor-pointer">
                    Отмена
                  </button>
                  <button
                    type="button"
                    onClick={() => void purgeOrg()}
                    disabled={
                      modalLoading ||
                      purgeNameConfirm !== activeTenant.name ||
                      (isLicensedTenant(activeTenant) &&
                        (!purgeForceLicensed || !purgeReason.trim()))
                    }
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
