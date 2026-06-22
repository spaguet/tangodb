import { useMemo } from "react";
import { motion } from "motion/react";
import { AlertCircle, Clock } from "lucide-react";
import { useScheduleDebtors } from "../../hooks/useScheduleDebtors";
import { usePermissions } from "../../hooks/usePermissions";
import { canReadLessonClients, maskClientDisplay } from "../../lib/scheduleLessonAccess";
import { toISODateLocal } from "../../lib/scheduleWeek";
import { formatCurrency, formatDateRu, pluralizeRu } from "../../lib/utils";
import type { ScheduleDebtorEntry } from "../../hooks/useScheduleDebtors";
import LoadingState from "../ui/LoadingState";
import QueryErrorState from "../ui/QueryErrorState";

interface ScheduleDebtorsBlockProps {
  weekStart: Date;
  weekEnd: Date;
  disciplineMap: Map<string, string>;
  teamMap: Map<string, string>;
  locationMap: Map<string, string>;
}

function DebtorRow({
  entry,
  clientLabel,
  disciplineName,
  teacherName,
  locationName,
  showAmount,
}: {
  entry: ScheduleDebtorEntry;
  clientLabel: string;
  disciplineName?: string;
  teacherName?: string;
  locationName?: string;
  showAmount: boolean;
}) {
  const metaParts = [disciplineName, teacherName, locationName].filter(Boolean);

  return (
    <li className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-3 py-2.5 border-b border-slate-100 last:border-b-0">
      <div className="min-w-0 space-y-0.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-sm font-semibold text-slate-800 truncate">{clientLabel}</span>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-rose-600">
            не оплачен
          </span>
        </div>
        <p className="text-xs text-slate-500 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span>{formatDateRu(entry.date)}</span>
          <span className="inline-flex items-center gap-1">
            <Clock className="w-3 h-3 shrink-0" />
            {entry.timeStart}–{entry.timeEnd}
          </span>
        </p>
        {metaParts.length > 0 ? (
          <p className="text-[11px] text-slate-400 truncate">{metaParts.join(" · ")}</p>
        ) : null}
      </div>
      {showAmount && entry.amount != null ? (
        <span className="text-sm font-semibold text-rose-600 shrink-0">{formatCurrency(entry.amount)}</span>
      ) : null}
    </li>
  );
}

function DebtorsList({
  rows,
  showAmount,
}: {
  rows: Array<{
    entry: ScheduleDebtorEntry;
    clientLabel: string;
    disciplineName?: string;
    teacherName?: string;
    locationName?: string;
  }>;
  showAmount: boolean;
}) {
  return (
    <ul className="divide-y divide-slate-100">
      {rows.map(({ entry, clientLabel, disciplineName, teacherName, locationName }) => (
        <DebtorRow
          key={entry.id}
          entry={entry}
          clientLabel={clientLabel}
          disciplineName={disciplineName}
          teacherName={teacherName}
          locationName={locationName}
          showAmount={showAmount}
        />
      ))}
    </ul>
  );
}

export default function ScheduleDebtorsBlock({
  weekStart,
  weekEnd,
  disciplineMap,
  teamMap,
  locationMap,
}: ScheduleDebtorsBlockProps) {
  const { role, can } = usePermissions();
  const debtorsQuery = useScheduleDebtors(weekStart, weekEnd);
  const { data: debtors = [], showAmount, isLoading, isError, error } = debtorsQuery;

  const visibleDebtors = useMemo(() => {
    return debtors.map((entry) => {
      const canReadClients = canReadLessonClients(role, {
        kind: "personal",
        lessonId: entry.id,
        date: entry.date,
        timeStart: entry.timeStart,
        timeEnd: entry.timeEnd,
        paid: "no",
        disciplineId: entry.disciplineId,
        locationId: entry.locationId,
        teacherMemberId: entry.teacherMemberId,
      }, can);

      return {
        entry,
        clientLabel: maskClientDisplay(entry.clientDisplay, canReadClients),
        disciplineName: entry.disciplineId ? disciplineMap.get(entry.disciplineId) : undefined,
        teacherName: entry.teacherMemberId ? teamMap.get(entry.teacherMemberId) : undefined,
        locationName: entry.locationId
          ? locationMap.get(entry.locationId)
          : "Без локации",
      };
    });
  }, [debtors, role, can, disciplineMap, teamMap, locationMap]);

  const weekStartISO = toISODateLocal(weekStart);
  const weekEndISO = toISODateLocal(weekEnd);

  const { thisWeekDebtors, laterDebtors } = useMemo(() => {
    const thisWeek: typeof visibleDebtors = [];
    const later: typeof visibleDebtors = [];

    for (const row of visibleDebtors) {
      if (row.entry.date >= weekStartISO && row.entry.date <= weekEndISO) {
        thisWeek.push(row);
      } else {
        later.push(row);
      }
    }

    return { thisWeekDebtors: thisWeek, laterDebtors: later };
  }, [visibleDebtors, weekStartISO, weekEndISO]);

  if (isLoading) {
    return <LoadingState label="Загрузка неоплаченных уроков..." />;
  }

  if (isError) {
    return (
      <QueryErrorState message="Не удалось загрузить неоплаченные уроки" error={error} />
    );
  }

  if (visibleDebtors.length === 0) {
    return null;
  }

  const totalAmount = showAmount
    ? visibleDebtors.reduce((sum, row) => sum + (row.entry.amount ?? 0), 0)
    : 0;
  const countLabel = `${visibleDebtors.length} ${pluralizeRu(visibleDebtors.length, [
    "урок",
    "урока",
    "уроков",
  ])}`;

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-xl border border-rose-200/80 shadow-xs overflow-hidden"
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-4 py-3 border-b border-rose-100 bg-rose-50/60">
        <div className="flex items-center gap-2 min-w-0">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-800">Неоплаченные персональные уроки</h3>
            <p className="text-[11px] text-slate-500">
              На выбранной неделе и ближайшие {Math.round(56 / 7)} нед.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-baseline justify-end gap-x-2 gap-y-0.5 text-sm shrink-0 text-right">
          <span className="font-semibold text-rose-600 tabular-nums">{countLabel}</span>
          {showAmount ? (
            <>
              <span className="text-rose-400" aria-hidden="true">
                ·
              </span>
              <span className="font-semibold text-rose-600 tabular-nums">
                {formatCurrency(totalAmount)}
              </span>
            </>
          ) : null}
        </div>
      </div>

      {thisWeekDebtors.length > 0 ? (
        <div>
          {laterDebtors.length > 0 ? (
            <p className="px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-slate-400 bg-slate-50/80 border-b border-slate-100">
              На выбранной неделе
            </p>
          ) : null}
          <DebtorsList rows={thisWeekDebtors} showAmount={showAmount} />
        </div>
      ) : null}

      {laterDebtors.length > 0 ? (
        <div>
          <p className="px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-slate-400 bg-slate-50/80 border-b border-slate-100">
            Последующие недели
          </p>
          <DebtorsList rows={laterDebtors} showAmount={showAmount} />
        </div>
      ) : null}
    </motion.section>
  );
}
