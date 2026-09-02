import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Building2,
  CalendarHeart,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
  Unplug,
} from "lucide-react";
import AppSelect from "../../components/ui/AppSelect";
import { btnAddCls, btnDestructiveCls, btnOpenCls, btnRefreshCls } from "../../components/ui/buttonStyles";
import LoadingState from "../../components/ui/LoadingState";
import { useToast } from "../../App";
import { useOrgGoogleCalendarIntegration } from "../../hooks/useOrgGoogleCalendarIntegration";
import { useI18n } from "../../hooks/useI18n";
import { resolveMutationError } from "../../lib/resolveMutationError";
import type { I18nKey } from "../../lib/i18n/keys";
import type { GoogleCalendarListEntry, OrgGoogleCalendarPurpose } from "../../lib/googleCalendarApi";
import { listGoogleCalendars } from "../../lib/googleCalendarApi";

type DisconnectMode = "leave" | "delete" | null;

const copyByPurpose: Record<
  OrgGoogleCalendarPurpose,
  {
    loading: I18nKey;
    title: I18nKey;
    subtitle: I18nKey;
    connectHint: I18nKey;
    saveSuccess: I18nKey;
    statusConnected: I18nKey;
    statusNotConfigured: I18nKey;
    createCalendar: I18nKey;
  }
> = {
  events: {
    loading: "integrations.googleCalendar.orgEvents.loading",
    title: "integrations.googleCalendar.orgEvents.title",
    subtitle: "integrations.googleCalendar.orgEvents.subtitle",
    connectHint: "integrations.googleCalendar.orgEvents.connectHint",
    saveSuccess: "integrations.googleCalendar.orgEvents.saveSuccess",
    statusConnected: "integrations.googleCalendar.orgEvents.status.connected",
    statusNotConfigured: "integrations.googleCalendar.orgEvents.status.notConfigured",
    createCalendar: "integrations.googleCalendar.createCalendar",
  },
  rentals: {
    loading: "integrations.googleCalendar.orgRentals.loading",
    title: "integrations.googleCalendar.orgRentals.title",
    subtitle: "integrations.googleCalendar.orgRentals.subtitle",
    connectHint: "integrations.googleCalendar.orgRentals.connectHint",
    saveSuccess: "integrations.googleCalendar.orgRentals.saveSuccess",
    statusConnected: "integrations.googleCalendar.orgRentals.status.connected",
    statusNotConfigured: "integrations.googleCalendar.orgRentals.status.notConfigured",
    createCalendar: "integrations.googleCalendar.orgRentals.createCalendar",
  },
};

export default function OrgEventsGoogleSyncSection({
  purpose = "events",
}: {
  purpose?: OrgGoogleCalendarPurpose;
}) {
  const { t, formatDateTime } = useI18n();
  const toast = useToast();
  const copy = copyByPurpose[purpose];
  const {
    canManage,
    accounts,
    primaryAccount,
    boundAccount,
    binding,
    isConfigured,
    isLoading,
    organizationId,
    connect,
    createCalendar,
    setBinding,
    disconnect,
    verify,
    syncFuture,
  } = useOrgGoogleCalendarIntegration(purpose);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [calendars, setCalendars] = useState<GoogleCalendarListEntry[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [selectedCalendarId, setSelectedCalendarId] = useState("");
  const [deleteOldOnChange, setDeleteOldOnChange] = useState(false);
  const [disconnectMode, setDisconnectMode] = useState<DisconnectMode>(null);
  const [loadingCalendars, setLoadingCalendars] = useState(false);
  const calendarsFetchedForRef = useRef<string | null>(null);

  const returnUrl = useMemo(
    () => `${window.location.origin}/settings/integrations`,
    []
  );

  const activeAccounts = useMemo(
    () => accounts.filter((account) => account.status === "active"),
    [accounts]
  );

  const selectedAccount =
    activeAccounts.find((account) => account.id === selectedAccountId) ??
    activeAccounts[0] ??
    null;

  useEffect(() => {
    if (!pickerOpen) return;
    const preferred =
      boundAccount?.status === "active"
        ? boundAccount.id
        : primaryAccount?.status === "active"
          ? primaryAccount.id
          : activeAccounts[0]?.id ?? "";
    setSelectedAccountId((current) => current || preferred);
  }, [pickerOpen, boundAccount?.id, boundAccount?.status, primaryAccount?.id, primaryAccount?.status, activeAccounts]);

  const loadCalendars = useCallback(
    async (googleAccountId: string) => {
      setLoadingCalendars(true);
      try {
        const list = await listGoogleCalendars(googleAccountId);
        setCalendars(list);
        const writable = list.filter((c) => c.selectable);
        if (writable.length > 0) {
          const preferred =
            (binding?.google_account_id === googleAccountId
              ? writable.find((c) => c.id === binding.calendar_id)
              : undefined) ??
            writable.find((c) =>
              purpose === "rentals"
                ? c.summary.includes("/ rentals")
                : c.summary.startsWith("TangoDB /") && !c.summary.includes("/ rentals")
            ) ??
            writable[0];
          setSelectedCalendarId(preferred.id);
        } else {
          setSelectedCalendarId("");
        }
      } catch (err) {
        toast(
          resolveMutationError(
            err instanceof Error ? err.message : undefined,
            "integrations.googleCalendar.errorGeneric",
            t
          ),
          "error"
        );
      } finally {
        setLoadingCalendars(false);
      }
    },
    [toast, t, binding?.google_account_id, binding?.calendar_id, purpose]
  );

  useEffect(() => {
    if (!pickerOpen || !selectedAccount) {
      calendarsFetchedForRef.current = null;
      return;
    }
    const accountId = selectedAccount.id;
    if (calendarsFetchedForRef.current === accountId) return;
    calendarsFetchedForRef.current = accountId;
    void loadCalendars(accountId);
  }, [pickerOpen, selectedAccount?.id, loadCalendars]);

  const needsCalendarSetup =
    purpose === "events" &&
    primaryAccount?.status === "active" &&
    !binding &&
    !pickerOpen;

  useEffect(() => {
    if (needsCalendarSetup && primaryAccount) {
      setPickerOpen(true);
    }
  }, [needsCalendarSetup, primaryAccount?.id]);

  if (!canManage) return null;

  if (isLoading) {
    return <LoadingState label={t(copy.loading)} />;
  }

  const handleConnect = async () => {
    try {
      await connect.mutateAsync(returnUrl);
    } catch (err) {
      toast(
        resolveMutationError(
          err instanceof Error ? err.message : undefined,
          "integrations.googleCalendar.errorGeneric",
          t
        ),
        "error"
      );
    }
  };

  const handleCreateCalendar = async () => {
    if (!selectedAccount) return;
    try {
      const calendar = await createCalendar.mutateAsync(selectedAccount.id);
      setCalendars((prev) => {
        const exists = prev.some((c) => c.id === calendar.id);
        return exists ? prev : [...prev, calendar];
      });
      setSelectedCalendarId(calendar.id);
      toast(t("integrations.googleCalendar.createCalendarSuccess"), "success");
    } catch (err) {
      toast(
        resolveMutationError(
          err instanceof Error ? err.message : undefined,
          "integrations.googleCalendar.errorGeneric",
          t
        ),
        "error"
      );
    }
  };

  const handleSaveCalendar = async () => {
    if (!selectedAccount || !selectedCalendarId) return;
    const selected = calendars.find((c) => c.id === selectedCalendarId);
    if (!selected) return;

    try {
      await setBinding.mutateAsync({
        googleAccountId: selectedAccount.id,
        calendarId: selected.id,
        calendarName: selected.summary,
        timezone: selected.timeZone,
        deleteOldEvents: deleteOldOnChange,
      });
      setPickerOpen(false);
      setDeleteOldOnChange(false);
      toast(t(copy.saveSuccess), "success");
    } catch (err) {
      toast(
        resolveMutationError(
          err instanceof Error ? err.message : undefined,
          "integrations.googleCalendar.errorGeneric",
          t
        ),
        "error"
      );
    }
  };

  const handleSyncFuture = async () => {
    try {
      await syncFuture.mutateAsync();
      toast(t("integrations.googleCalendar.syncFutureSuccess"), "success");
    } catch (err) {
      toast(
        resolveMutationError(
          err instanceof Error ? err.message : undefined,
          "integrations.googleCalendar.errorGeneric",
          t
        ),
        "error"
      );
    }
  };

  const handleVerify = async () => {
    const accountId = boundAccount?.id ?? selectedAccount?.id ?? primaryAccount?.id;
    if (!accountId) return;
    try {
      await verify.mutateAsync(accountId);
      toast(t("integrations.googleCalendar.verifySuccess"), "success");
    } catch (err) {
      toast(
        resolveMutationError(
          err instanceof Error ? err.message : undefined,
          "integrations.googleCalendar.errorGeneric",
          t
        ),
        "error"
      );
    }
  };

  const handleDisconnect = async () => {
    if (!disconnectMode) return;
    try {
      await disconnect.mutateAsync({
        deleteFutureEvents: disconnectMode === "delete",
      });
      setDisconnectMode(null);
      setPickerOpen(false);
      toast(t("integrations.googleCalendar.disconnectSuccess"), "success");
    } catch (err) {
      toast(
        resolveMutationError(
          err instanceof Error ? err.message : undefined,
          "integrations.googleCalendar.errorGeneric",
          t
        ),
        "error"
      );
    }
  };

  const displayAccount = boundAccount ?? primaryAccount;
  const accountStatusTone =
    displayAccount?.status === "active"
      ? "text-indigo-700 bg-indigo-50 border-indigo-100"
      : displayAccount?.status === "revoked"
        ? "text-amber-800 bg-amber-50 border-amber-100"
        : "text-rose-700 bg-rose-50 border-rose-100";

  const writableCalendars = calendars.filter((c) => c.selectable);
  const Icon = purpose === "rentals" ? Building2 : CalendarHeart;

  return (
    <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-4 space-y-4">
      <div className="flex items-start gap-3">
        <Icon className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{t(copy.title)}</h3>
          <p className="text-xs text-slate-500 mt-1">{t(copy.subtitle)}</p>
        </div>
      </div>

      {activeAccounts.length === 0 ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">{t(copy.connectHint)}</p>
          <button
            type="button"
            onClick={() => void handleConnect()}
            disabled={connect.isPending}
            className={btnAddCls}
          >
            {connect.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <ExternalLink className="w-3.5 h-3.5" />
            )}
            {t("integrations.googleCalendar.connect")}
          </button>
        </div>
      ) : pickerOpen ? (
        <div className="space-y-4">
          <AppSelect
            label={t("integrations.googleCalendar.accountLabel")}
            value={selectedAccount?.id ?? ""}
            onChange={(e) => {
              setSelectedAccountId(e.target.value);
              calendarsFetchedForRef.current = null;
              setCalendars([]);
              setSelectedCalendarId("");
            }}
          >
            {activeAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.google_email}
              </option>
            ))}
          </AppSelect>

          <p className="text-xs text-slate-500">
            {t("integrations.googleCalendar.selectCalendarHint", {
              email: selectedAccount?.google_email ?? "",
            })}
          </p>

          {loadingCalendars ? (
            <LoadingState label={t("integrations.googleCalendar.loadingCalendars")} />
          ) : writableCalendars.length === 0 ? (
            <p className="text-xs text-slate-500">
              {t("integrations.googleCalendar.noWritableCalendars")}
            </p>
          ) : (
            <AppSelect
              label={t("integrations.googleCalendar.calendarLabel")}
              value={selectedCalendarId}
              onChange={(e) => setSelectedCalendarId(e.target.value)}
            >
              {writableCalendars.map((cal) => (
                <option key={cal.id} value={cal.id}>
                  {cal.summary}
                  {cal.primary ? ` (${t("integrations.googleCalendar.primaryBadge")})` : ""}
                </option>
              ))}
            </AppSelect>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleCreateCalendar()}
              disabled={createCalendar.isPending || !organizationId || !selectedAccount}
              className={btnOpenCls}
            >
              {createCalendar.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : null}
              {t(copy.createCalendar)}
            </button>
            <button
              type="button"
              onClick={() => void handleConnect()}
              disabled={connect.isPending}
              className={btnRefreshCls}
            >
              {connect.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ExternalLink className="w-3.5 h-3.5" />
              )}
              {t("integrations.googleCalendar.connectAnotherAccount")}
            </button>
          </div>

          {binding && (
            <label className="flex items-start gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={deleteOldOnChange}
                onChange={(e) => setDeleteOldOnChange(e.target.checked)}
              />
              {t("integrations.googleCalendar.deleteOldEventsOnChange")}
            </label>
          )}

          <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => void handleSaveCalendar()}
              disabled={setBinding.isPending || !selectedCalendarId || !selectedAccount}
              className={btnAddCls}
            >
              {setBinding.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              {t("integrations.googleCalendar.saveCalendar")}
            </button>
            {binding && (
              <button type="button" onClick={() => setPickerOpen(false)} className={btnRefreshCls}>
                {t("common.cancel")}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className={`flex items-start gap-3 rounded-lg border px-3 py-3 ${accountStatusTone}`}>
            {isConfigured ? (
              <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
            )}
            <div className="space-y-1 text-sm min-w-0">
              <p className="font-semibold">
                {isConfigured ? t(copy.statusConnected) : t(copy.statusNotConfigured)}
              </p>
              {displayAccount && (
                <p className="text-xs opacity-80 truncate">
                  {t("integrations.googleCalendar.accountEmail")}: {displayAccount.google_email}
                </p>
              )}
              {binding && (
                <>
                  <p className="text-xs opacity-80 truncate">
                    {t("integrations.googleCalendar.calendarName")}: {binding.calendar_name}
                  </p>
                  <p className="text-xs opacity-80">
                    {t("integrations.googleCalendar.calendarTimezone")}: {binding.timezone}
                  </p>
                </>
              )}
            </div>
          </div>

          {binding?.last_success_at && (
            <p className="text-xs text-slate-500">
              {t("integrations.googleCalendar.lastSuccess")}:{" "}
              {formatDateTime(binding.last_success_at)}
            </p>
          )}
          {binding?.last_error_code && (
            <p className="text-xs text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
              {t("integrations.googleCalendar.lastError")}: {binding.last_error_code}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {isConfigured && boundAccount && (
              <button
                type="button"
                onClick={() => void handleVerify()}
                disabled={verify.isPending}
                className={btnOpenCls}
              >
                {verify.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                {t("integrations.googleCalendar.verify")}
              </button>
            )}
            <button
              type="button"
              onClick={() => void handleSyncFuture()}
              disabled={!isConfigured || syncFuture.isPending}
              className={btnRefreshCls}
            >
              {syncFuture.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              {t("integrations.googleCalendar.syncFuture")}
            </button>
            <button
              type="button"
              onClick={() => {
                setDeleteOldOnChange(false);
                setSelectedAccountId(boundAccount?.id ?? primaryAccount?.id ?? "");
                setPickerOpen(true);
              }}
              className={btnOpenCls}
            >
              {isConfigured
                ? t("integrations.googleCalendar.changeCalendar")
                : t("integrations.googleCalendar.selectCalendar")}
            </button>
          </div>

          {isConfigured && (
            <div className="border-t border-slate-100 pt-4 space-y-3">
              <h4 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                <Unplug className="w-4 h-4 text-slate-500" />
                {t("integrations.googleCalendar.disconnect")}
              </h4>
              {disconnectMode ? (
                <div className="space-y-3">
                  <p className="text-xs text-slate-600">
                    {disconnectMode === "delete"
                      ? t("integrations.googleCalendar.disconnectDeleteFutureHint")
                      : t("integrations.googleCalendar.disconnectLeaveHint")}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void handleDisconnect()}
                      disabled={disconnect.isPending}
                      className={btnDestructiveCls}
                    >
                      {disconnect.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                      {t("integrations.googleCalendar.confirmDisconnect")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDisconnectMode(null)}
                      className={btnRefreshCls}
                    >
                      {t("common.cancel")}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setDisconnectMode("leave")}
                    className={btnRefreshCls}
                  >
                    {t("integrations.googleCalendar.disconnectLeaveEvents")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDisconnectMode("delete")}
                    className={btnRefreshCls}
                  >
                    {t("integrations.googleCalendar.disconnectDeleteFuture")}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
