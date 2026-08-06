import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
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
import { resolveMutationError, isI18nKey } from "../../lib/resolveMutationError";
import type { I18nKey } from "../../lib/i18n/keys";
import type { GoogleCalendarListEntry } from "../../lib/googleCalendarApi";

type DisconnectMode = "leave" | "delete" | null;

export default function OrgEventsGoogleSyncSection() {
  const { t, formatDateTime } = useI18n();
  const toast = useToast();
  const {
    canManage,
    primaryAccount,
    binding,
    isConfigured,
    isLoading,
    organizationId,
    connect,
    listCalendars,
    createCalendar,
    setBinding,
    disconnect,
    verify,
    syncFuture,
  } = useOrgGoogleCalendarIntegration();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [calendars, setCalendars] = useState<GoogleCalendarListEntry[]>([]);
  const [selectedCalendarId, setSelectedCalendarId] = useState("");
  const [deleteOldOnChange, setDeleteOldOnChange] = useState(false);
  const [disconnectMode, setDisconnectMode] = useState<DisconnectMode>(null);
  const [loadingCalendars, setLoadingCalendars] = useState(false);

  const returnUrl = useMemo(
    () => `${window.location.origin}/settings/integrations`,
    []
  );

  const loadCalendars = useCallback(
    async (googleAccountId: string) => {
      setLoadingCalendars(true);
      try {
        const list = await listCalendars.mutateAsync(googleAccountId);
        setCalendars(list);
        const writable = list.filter((c) => c.selectable);
        if (writable.length > 0) {
          const preferred =
            writable.find((c) => c.summary.startsWith("TangoDB /")) ?? writable[0];
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
    [listCalendars, toast, t]
  );

  useEffect(() => {
    if (!pickerOpen || !primaryAccount) return;
    void loadCalendars(primaryAccount.id);
  }, [pickerOpen, primaryAccount?.id, loadCalendars]);

  const needsCalendarSetup =
    primaryAccount?.status === "active" && !binding && !pickerOpen;

  useEffect(() => {
    if (needsCalendarSetup && primaryAccount) {
      setPickerOpen(true);
    }
  }, [needsCalendarSetup, primaryAccount?.id]);

  if (!canManage) return null;

  if (isLoading) {
    return <LoadingState label={t("integrations.googleCalendar.orgEvents.loading")} />;
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
    if (!primaryAccount) return;
    try {
      const calendar = await createCalendar.mutateAsync(primaryAccount.id);
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
    if (!primaryAccount || !selectedCalendarId) return;
    const selected = calendars.find((c) => c.id === selectedCalendarId);
    if (!selected) return;

    try {
      await setBinding.mutateAsync({
        googleAccountId: primaryAccount.id,
        calendarId: selected.id,
        calendarName: selected.summary,
        timezone: selected.timeZone,
        deleteOldEvents: deleteOldOnChange,
      });
      setPickerOpen(false);
      setDeleteOldOnChange(false);
      toast(t("integrations.googleCalendar.orgEvents.saveSuccess"), "success");
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
    if (!primaryAccount) return;
    try {
      await verify.mutateAsync(primaryAccount.id);
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

  const accountStatusTone =
    primaryAccount?.status === "active"
      ? "text-indigo-700 bg-indigo-50 border-indigo-100"
      : primaryAccount?.status === "revoked"
        ? "text-amber-800 bg-amber-50 border-amber-100"
        : "text-rose-700 bg-rose-50 border-rose-100";

  const writableCalendars = calendars.filter((c) => c.selectable);

  return (
    <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-4 space-y-4">
      <div className="flex items-start gap-3">
        <CalendarHeart className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            {t("integrations.googleCalendar.orgEvents.title")}
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            {t("integrations.googleCalendar.orgEvents.subtitle")}
          </p>
        </div>
      </div>

      {!primaryAccount || primaryAccount.status !== "active" ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            {t("integrations.googleCalendar.orgEvents.connectHint")}
          </p>
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
          <p className="text-xs text-slate-500">
            {t("integrations.googleCalendar.selectCalendarHint", {
              email: primaryAccount.google_email,
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
              disabled={createCalendar.isPending || !organizationId}
              className={btnOpenCls}
            >
              {createCalendar.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : null}
              {t("integrations.googleCalendar.createCalendar")}
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
              disabled={setBinding.isPending || !selectedCalendarId}
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
                {isConfigured
                  ? t("integrations.googleCalendar.orgEvents.status.connected")
                  : t("integrations.googleCalendar.orgEvents.status.notConfigured")}
              </p>
              <p className="text-xs opacity-80 truncate">
                {t("integrations.googleCalendar.accountEmail")}: {primaryAccount.google_email}
              </p>
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
                setPickerOpen(true);
              }}
              className={btnOpenCls}
            >
              {t("integrations.googleCalendar.changeCalendar")}
            </button>
          </div>

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
        </div>
      )}
    </div>
  );
}
