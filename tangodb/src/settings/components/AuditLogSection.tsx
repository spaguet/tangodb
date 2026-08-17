import { useMemo, useState } from "react";
import { CalendarDays, ClipboardList, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { auditTableLabel, useOrgAuditLog } from "../../hooks/useOrgAuditLog";
import { useClientDirectory } from "../../hooks/useClients";
import { memberListLabel, useTeamMembers } from "../../hooks/useTeamMembers";
import { useI18n } from "../../hooks/useI18n";
import {
  auditChangedFields,
  auditOperationLabel,
  formatAuditActor,
  formatAuditSummary,
  type AuditFormatContext,
} from "../../lib/auditLogFormat";
import { formatClientName } from "../../lib/utils";
import type { AuditLogRow } from "../../hooks/useOrgAuditLog";

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateInputValue(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function AuditLogList({
  rows,
  ctx,
  formatDateTime,
  locale,
  emptyLabel,
}: {
  rows: AuditLogRow[];
  ctx: AuditFormatContext;
  formatDateTime: ReturnType<typeof useI18n>["formatDateTime"];
  locale: string | null;
  emptyLabel: string;
}) {
  const { t } = useI18n();

  if (rows.length === 0) {
    return <p className="text-xs text-ink-500 py-2">{emptyLabel}</p>;
  }

  return (
    <div className="space-y-1 max-h-72 overflow-y-auto">
      {rows.map((row) => {
        const summary = formatAuditSummary(row, ctx);
        const details = auditChangedFields(row, ctx);
        const actor = formatAuditActor(row.changed_by, ctx);

        return (
          <div
            key={row.id}
            className="text-[11px] text-ink-500 py-2 border-b border-ink-50 last:border-0 space-y-1"
          >
            <div className="flex justify-between gap-2">
              <span className="font-semibold text-ink-700">
                {auditTableLabel(row.table_name, locale)} · {auditOperationLabel(row.operation, t)}
              </span>
              <span className="shrink-0 text-ink-500">
                {formatDateTime(row.changed_at, {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
            <p className="text-ink-500">{actor}</p>
            {summary && <p className="text-ink-700 font-medium">{summary}</p>}
            {details.length > 0 && (
              <ul className="space-y-0.5">
                {details.slice(0, 6).map((detail) => (
                  <li key={detail} className="text-ink-600">
                    {detail}
                  </li>
                ))}
                {details.length > 6 && (
                  <li className="text-ink-500">{t("team.auditMore", { count: details.length - 6 })}</li>
                )}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function AuditLogSection() {
  const { t, locale, formatDateTime } = useI18n();
  const today = useMemo(() => new Date(), []);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => toDateInputValue(new Date()));

  const { data: members = [] } = useTeamMembers();
  const { data: clients = [] } = useClientDirectory();
  const { data: todayRows = [], isLoading: todayLoading } = useOrgAuditLog({ date: today, limit: 100 });
  const modalDate = parseDateInputValue(selectedDate);
  const { data: modalRows = [], isLoading: modalLoading } = useOrgAuditLog({
    date: modalDate,
    limit: 300,
    enabled: modalOpen,
  });

  const ctx = useMemo<AuditFormatContext>(() => {
    const memberNameByUserId = new Map(
      members.map((member) => [member.user_id, memberListLabel(member, locale)])
    );
    const clientNameById = new Map(
      clients.map((client) => [client.id, formatClientName(client.lastName, client.firstName)])
    );
    return { translate: t, memberNameByUserId, clientNameById };
  }, [members, clients, t, locale]);

  return (
    <>
      <div className="bg-white rounded-xl border border-ink-200 shadow-xs p-3.5 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-sans text-sm font-semibold text-ink-800 flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-gold-500" />
            {t("team.audit")}
          </h3>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="text-[10px] font-semibold uppercase tracking-wider text-gold-700 hover:text-gold-800 hover:underline cursor-pointer whitespace-nowrap"
          >
            {t("team.auditViewAll")}
          </button>
        </div>
        {todayLoading ? (
          <p className="text-xs text-ink-500 py-2">{t("common.loading.default")}</p>
        ) : (
          <>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
              {t("team.auditToday")}
            </p>
            <AuditLogList
              rows={todayRows}
              ctx={ctx}
              formatDateTime={formatDateTime}
              locale={locale}
              emptyLabel={t("team.auditEmpty")}
            />
          </>
        )}
      </div>

      <AnimatePresence>
        {modalOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="audit-log-modal-title"
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-ink-950/40"
              onClick={() => setModalOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              className="relative w-full max-w-lg bg-white rounded-xl border border-ink-200 shadow-xl p-4 space-y-3 max-h-[85vh] flex flex-col"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 id="audit-log-modal-title" className="text-sm font-semibold text-ink-900">
                    {t("team.auditViewAll")}
                  </h3>
                  <p className="text-[11px] text-ink-500 mt-0.5">{t("team.auditModalHint")}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="p-1.5 text-ink-400 hover:text-ink-700 hover:bg-ink-100 rounded-lg cursor-pointer"
                  aria-label={t("common.close")}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <label className="flex items-center gap-2 text-xs text-ink-600">
                <CalendarDays className="w-4 h-4 text-gold-500 shrink-0" />
                <span className="font-semibold uppercase tracking-wider text-[10px] text-ink-500">
                  {t("team.auditSelectDay")}
                </span>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="ml-auto rounded-lg border border-ink-200 px-2 py-1 text-xs text-ink-700"
                />
              </label>

              <div className="flex-1 min-h-0">
                {modalLoading ? (
                  <p className="text-xs text-ink-500 py-2">{t("common.loading.default")}</p>
                ) : (
                  <AuditLogList
                    rows={modalRows}
                    ctx={ctx}
                    formatDateTime={formatDateTime}
                    locale={locale}
                    emptyLabel={t("team.auditEmpty")}
                  />
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
