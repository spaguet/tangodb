import { Loader2, Mail, RefreshCw, Users } from "lucide-react";
import { btnOpenCls, btnRefreshCls } from "../../components/ui/buttonStyles";
import LoadingState from "../../components/ui/LoadingState";
import QueryErrorState from "../../components/ui/QueryErrorState";
import { useToast } from "../../App";
import { useTeamGoogleSyncStatus } from "../../hooks/useTeamGoogleSyncStatus";
import { useI18n } from "../../hooks/useI18n";
import { resolveMutationError, isI18nKey } from "../../lib/resolveMutationError";

export default function TeamGoogleSyncSection() {
  const { t, formatDateTime } = useI18n();
  const toast = useToast();
  const { canViewTeam, members, orgMetrics, isLoading, isError, remind, retryDead, refetch } =
    useTeamGoogleSyncStatus();

  if (!canViewTeam) return null;

  const handleRemind = async (organizationMemberId: string) => {
    try {
      await remind.mutateAsync(organizationMemberId);
      toast(t("integrations.googleCalendar.team.remindSuccess"), "success");
    } catch (err) {
      const code = err instanceof Error ? err.message : undefined;
      const codeKey = code
        ? (`integrations.googleCalendar.team.remindError.${code}` as const)
        : null;
      toast(
        resolveMutationError(
          codeKey && isI18nKey(codeKey) ? codeKey : code,
          "integrations.googleCalendar.team.remindError",
          t
        ),
        "error"
      );
    }
  };

  const handleRetryDead = async () => {
    try {
      const result = await retryDead.mutateAsync();
      toast(
        t("integrations.googleCalendar.team.retryDeadSuccess", {
          count: String(result.requeued),
        }),
        "success"
      );
    } catch {
      toast(t("integrations.googleCalendar.team.retryDeadError"), "error");
    }
  };

  const deadCount = Number(orgMetrics?.dead_count ?? 0);

  return (
    <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <Users className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              {t("integrations.googleCalendar.team.title")}
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              {t("integrations.googleCalendar.team.subtitle")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {deadCount > 0 && (
            <button
              type="button"
              onClick={() => void handleRetryDead()}
              disabled={retryDead.isPending}
              className={btnOpenCls}
            >
              {retryDead.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                t("integrations.googleCalendar.team.retryDead")
              )}
            </button>
          )}
          <button
            type="button"
            onClick={() => void refetch()}
            className={btnRefreshCls}
            aria-label={t("common.refresh")}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {orgMetrics && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
            <p className="text-slate-500">{t("integrations.googleCalendar.team.queuePending")}</p>
            <p className="font-semibold text-slate-800">
              {(orgMetrics.pending_count ?? 0) + (orgMetrics.retry_count ?? 0)}
            </p>
          </div>
          <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
            <p className="text-slate-500">{t("integrations.googleCalendar.team.queueProcessing")}</p>
            <p className="font-semibold text-slate-800">{orgMetrics.processing_count ?? 0}</p>
          </div>
          <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
            <p className="text-slate-500">{t("integrations.googleCalendar.team.queueDead")}</p>
            <p className="font-semibold text-slate-800">{orgMetrics.dead_count ?? 0}</p>
          </div>
          <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
            <p className="text-slate-500">{t("integrations.googleCalendar.team.oldestPending")}</p>
            <p className="font-semibold text-slate-800 truncate">
              {orgMetrics.oldest_pending_at
                ? formatDateTime(orgMetrics.oldest_pending_at)
                : "—"}
            </p>
          </div>
        </div>
      )}

      {isLoading ? (
        <LoadingState label={t("integrations.googleCalendar.team.loading")} />
      ) : isError ? (
        <QueryErrorState onRetry={() => void refetch()} />
      ) : members.length === 0 ? (
        <p className="text-xs text-slate-500">{t("integrations.googleCalendar.team.empty")}</p>
      ) : (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full min-w-[32rem] text-xs">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-100">
                <th className="py-2 px-2 font-medium">{t("integrations.googleCalendar.team.member")}</th>
                <th className="py-2 px-2 font-medium">{t("integrations.googleCalendar.team.connected")}</th>
                <th className="py-2 px-2 font-medium">{t("integrations.googleCalendar.team.lastSync")}</th>
                <th className="py-2 px-2 font-medium">{t("integrations.googleCalendar.team.pendingFailed")}</th>
                <th className="py-2 px-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const pendingTotal =
                  Number(member.pending_jobs_count ?? 0) + Number(member.dead_jobs_count ?? 0);
                const failedLinks = Number(member.failed_links_count ?? 0);
                const showRemind = !member.has_active_binding;

                return (
                  <tr key={member.organization_member_id} className="border-b border-slate-50">
                    <td className="py-2.5 px-2 font-medium text-slate-800">{member.member_name}</td>
                    <td className="py-2.5 px-2">
                      {member.has_active_binding
                        ? t("integrations.googleCalendar.team.yes")
                        : t("integrations.googleCalendar.team.no")}
                    </td>
                    <td className="py-2.5 px-2 text-slate-600">
                      {member.binding_last_success_at
                        ? formatDateTime(member.binding_last_success_at)
                        : "—"}
                      {member.binding_last_error_code && (
                        <span className="block text-rose-600 mt-0.5">
                          {member.binding_last_error_code}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-2 text-slate-600">
                      {pendingTotal > 0 || failedLinks > 0
                        ? t("integrations.googleCalendar.team.pendingFailedCounts", {
                            pending: pendingTotal,
                            failed: failedLinks,
                          })
                        : "—"}
                    </td>
                    <td className="py-2.5 px-2 text-right">
                      {showRemind && (
                        <button
                          type="button"
                          onClick={() => void handleRemind(member.organization_member_id)}
                          disabled={remind.isPending}
                          className={btnOpenCls}
                        >
                          {remind.isPending ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Mail className="w-3.5 h-3.5" />
                          )}
                          {t("integrations.googleCalendar.team.remind")}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
