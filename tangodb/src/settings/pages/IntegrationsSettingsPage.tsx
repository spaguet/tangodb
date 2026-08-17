import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  CalendarDays,
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
import { useGoogleCalendarIntegration } from "../../hooks/useGoogleCalendarIntegration";
import { usePermissions } from "../../hooks/usePermissions";
import { useI18n } from "../../hooks/useI18n";
import { resolveMutationError, isI18nKey } from "../../lib/resolveMutationError";
import type { I18nKey } from "../../lib/i18n/keys";
import type { GoogleCalendarListEntry } from "../../lib/googleCalendarApi";
import { listGoogleCalendars } from "../../lib/googleCalendarApi";
import TeamGoogleSyncSection from "../components/TeamGoogleSyncSection";
import OrgEventsGoogleSyncSection from "../components/OrgEventsGoogleSyncSection";
import GoogleCalendarFreebusySection from "../../components/integrations/GoogleCalendarFreebusySection";

type DisconnectMode = "leave" | "delete" | "revoke" | null;

export default function IntegrationsSettingsPage() {
  const { t, formatDateTime } = useI18n();
  const { role } = usePermissions();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    primaryAccount,
    binding,
    isConfigured,
    isLoading,
    memberId,
    organizationId,
    isMemberActive,
    connect,
    createCalendar,
    setBinding,
    disconnect,
    verify,
    syncFuture,
    invalidateAll,
  } = useGoogleCalendarIntegration();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [calendars, setCalendars] = useState<GoogleCalendarListEntry[]>([]);
  const [selectedCalendarId, setSelectedCalendarId] = useState("");
  const [deleteOldOnChange, setDeleteOldOnChange] = useState(false);
  const [disconnectMode, setDisconnectMode] = useState<DisconnectMode>(null);
  const [loadingCalendars, setLoadingCalendars] = useState(false);
  const calendarsFetchedForRef = useRef<string | null>(null);

  const returnUrl = useMemo(
    () => `${window.location.origin}/settings/integrations`,
    []
  );

  useEffect(() => {
    const gcal = searchParams.get("gcal");
    if (!gcal) return;

    if (gcal === "success") {
      toast(t("integrations.googleCalendar.oauthSuccess"), "success");
      void invalidateAll().then(() => {
        if (memberId) {
          syncFuture.mutate(memberId);
        }
      });
    } else if (gcal === "error") {
      const reason = searchParams.get("reason") ?? "unknown";
      const reasonKey = `integrations.googleCalendar.oauthError.${reason}` as I18nKey;
      const message = isI18nKey(reasonKey) ? t(reasonKey) : reason;
      toast(t("integrations.googleCalendar.oauthErrorGeneric", { reason: message }), "error");
    }

    searchParams.delete("gcal");
    searchParams.delete("reason");
    setSearchParams(searchParams, { replace: true });
  }, [searchParams, setSearchParams, toast, t, invalidateAll, memberId, syncFuture]);

  const loadCalendars = useCallback(
    async (googleAccountId: string) => {
      setLoadingCalendars(true);
      try {
        const list = await listGoogleCalendars(googleAccountId);
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
    [toast, t]
  );

  useEffect(() => {
    if (!pickerOpen || !primaryAccount) {
      calendarsFetchedForRef.current = null;
      return;
    }
    const accountId = primaryAccount.id;
    if (calendarsFetchedForRef.current === accountId) return;
    calendarsFetchedForRef.current = accountId;
    void loadCalendars(accountId);
  }, [pickerOpen, primaryAccount?.id, loadCalendars]);

  const needsCalendarSetup =
    primaryAccount?.status === "active" && !binding && !pickerOpen;

  useEffect(() => {
    if (needsCalendarSetup && primaryAccount) {
      setPickerOpen(true);
    }
  }, [needsCalendarSetup, primaryAccount?.id]);

  if (isLoading) {
    return <LoadingState label={t("integrations.googleCalendar.loading")} />;
  }

  if (!isMemberActive) {
    return (
      <div className="panel-card-stack max-w-xl">
        <h2 className="text-base font-semibold text-slate-900">{t("integrations.title")}</h2>
        <p className="text-xs text-slate-500">{t("integrations.googleCalendar.inactiveMember")}</p>
      </div>
    );
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
    if (!memberId || !primaryAccount || !selectedCalendarId) return;
    const selected = calendars.find((c) => c.id === selectedCalendarId);
    if (!selected) return;

    try {
      await setBinding.mutateAsync({
        organizationMemberId: memberId,
        googleAccountId: primaryAccount.id,
        calendarId: selected.id,
        calendarName: selected.summary,
        timezone: selected.timeZone,
        deleteOldEvents: deleteOldOnChange,
      });
      setPickerOpen(false);
      setDeleteOldOnChange(false);
      toast(t("integrations.googleCalendar.saveCalendarSuccess"), "success");
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
    if (!memberId) return;
    try {
      await syncFuture.mutateAsync(memberId);
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
      if (disconnectMode === "revoke" && primaryAccount) {
        await disconnect.mutateAsync({
          revokeAccount: true,
          googleAccountId: primaryAccount.id,
          deleteFutureEvents: true,
        });
      } else if (memberId) {
        await disconnect.mutateAsync({
          organizationMemberId: memberId,
          deleteFutureEvents: disconnectMode === "delete",
        });
      }
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
  const showTeamSection = role === "owner" || role === "director";

  return (
    <div className={`panel-card-stack space-y-6 ${showTeamSection ? "max-w-3xl" : "max-w-xl"}`}>
      <div className="flex items-start gap-3">
        <CalendarDays className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
        <div>
          <h2 className="text-base font-semibold text-slate-900">{t("integrations.title")}</h2>
          <p className="text-xs text-slate-500 mt-1">{t("integrations.googleCalendar.subtitle")}</p>
        </div>
      </div>

      {!primaryAccount || primaryAccount.status !== "active" ? (
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-4 space-y-4">
          <p className="text-sm text-slate-600">{t("integrations.googleCalendar.notConnectedHint")}</p>
          {primaryAccount && primaryAccount.status !== "active" && (
            <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${accountStatusTone}`}>
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{t("integrations.googleCalendar.reconnectRequired")}</span>
            </div>
          )}
          <button
            type="button"
            onClick={() => void handleConnect()}
            disabled={connect.isPending || !memberId}
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
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-4 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">
              {binding ? t("integrations.googleCalendar.changeCalendar") : t("integrations.googleCalendar.selectCalendar")}
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              {t("integrations.googleCalendar.selectCalendarHint", { email: primaryAccount.google_email })}
            </p>
          </div>

          {loadingCalendars ? (
            <LoadingState label={t("integrations.googleCalendar.loadingCalendars")} />
          ) : writableCalendars.length === 0 ? (
            <p className="text-xs text-slate-500">{t("integrations.googleCalendar.noWritableCalendars")}</p>
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
          <p className="text-xs text-slate-500">{t("integrations.googleCalendar.createCalendarHint")}</p>

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
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                className={btnRefreshCls}
              >
                {t("common.cancel")}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-4 space-y-4">
          <div className={`flex items-start gap-3 rounded-lg border px-3 py-3 ${accountStatusTone}`}>
            {isConfigured ? (
              <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
            )}
            <div className="space-y-1 text-sm min-w-0">
              <p className="font-semibold">
                {isConfigured
                  ? t("integrations.googleCalendar.status.connected")
                  : t("integrations.googleCalendar.status.notConfigured")}
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
              {t("integrations.googleCalendar.lastSuccess")}: {formatDateTime(binding.last_success_at)}
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
            <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
              <Unplug className="w-4 h-4 text-slate-500" />
              {t("integrations.googleCalendar.disconnect")}
            </h3>
            {disconnectMode ? (
              <div className="space-y-3">
                <p className="text-xs text-slate-600">
                  {disconnectMode === "revoke"
                    ? t("integrations.googleCalendar.revokeEverywhereHint")
                    : disconnectMode === "delete"
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
                <button
                  type="button"
                  onClick={() => setDisconnectMode("revoke")}
                  className={btnDestructiveCls}
                >
                  {t("integrations.googleCalendar.revokeEverywhere")}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {isConfigured && <GoogleCalendarFreebusySection />}

      {showTeamSection && <OrgEventsGoogleSyncSection />}
      {showTeamSection && <TeamGoogleSyncSection />}
    </div>
  );
}
