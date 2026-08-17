import { Bell, X } from "lucide-react";
import { useMemo } from "react";
import { useI18n } from "../../hooks/useI18n";
import { formatClientName } from "../../lib/utils";
import { useDismissGroupSpotNotification, useGroupSpotNotifications } from "../../hooks/useGroupWaitlist";
import { useScheduleGroups } from "../../hooks/useScheduleGroups";
import { useClientDirectory } from "../../hooks/useClients";
import { buildGroupNameById } from "../../lib/scheduleGroups";
import { resolveMutationError } from "../../lib/resolveMutationError";
import type { ToastType } from "../../App";

interface GroupSpotNotificationBannerProps {
  toast: (msg: string, type?: ToastType) => void;
}

export default function GroupSpotNotificationBanner({ toast }: GroupSpotNotificationBannerProps) {
  const { t } = useI18n();
  const { data: notifications = [] } = useGroupSpotNotifications();
  const { data: groups = [] } = useScheduleGroups();
  const { data: clients = [] } = useClientDirectory();
  const dismissNotification = useDismissGroupSpotNotification();

  const groupNameById = useMemo(() => buildGroupNameById(groups), [groups]);
  const clientMap = useMemo(() => Object.fromEntries(clients.map((c) => [c.id, c])), [clients]);

  const first = notifications[0];
  if (!first) return null;

  const client = clientMap[first.clientId];
  const clientName = client
    ? formatClientName(client.lastName, client.firstName)
    : t("groupWaitlist.unknownClient");
  const groupName = groupNameById[first.classId] ?? t("common.groupLesson");

  const handleDismiss = async () => {
    const res = await dismissNotification.mutateAsync(first.id);
    if (!res.success) {
      toast(resolveMutationError(res.error, "groupWaitlist.error.dismissFailed", t), "error");
    }
  };

  return (
    <div className="rounded-xl border border-gold-200 bg-gold-50/10 px-4 py-3 flex items-start gap-3">
      <Bell className="w-4 h-4 text-gold-700 shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-gold-900">{t("groupWaitlist.spotAvailableTitle")}</p>
        <p className="text-xs text-gold-800 mt-0.5 leading-relaxed">
          {t("groupWaitlist.spotAvailableBody", { client: clientName, group: groupName })}
        </p>
      </div>
      <button
        type="button"
        onClick={() => void handleDismiss()}
        disabled={dismissNotification.isPending}
        aria-label={t("common.close")}
        className="p-1 text-gold-500 hover:text-gold-800 rounded-full hover:bg-gold-100 cursor-pointer shrink-0 disabled:opacity-60"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
