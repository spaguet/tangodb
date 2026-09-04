import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, X } from "lucide-react";
import { useToast } from "../../App";
import { useI18n } from "../../hooks/useI18n";
import { useGoogleCalendarSyncStopped } from "../../hooks/useGoogleCalendarSyncStopped";
import { useOrganization } from "../../organization/OrganizationProvider";
import {
  googleCalendarSyncStoppedBannerDismissKey,
  googleCalendarSyncStoppedToastKey,
} from "../../lib/googleCalendarSyncHealth";

/**
 * Global notice when Google Calendar sync stops (revoked/expired OAuth token).
 * Shows a persistent banner + one toast per revoke episode.
 */
export default function GoogleCalendarSyncStoppedNotifier() {
  const { t } = useI18n();
  const toast = useToast();
  const { organizationId } = useOrganization();
  const { stopped, account, isLoading } = useGoogleCalendarSyncStopped();
  const [bannerDismissed, setBannerDismissed] = useState(false);

  useEffect(() => {
    if (!organizationId) return;
    const dismissed = sessionStorage.getItem(googleCalendarSyncStoppedBannerDismissKey(organizationId));
    setBannerDismissed(dismissed === "1");
  }, [organizationId]);

  useEffect(() => {
    if (!stopped || !account || !organizationId || isLoading) return;

    const toastKey = googleCalendarSyncStoppedToastKey(organizationId, account);
    if (sessionStorage.getItem(toastKey) === "1") return;

    sessionStorage.setItem(toastKey, "1");
    toast(t("integrations.googleCalendar.syncStoppedToast"), "error");
  }, [stopped, account, organizationId, isLoading, toast, t]);

  useEffect(() => {
    if (!stopped) {
      setBannerDismissed(false);
      if (organizationId) {
        sessionStorage.removeItem(googleCalendarSyncStoppedBannerDismissKey(organizationId));
      }
    }
  }, [stopped, organizationId]);

  if (isLoading || !stopped || bannerDismissed) return null;

  const handleDismiss = () => {
    if (organizationId) {
      sessionStorage.setItem(googleCalendarSyncStoppedBannerDismissKey(organizationId), "1");
    }
    setBannerDismissed(true);
  };

  return (
    <div className="bg-amber-50 border-b border-amber-100 px-4 sm:px-6 py-2.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
      <div className="flex items-start gap-2 text-sm text-amber-900 min-w-0">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        <div className="space-y-0.5 min-w-0">
          <p className="font-medium">{t("integrations.googleCalendar.syncStoppedTitle")}</p>
          <p className="text-xs opacity-90">{t("integrations.googleCalendar.syncStoppedBody")}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Link
          to="/settings/integrations"
          className="text-xs font-semibold uppercase tracking-wide text-amber-900 underline underline-offset-2"
        >
          {t("integrations.googleCalendar.syncStoppedAction")}
        </Link>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label={t("common.close")}
          className="p-1 text-amber-700 hover:text-amber-900 rounded-full hover:bg-amber-100 cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
