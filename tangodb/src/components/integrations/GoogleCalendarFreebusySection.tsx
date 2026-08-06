import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock, ExternalLink, Loader2 } from "lucide-react";
import { useI18n } from "../../hooks/useI18n";
import { useGoogleCalendarIntegration } from "../../hooks/useGoogleCalendarIntegration";
import {
  accountHasFreebusyScopes,
  resolveFreebusyConsentPurpose,
} from "../../lib/googleCalendarFreebusy";
import type { GoogleCalendarListEntry } from "../../lib/googleCalendarApi";
import { resolveMutationError } from "../../lib/resolveMutationError";
import { useToast } from "../../App";
import { btnAddCls, btnOpenCls } from "../ui/buttonStyles";

export default function GoogleCalendarFreebusySection() {
  const { t } = useI18n();
  const toast = useToast();
  const {
    primaryAccount,
    binding,
    isConfigured,
    memberId,
    listCalendars,
    connect,
    setFreebusyConfig,
    invalidateAll,
  } = useGoogleCalendarIntegration();

  const [calendars, setCalendars] = useState<GoogleCalendarListEntry[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loadingCalendars, setLoadingCalendars] = useState(false);

  const returnUrl = useMemo(
    () => `${window.location.origin}/settings/integrations`,
    []
  );

  const savedIds = binding?.freebusy_calendar_ids ?? [];
  const hasScopes = accountHasFreebusyScopes(primaryAccount?.granted_scopes, selectedIds);

  useEffect(() => {
    setSelectedIds(savedIds);
  }, [savedIds.join("|")]);

  const loadCalendars = useCallback(async () => {
    if (!primaryAccount) return;
    setLoadingCalendars(true);
    try {
      const list = await listCalendars.mutateAsync({
        googleAccountId: primaryAccount.id,
        purpose: "freebusy",
      });
      const readable = list.filter((c) => c.selectable);
      setCalendars(readable);
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
  }, [listCalendars, primaryAccount, toast, t]);

  useEffect(() => {
    if (!isConfigured || !primaryAccount) return;
    void loadCalendars();
  }, [isConfigured, primaryAccount?.id, loadCalendars]);

  if (!isConfigured || !primaryAccount || !memberId) {
    return null;
  }

  const syncCalendarId = binding?.calendar_id;

  const toggleCalendar = (calendarId: string) => {
    setSelectedIds((prev) =>
      prev.includes(calendarId)
        ? prev.filter((id) => id !== calendarId)
        : [...prev, calendarId]
    );
  };

  const handleGrantAccess = async () => {
    try {
      const purpose = resolveFreebusyConsentPurpose(
        selectedIds.length > 0 ? selectedIds : ["primary"]
      );
      await connect.mutateAsync({ returnUrl, consentPurpose: purpose });
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

  const handleSave = async () => {
    try {
      await setFreebusyConfig.mutateAsync({
        organizationMemberId: memberId,
        freebusyCalendarIds: selectedIds,
      });
      await invalidateAll();
      toast(t("integrations.googleCalendar.freebusy.saveSuccess"), "success");
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

  const needsConsent = selectedIds.length > 0 && !hasScopes;

  return (
    <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-4 space-y-4">
      <div className="flex items-start gap-3">
        <Clock className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
        <div>
          <h3 className="text-sm font-semibold text-slate-800">
            {t("integrations.googleCalendar.freebusy.title")}
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            {t("integrations.googleCalendar.freebusy.subtitle")}
          </p>
        </div>
      </div>

      {loadingCalendars ? (
        <p className="text-xs text-slate-500 flex items-center gap-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          {t("integrations.googleCalendar.freebusy.loadingCalendars")}
        </p>
      ) : calendars.length === 0 ? (
        <p className="text-xs text-slate-500">{t("integrations.googleCalendar.freebusy.noCalendars")}</p>
      ) : (
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {calendars.map((cal) => (
            <label
              key={cal.id}
              className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer"
            >
              <input
                type="checkbox"
                className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                checked={selectedIds.includes(cal.id)}
                onChange={() => toggleCalendar(cal.id)}
              />
              <span>
                {cal.summary}
                {cal.primary ? ` (${t("integrations.googleCalendar.primaryBadge")})` : ""}
                {cal.id === syncCalendarId
                  ? ` — ${t("integrations.googleCalendar.freebusy.syncCalendarBadge")}`
                  : ""}
              </span>
            </label>
          ))}
        </div>
      )}

      <p className="text-[10px] text-slate-400 leading-relaxed">
        {t("integrations.googleCalendar.freebusy.hint")}
      </p>

      {needsConsent && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {t("integrations.googleCalendar.freebusy.consentRequired")}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {needsConsent && (
          <button
            type="button"
            onClick={() => void handleGrantAccess()}
            disabled={connect.isPending}
            className={btnOpenCls}
          >
            {connect.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <ExternalLink className="w-3.5 h-3.5" />
            )}
            {t("integrations.googleCalendar.freebusy.grantAccess")}
          </button>
        )}
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={setFreebusyConfig.isPending || needsConsent}
          className={btnAddCls}
        >
          {setFreebusyConfig.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
          {t("integrations.googleCalendar.freebusy.save")}
        </button>
      </div>
    </div>
  );
}
