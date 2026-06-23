import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { AlertCircle, Clock, Coins } from "lucide-react";
import { useScheduleDebtors } from "../../hooks/useScheduleDebtors";
import { usePermissions } from "../../hooks/usePermissions";
import { useOrganization } from "../../organization/OrganizationProvider";
import { useToast } from "../../App";
import {
  canPayPersonalLesson,
  canReadLessonClients,
  maskClientDisplay,
} from "../../lib/scheduleLessonAccess";
import { formatCurrency, formatDateRu, pluralizeRu } from "../../lib/utils";
import type { ScheduleDebtorEntry } from "../../hooks/useScheduleDebtors";
import LoadingState from "../ui/LoadingState";
import QueryErrorState from "../ui/QueryErrorState";
import PayPersonalLessonModal, { type PayPersonalLessonTarget } from "./PayPersonalLessonModal";

const NO_LOCATION_KEY = "__no_location__";

interface ScheduleDebtorsBlockProps {
  disciplineMap: Map<string, string>;
  teamMap: Map<string, string>;
  locationMap: Map<string, string>;
  locationOrder: string[];
  onPaymentSuccess?: () => void;
}

interface DebtorRowView {
  entry: ScheduleDebtorEntry;
  clientLabel: string;
  disciplineName?: string;
  teacherName?: string;
  canPay: boolean;
}

interface DebtorLocationGroup {
  key: string;
  label: string;
  items: DebtorRowView[];
}

function compareDebtorRows(a: DebtorRowView, b: DebtorRowView): number {
  return (
    a.entry.date.localeCompare(b.entry.date) ||
    a.entry.timeStart.localeCompare(b.entry.timeStart)
  );
}

function groupDebtorsByLocation(
  rows: DebtorRowView[],
  locationOrder: string[],
  locationMap: Map<string, string>
): DebtorLocationGroup[] {
  const order = [...locationOrder, NO_LOCATION_KEY];
  const groups = new Map<string, DebtorRowView[]>();
  for (const key of order) {
    groups.set(key, []);
  }

  for (const row of rows) {
    const key = row.entry.locationId ?? NO_LOCATION_KEY;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(row);
  }

  return order
    .map((key) => ({
      key,
      label:
        key === NO_LOCATION_KEY
          ? "Без локации"
          : locationMap.get(key) ?? "Локация",
      items: [...(groups.get(key) ?? [])].sort(compareDebtorRows),
    }))
    .filter((group) => group.items.length > 0);
}

function DebtorRow({
  entry,
  clientLabel,
  disciplineName,
  teacherName,
  showAmount,
  canPay,
  onPay,
}: {
  entry: ScheduleDebtorEntry;
  clientLabel: string;
  disciplineName?: string;
  teacherName?: string;
  showAmount: boolean;
  canPay: boolean;
  onPay: () => void;
}) {
  const metaParts = [disciplineName, teacherName].filter(Boolean);

  return (
    <li className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-3 py-2.5 border-b border-slate-100 last:border-b-0">
      <div className="min-w-0 space-y-0.5 flex-1">
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
      <div className="flex items-center gap-2 shrink-0">
        {showAmount && entry.amount != null ? (
          <span className="text-sm font-semibold text-rose-600 tabular-nums">{formatCurrency(entry.amount)}</span>
        ) : null}
        {canPay ? (
          <button
            type="button"
            onClick={onPay}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-sans font-semibold uppercase tracking-wider rounded-lg transition-colors cursor-pointer"
          >
            <Coins className="w-3.5 h-3.5" />
            Оплатить
          </button>
        ) : null}
      </div>
    </li>
  );
}

export default function ScheduleDebtorsBlock({
  disciplineMap,
  teamMap,
  locationMap,
  locationOrder,
  onPaymentSuccess,
}: ScheduleDebtorsBlockProps) {
  const toast = useToast();
  const { memberId } = useOrganization();
  const { role, can, isReadOnly } = usePermissions();
  const debtorsQuery = useScheduleDebtors();
  const { data: debtors = [], showAmount, isLoading, isError, error } = debtorsQuery;
  const [payTarget, setPayTarget] = useState<PayPersonalLessonTarget | null>(null);

  const visibleDebtors = useMemo(() => {
    return debtors.map((entry) => {
      const lessonContext = {
        kind: "personal" as const,
        lessonId: entry.id,
        date: entry.date,
        timeStart: entry.timeStart,
        timeEnd: entry.timeEnd,
        paid: "no" as const,
        disciplineId: entry.disciplineId,
        locationId: entry.locationId,
        teacherMemberId: entry.teacherMemberId,
      };

      const canReadClients = canReadLessonClients(role, lessonContext, can);
      const canPay = canPayPersonalLesson(role, memberId, lessonContext, can, isReadOnly);

      return {
        entry,
        clientLabel: maskClientDisplay(entry.clientDisplay, canReadClients),
        disciplineName: entry.disciplineId ? disciplineMap.get(entry.disciplineId) : undefined,
        teacherName: entry.teacherMemberId ? teamMap.get(entry.teacherMemberId) : undefined,
        canPay,
      };
    });
  }, [debtors, role, can, memberId, isReadOnly, disciplineMap, teamMap, locationMap]);

  const debtorGroups = useMemo(
    () => groupDebtorsByLocation(visibleDebtors, locationOrder, locationMap),
    [visibleDebtors, locationOrder, locationMap]
  );

  const subtitle =
    role === "teacher"
      ? "Неоплаченные уроки, которые вы проводите"
      : "Все неоплаченные уроки организации";

  if (isLoading) {
    return <LoadingState label="Загрузка неоплаченных уроков..." />;
  }

  if (isError) {
    return (
      <QueryErrorState message="Не удалось загрузить неоплаченные уроки" error={error} />
    );
  }

  if (debtorGroups.length === 0) {
    return null;
  }

  const totalCount = visibleDebtors.length;
  const totalAmount = showAmount
    ? visibleDebtors.reduce((sum, row) => sum + (row.entry.amount ?? 0), 0)
    : 0;
  const countLabel = `${totalCount} ${pluralizeRu(totalCount, [
    "урок",
    "урока",
    "уроков",
  ])}`;

  const openPayModal = (entry: ScheduleDebtorEntry) => {
    setPayTarget({
      lessonId: entry.id,
      date: entry.date,
      timeStart: entry.timeStart,
      timeEnd: entry.timeEnd,
      clientId1: entry.clientId1,
      clientId2: entry.clientId2,
      clientId3: entry.clientId3,
      clientDisplay: entry.clientDisplay,
      price: entry.amount ?? 0,
    });
  };

  return (
    <>
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
              <p className="text-[11px] text-slate-500">{subtitle}</p>
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

        <div className="divide-y divide-slate-100">
          {debtorGroups.map((group) => (
            <section key={group.key}>
              <div className="px-4 py-2 bg-slate-50/80 border-b border-slate-100">
                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  {group.label}
                </h4>
              </div>
              <ul>
                {group.items.map(({ entry, clientLabel, disciplineName, teacherName, canPay }) => (
                  <DebtorRow
                    key={entry.id}
                    entry={entry}
                    clientLabel={clientLabel}
                    disciplineName={disciplineName}
                    teacherName={teacherName}
                    showAmount={showAmount}
                    canPay={canPay}
                    onPay={() => openPayModal(entry)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      </motion.section>

      <PayPersonalLessonModal
        lesson={payTarget}
        toast={toast}
        onClose={() => setPayTarget(null)}
        onSuccess={() => {
          setPayTarget(null);
          onPaymentSuccess?.();
        }}
      />
    </>
  );
}
