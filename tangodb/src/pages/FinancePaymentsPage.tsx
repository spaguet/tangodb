import { useMemo, useState } from "react";
import { ChevronDown, Landmark, Pencil, Search } from "lucide-react";
import LoadingState from "../components/ui/LoadingState";
import QueryErrorState from "../components/ui/QueryErrorState";
import AppSelect, { searchFieldCls } from "../components/ui/AppSelect";
import DatePickerField from "../components/ui/DatePickerField";
import PaymentCorrectionDialog from "../components/finance/PaymentCorrectionDialog";
import {
  getPaymentMethodLabel,
  paymentSourceLabel,
} from "../hooks/usePayments";
import { usePaymentsWithCorrections } from "../hooks/usePaymentCorrections";
import { usePermissions } from "../hooks/usePermissions";
import { memberListLabel, useTeamMembers } from "../hooks/useTeamMembers";
import { usePersonalLessons } from "../hooks/usePersonalLessons";
import { useSchedule } from "../hooks/useSchedule";
import { useSubscriptionGroups } from "../hooks/useSubscriptionGroups";
import { useSingleVisits } from "../hooks/useSingleVisits";
import { useI18n } from "../hooks/useI18n";
import { useAccessibleLocations } from "../hooks/useLocations";
import { useRentalPayments } from "../hooks/useRentalPayments";
import {
  aggregateRentalMoneyRegisterStats,
  buildClassLocationMap,
  buildClassTeacherMap,
  resolvePaymentLocationId,
  resolvePaymentTeacherId,
  type TeacherRevenueContext,
} from "../lib/financeReports";
import {
  aggregateEffectivePaymentTotal,
  paymentCorrectionReasonLabelKey,
  paymentEffectiveAmount,
  paymentStatusLabelKey,
  type PaymentWithCorrectionMeta,
} from "../lib/paymentCorrection";
import { formatCurrency, formatMonthTitle } from "../lib/utils";
import type { PaymentMethod, RentalMoneyRegisterEntry } from "../types";

type PaymentSourceFilter = "all" | "subscription" | "personal_lesson" | "single_visit" | "rental";
type PaymentMethodFilter = "all" | PaymentMethod;

const PAYMENT_METHODS: PaymentMethod[] = ["cash", "transfer", "card", "other"];

interface MonthRentalGroup {
  yearMonth: string;
  payments: RentalMoneyRegisterEntry[];
  paymentCount: number;
  paymentSum: number;
}

function rentalYearMonth(payment: RentalMoneyRegisterEntry): string {
  const d = new Date(payment.createdAt);
  if (Number.isNaN(d.getTime())) return "unknown";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function groupRentalsByMonth(items: RentalMoneyRegisterEntry[]): MonthRentalGroup[] {
  const map = new Map<string, RentalMoneyRegisterEntry[]>();
  for (const payment of items) {
    const key = rentalYearMonth(payment);
    const list = map.get(key) ?? [];
    list.push(payment);
    map.set(key, list);
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([yearMonth, payments]) => ({
      yearMonth,
      payments,
      paymentCount: payments.filter((p) => p.signedAmount > 0).length,
      paymentSum: payments.reduce((sum, p) => sum + p.signedAmount, 0),
    }));
}

interface MonthPaymentGroup {
  yearMonth: string;
  payments: PaymentWithCorrectionMeta[];
  paymentCount: number;
  paymentSum: number;
  refundCount: number;
  refundSum: number;
}

function paymentYearMonth(payment: PaymentWithCorrectionMeta): string {
  const d = new Date(payment.createdAt);
  if (Number.isNaN(d.getTime())) return "unknown";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function groupPaymentsByMonth(items: PaymentWithCorrectionMeta[]): MonthPaymentGroup[] {
  const map = new Map<string, PaymentWithCorrectionMeta[]>();
  for (const payment of items) {
    const key = paymentYearMonth(payment);
    const list = map.get(key) ?? [];
    list.push(payment);
    map.set(key, list);
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([yearMonth, payments]) => {
      let paymentCount = 0;
      let paymentSum = 0;
      let refundCount = 0;
      let refundSum = 0;
      for (const payment of payments) {
        if (payment.operationKind === "storno") {
          refundCount += 1;
          refundSum += payment.amount;
        } else {
          paymentCount += 1;
          paymentSum += payment.amount;
        }
      }
      return { yearMonth, payments, paymentCount, paymentSum, refundCount, refundSum };
    });
}

function PaymentDetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 font-sans">{label}</dt>
      <dd className="text-xs text-slate-700 font-sans mt-0.5 break-words">{value}</dd>
    </div>
  );
}

function resolveDisplayPayment(
  payment: PaymentWithCorrectionMeta,
  paymentById: Map<string, PaymentWithCorrectionMeta>
): PaymentWithCorrectionMeta {
  if (payment.operationKind !== "storno" || !payment.reversesPaymentId) return payment;
  const original = paymentById.get(payment.reversesPaymentId);
  if (!original) return payment;
  return {
    ...payment,
    subscriptionId: payment.subscriptionId ?? original.subscriptionId,
    personalLessonId: payment.personalLessonId ?? original.personalLessonId,
    singleVisitId: payment.singleVisitId ?? original.singleVisitId,
  };
}

function PaymentRow({
  payment,
  formatDateTime,
  translate,
  canCorrect,
  onCorrect,
  teacherCtx,
  locationNameById,
  memberNameById,
  expanded,
  onToggle,
}: {
  payment: PaymentWithCorrectionMeta;
  formatDateTime: ReturnType<typeof useI18n>["formatDateTime"];
  translate: ReturnType<typeof useI18n>["t"];
  canCorrect: boolean;
  onCorrect: (payment: PaymentWithCorrectionMeta) => void;
  teacherCtx: TeacherRevenueContext;
  locationNameById: Map<string, string>;
  memberNameById: Map<string, string>;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isRefund = payment.operationKind === "storno";
  const effective = paymentEffectiveAmount(payment);
  const statusKey = payment.correctionStatus ? paymentStatusLabelKey(payment.correctionStatus) : null;
  const teacherId = resolvePaymentTeacherId(payment, teacherCtx);
  const teacherName = teacherId ? teacherCtx.teacherLabels.get(teacherId) ?? "—" : "—";
  const locationId = resolvePaymentLocationId(payment, teacherCtx);
  const locationName = locationId ? locationNameById.get(locationId) ?? "—" : "—";
  const acceptedBy = payment.createdBy
    ? memberNameById.get(payment.createdBy) ?? translate("team.auditSystem")
    : translate("team.auditSystem");
  const acceptedAt = formatDateTime(payment.createdAt, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const sourceLabel = paymentSourceLabel(payment, translate);
  const methodLabel = getPaymentMethodLabel(payment.method, translate);
  const amountLabel = `${isRefund ? "−" : ""}${formatCurrency(Math.abs(effective))}`;
  const reasonKey = paymentCorrectionReasonLabelKey(payment.correctionReasonCode ?? null);
  const reasonParts = [
    reasonKey ? translate(reasonKey as Parameters<typeof translate>[0]) : null,
    payment.correctionComment?.trim() || null,
  ].filter(Boolean);
  const reasonLabel = reasonParts.length > 0 ? reasonParts.join(" · ") : "—";

  return (
    <div className="border-b border-slate-100 last:border-b-0">
      <div className="grid grid-cols-[1fr_auto] sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto_auto_auto] gap-2 sm:gap-3 items-center px-3 py-3">
        <button
          type="button"
          onClick={onToggle}
          className="min-w-0 text-left cursor-pointer"
          aria-expanded={expanded}
        >
          <div className="flex items-start gap-2">
            <ChevronDown
              className={`w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5 transition-transform duration-200 ${
                expanded ? "rotate-180" : ""
              }`}
            />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-800 truncate">{payment.clientDisplay || "—"}</p>
              <p className="text-[10px] text-slate-400 font-sans mt-0.5">{acceptedAt}</p>
              {isRefund ? (
                <p className="text-[10px] text-rose-600 mt-0.5 font-semibold">
                  {translate("finance.payments.refundBadge")}
                </p>
              ) : statusKey ? (
                <p className="text-[10px] text-slate-500 mt-0.5">
                  {translate(statusKey as Parameters<typeof translate>[0])}
                </p>
              ) : null}
            </div>
          </div>
        </button>
        <button
          type="button"
          onClick={onToggle}
          className="text-xs text-slate-500 font-sans hidden sm:block text-left cursor-pointer"
        >
          {isRefund ? translate("finance.payments.refundBadge") : sourceLabel}
        </button>
        <button
          type="button"
          onClick={onToggle}
          className="text-xs text-slate-500 font-sans hidden sm:block text-left cursor-pointer"
        >
          {methodLabel}
        </button>
        <button
          type="button"
          onClick={onToggle}
          className={`text-sm font-sans font-semibold text-right whitespace-nowrap cursor-pointer ${
            isRefund ? "text-rose-600" : "text-indigo-700"
          }`}
        >
          {amountLabel}
        </button>
        {canCorrect &&
          !isRefund &&
          payment.correctionStatus !== "voided" &&
          payment.correctionStatus !== "replaced" && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onCorrect(payment);
              }}
              aria-label={translate("common.edit")}
              title={translate("common.edit")}
              className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg border border-slate-200 bg-white cursor-pointer transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          )}
      </div>
      {expanded && (
        <div className="px-3 pb-3 pt-0 ml-5 sm:ml-6">
          <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-3 p-3 rounded-lg bg-slate-50/80 border border-slate-100">
            {isRefund ? (
              <>
                <PaymentDetailItem
                  label={translate("common.client")}
                  value={payment.clientDisplay || "—"}
                />
                <PaymentDetailItem label={translate("finance.payments.refundDate")} value={acceptedAt} />
                <PaymentDetailItem label={translate("finance.payments.refundBy")} value={acceptedBy} />
                <PaymentDetailItem label={translate("finance.payments.refundMethod")} value={methodLabel} />
                <PaymentDetailItem label={translate("finance.payments.refundAmount")} value={amountLabel} />
                <PaymentDetailItem label={translate("finance.payments.refundReason")} value={reasonLabel} />
                <PaymentDetailItem label={translate("common.source")} value={sourceLabel} />
                {payment.methodComment ? (
                  <PaymentDetailItem
                    label={translate("finance.payments.methodComment")}
                    value={payment.methodComment}
                  />
                ) : null}
              </>
            ) : (
              <>
                <PaymentDetailItem
                  label={translate("common.clientDate")}
                  value={`${payment.clientDisplay || "—"} · ${acceptedAt}`}
                />
                <PaymentDetailItem label={translate("common.source")} value={sourceLabel} />
                <PaymentDetailItem label={translate("common.method")} value={methodLabel} />
                <PaymentDetailItem label={translate("common.amount")} value={amountLabel} />
                <PaymentDetailItem label={translate("schedule.form.teacher")} value={teacherName} />
                <PaymentDetailItem label={translate("schedule.form.location")} value={locationName} />
                <PaymentDetailItem label={translate("finance.payments.acceptedBy")} value={acceptedBy} />
                <PaymentDetailItem label={translate("finance.payments.acceptedAt")} value={acceptedAt} />
                {statusKey ? (
                  <PaymentDetailItem
                    label={translate("finance.payments.status")}
                    value={translate(statusKey as Parameters<typeof translate>[0])}
                  />
                ) : null}
                {payment.methodComment ? (
                  <PaymentDetailItem
                    label={translate("finance.payments.methodComment")}
                    value={payment.methodComment}
                  />
                ) : null}
              </>
            )}
          </dl>
        </div>
      )}
    </div>
  );
}

function rentalEntryTypeLabel(
  entryType: RentalMoneyRegisterEntry["entryType"],
  translate: ReturnType<typeof useI18n>["t"]
): string {
  const key = `finance.rentalRegister.type.${entryType}` as Parameters<typeof translate>[0];
  return translate(key);
}

function RentalPaymentRow({
  payment,
  formatDateTime,
  translate,
  locationNameById,
  expanded,
  onToggle,
}: {
  payment: RentalMoneyRegisterEntry;
  formatDateTime: ReturnType<typeof useI18n>["formatDateTime"];
  translate: ReturnType<typeof useI18n>["t"];
  locationNameById: Map<string, string>;
  expanded: boolean;
  onToggle: () => void;
}) {
  const acceptedAt = formatDateTime(payment.createdAt, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const methodLabel = getPaymentMethodLabel(payment.method, translate);
  const locationName = payment.locationId ? locationNameById.get(payment.locationId) ?? "—" : "—";
  const rentalDate = payment.rentalDate ?? "—";
  const sourceLabel = rentalEntryTypeLabel(payment.entryType, translate);
  const isOutflow = payment.signedAmount < 0;

  return (
    <div className="border-b border-slate-100 last:border-b-0">
      <div className="grid grid-cols-[1fr_auto] sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto_auto] gap-2 sm:gap-3 items-center px-3 py-3">
        <button type="button" onClick={onToggle} className="min-w-0 text-left cursor-pointer" aria-expanded={expanded}>
          <div className="flex items-start gap-2">
            <ChevronDown
              className={`w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5 transition-transform duration-200 ${
                expanded ? "rotate-180" : ""
              }`}
            />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-800 truncate">{payment.renterDisplay || "—"}</p>
              <p className="text-[10px] text-slate-400 font-sans mt-0.5">{acceptedAt}</p>
            </div>
          </div>
        </button>
        <button type="button" onClick={onToggle} className="text-xs text-slate-500 font-sans hidden sm:block text-left cursor-pointer">
          {sourceLabel}
        </button>
        <button type="button" onClick={onToggle} className="text-xs text-slate-500 font-sans hidden sm:block text-left cursor-pointer">
          {methodLabel}
        </button>
        <button
          type="button"
          onClick={onToggle}
          className={`text-sm font-sans font-semibold text-right whitespace-nowrap cursor-pointer ${
            isOutflow ? "text-rose-600" : "text-amber-700"
          }`}
        >
          {isOutflow ? "−" : ""}
          {formatCurrency(Math.abs(payment.signedAmount))}
        </button>
      </div>
      {expanded ? (
        <div className="px-3 pb-3 pt-0 border-t border-slate-50 bg-slate-50/40">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 px-8 py-2">
            <PaymentDetailItem label={translate("finance.payments.acceptedAt")} value={acceptedAt} />
            <PaymentDetailItem label={translate("common.source")} value={sourceLabel} />
            <PaymentDetailItem label={translate("common.method")} value={methodLabel} />
            {payment.rentalDate ? (
              <PaymentDetailItem label={translate("schedule.rental.dateLabel")} value={rentalDate} />
            ) : null}
            {payment.locationId ? (
              <PaymentDetailItem label={translate("schedule.form.location")} value={locationName} />
            ) : null}
            {payment.methodComment ? (
              <PaymentDetailItem label={translate("finance.payments.methodComment")} value={payment.methodComment} />
            ) : null}
          </dl>
        </div>
      ) : null}
    </div>
  );
}

function matchesSourceFilter(payment: PaymentWithCorrectionMeta, source: PaymentSourceFilter): boolean {
  if (source === "all" || source === "rental") return source === "all";
  if (source === "subscription") return payment.subscriptionId != null;
  if (source === "personal_lesson") return payment.personalLessonId != null;
  return payment.singleVisitId != null;
}

export default function FinancePaymentsPage() {
  const { t, locale, formatDateTime, plural } = useI18n();
  const { can } = usePermissions();
  const canCorrectPayments = can("finance.read");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sourceFilter, setSourceFilter] = useState<PaymentSourceFilter>("all");
  const [methodFilter, setMethodFilter] = useState<PaymentMethodFilter>("all");
  const [teacherFilter, setTeacherFilter] = useState("all");
  const [correctionTarget, setCorrectionTarget] = useState<PaymentWithCorrectionMeta | null>(null);
  const [expandedPaymentId, setExpandedPaymentId] = useState<string | null>(null);
  const [expandedRentalId, setExpandedRentalId] = useState<string | null>(null);
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(() => new Set());
  const [expandedRentalMonths, setExpandedRentalMonths] = useState<Set<string>>(() => new Set());
  const [toastMsg, setToastMsg] = useState<{ msg: string; type: "success" | "error" | "info" } | null>(null);

  const toast = (msg: string, type: "success" | "error" | "info" = "success") => {
    setToastMsg({ msg, type });
    window.setTimeout(() => setToastMsg(null), 4000);
  };

  const paymentsQuery = usePaymentsWithCorrections(
    dateFrom || dateTo ? { dateFrom: dateFrom || undefined, dateTo: dateTo || undefined } : undefined
  );
  const rentalPaymentsQuery = useRentalPayments(
    dateFrom || dateTo ? { dateFrom: dateFrom || undefined, dateTo: dateTo || undefined } : undefined
  );
  const teamQuery = useTeamMembers();
  const personalLessonsQuery = usePersonalLessons();
  const singleVisitsQuery = useSingleVisits();
  const scheduleQuery = useSchedule();
  const subscriptionGroupsQuery = useSubscriptionGroups();
  const locationsQuery = useAccessibleLocations();

  const memberNameById = useMemo(
    () =>
      new Map((teamQuery.data ?? []).map((member) => [member.id, memberListLabel(member, locale)])),
    [teamQuery.data, locale]
  );

  const locationNameById = useMemo(
    () => new Map(locationsQuery.locations.map((loc) => [loc.id, loc.name])),
    [locationsQuery.locations]
  );

  const teacherOptions = useMemo(
    () =>
      (teamQuery.data ?? [])
        .filter((member) => member.is_active)
        .map((member) => ({ id: member.id, label: memberListLabel(member, locale) }))
        .sort((a, b) => a.label.localeCompare(b.label, locale)),
    [teamQuery.data, locale]
  );

  const teacherCtx = useMemo((): TeacherRevenueContext => {
    const personalLessonById = new Map(
      (personalLessonsQuery.data ?? []).map((lesson) => [lesson.id, lesson])
    );
    const singleVisitById = new Map((singleVisitsQuery.data ?? []).map((visit) => [visit.id, visit]));
    return {
      personalLessonById,
      singleVisitById,
      groupsBySubId: subscriptionGroupsQuery.groupsBySubId,
      classTeacherByGroupId: buildClassTeacherMap(scheduleQuery.data ?? []),
      classLocationByGroupId: buildClassLocationMap(scheduleQuery.data ?? []),
      teacherLabels: memberNameById,
    };
  }, [
    personalLessonsQuery.data,
    singleVisitsQuery.data,
    subscriptionGroupsQuery.groupsBySubId,
    scheduleQuery.data,
    memberNameById,
  ]);

  const paymentById = useMemo(() => {
    const map = new Map<string, PaymentWithCorrectionMeta>();
    for (const payment of paymentsQuery.data ?? []) {
      map.set(payment.id, payment);
    }
    return map;
  }, [paymentsQuery.data]);

  const showClientPayments = sourceFilter !== "rental";
  const showRentalPayments =
    (sourceFilter === "all" || sourceFilter === "rental") && teacherFilter === "all";

  const filtered = useMemo(() => {
    if (!showClientPayments) return [];

    let items = (paymentsQuery.data ?? []).map((payment) =>
      resolveDisplayPayment(payment, paymentById)
    );

    if (sourceFilter !== "all") {
      items = items.filter((p) => matchesSourceFilter(p, sourceFilter));
    }
    if (methodFilter !== "all") {
      items = items.filter((p) => p.method === methodFilter);
    }
    if (teacherFilter !== "all") {
      items = items.filter((p) => resolvePaymentTeacherId(p, teacherCtx) === teacherFilter);
    }

    const q = search.trim().toLowerCase();
    if (q) {
      items = items.filter((p) => p.clientDisplay.toLowerCase().includes(q));
    }

    return items;
  }, [
    paymentsQuery.data,
    paymentById,
    sourceFilter,
    methodFilter,
    teacherFilter,
    teacherCtx,
    search,
    showClientPayments,
  ]);

  const filteredRentals = useMemo(() => {
    if (!showRentalPayments) return [];

    let items = rentalPaymentsQuery.data ?? [];
    if (methodFilter !== "all") {
      items = items.filter((p) => p.method === methodFilter);
    }

    const q = search.trim().toLowerCase();
    if (q) {
      items = items.filter((p) => (p.renterDisplay ?? "").toLowerCase().includes(q));
    }

    return items;
  }, [rentalPaymentsQuery.data, methodFilter, search, showRentalPayments]);

  const monthGroups = useMemo(() => groupPaymentsByMonth(filtered), [filtered]);
  const rentalMonthGroups = useMemo(() => groupRentalsByMonth(filteredRentals), [filteredRentals]);

  const toggleMonth = (yearMonth: string) => {
    setExpandedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(yearMonth)) next.delete(yearMonth);
      else next.add(yearMonth);
      return next;
    });
  };

  const toggleRentalMonth = (yearMonth: string) => {
    setExpandedRentalMonths((prev) => {
      const next = new Set(prev);
      if (next.has(yearMonth)) next.delete(yearMonth);
      else next.add(yearMonth);
      return next;
    });
  };

  const contextLoading =
    teacherFilter !== "all" &&
    (teamQuery.isLoading ||
      personalLessonsQuery.isLoading ||
      singleVisitsQuery.isLoading ||
      scheduleQuery.isLoading ||
      subscriptionGroupsQuery.isLoading);

  if (paymentsQuery.isLoading || rentalPaymentsQuery.isLoading || contextLoading) {
    return <LoadingState label={t("finance.payments.loading")} />;
  }
  if (paymentsQuery.isError) return <QueryErrorState error={paymentsQuery.error} />;
  if (rentalPaymentsQuery.isError) return <QueryErrorState error={rentalPaymentsQuery.error} />;

  const clientTotal = aggregateEffectivePaymentTotal(filtered);
  const rentalTotal = aggregateRentalMoneyRegisterStats(filteredRentals).grossInflow;
  const combinedTotal = clientTotal + rentalTotal;
  const hasAnyClientPayments = (paymentsQuery.data?.length ?? 0) > 0;
  const hasAnyRentalPayments = (rentalPaymentsQuery.data?.length ?? 0) > 0;
  const hasAnyPayments = hasAnyClientPayments || hasAnyRentalPayments;
  const visibleCount = filtered.length + filteredRentals.length;
  const hasActiveFilters =
    Boolean(dateFrom || dateTo) ||
    sourceFilter !== "all" ||
    methodFilter !== "all" ||
    teacherFilter !== "all" ||
    search.trim().length > 0;

  return (
    <div className="panel-page-stack">
      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2">
            <Landmark className="w-4 h-4 text-indigo-500" />
            <h2 className="font-sans text-sm font-semibold text-slate-800">{t("finance.payments.title")}</h2>
          </div>
          <div className="relative max-w-xs w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("finance.payments.search")}
              className={searchFieldCls}
            />
          </div>
        </div>

        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/40">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <DatePickerField
              label={t("common.dateFrom")}
              value={dateFrom}
              onChange={setDateFrom}
              className="min-w-0"
            />
            <DatePickerField
              label={t("common.dateTo")}
              value={dateTo}
              onChange={setDateTo}
              min={dateFrom || undefined}
              className="min-w-0"
            />
            <AppSelect
              label={t("schedule.form.teacher")}
              value={teacherFilter}
              onChange={(e) => setTeacherFilter(e.target.value)}
            >
              <option value="all">{t("common.allTeachers")}</option>
              {teacherOptions.map((teacher) => (
                <option key={teacher.id} value={teacher.id}>
                  {teacher.label}
                </option>
              ))}
            </AppSelect>
            <AppSelect
              label={t("common.source")}
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value as PaymentSourceFilter)}
            >
              <option value="all">{t("common.all")}</option>
              <option value="subscription">{t("common.payment.source.subscription")}</option>
              <option value="personal_lesson">{t("common.payment.source.personalLesson")}</option>
              <option value="single_visit">{t("common.payment.source.singleVisit")}</option>
              <option value="rental">{t("common.payment.source.rental")}</option>
            </AppSelect>
            <AppSelect
              label={t("common.method")}
              value={methodFilter}
              onChange={(e) => setMethodFilter(e.target.value as PaymentMethodFilter)}
            >
              <option value="all">{t("common.all")}</option>
              {PAYMENT_METHODS.map((method) => (
                <option key={method} value={method}>
                  {getPaymentMethodLabel(method, t)}
                </option>
              ))}
            </AppSelect>
          </div>
        </div>

        {visibleCount === 0 ? (
          <div className="py-20 text-center">
            <Landmark className="w-8 h-8 text-slate-300 mx-auto mb-3" />
            <p className="text-sm text-slate-500">
              {hasAnyPayments && hasActiveFilters
                ? t("finance.payments.emptyFiltered")
                : sourceFilter === "rental"
                  ? t("finance.payments.rentalEmpty")
                  : t("finance.payments.empty")}
            </p>
          </div>
        ) : (
          <>
            {showClientPayments && filtered.length > 0 ? (
              <div>
                {monthGroups.map((group) => {
                const open = expandedMonths.has(group.yearMonth);
                const monthTitle =
                  group.yearMonth === "unknown"
                    ? "—"
                    : formatMonthTitle(group.yearMonth, locale);
                const paymentCountLabel = `${group.paymentCount} ${plural(group.paymentCount, [
                  t("common.payment.one"),
                  t("common.payment.few"),
                  t("common.payment.many"),
                ])}`;
                const refundCountLabel = `${group.refundCount} ${plural(group.refundCount, [
                  t("finance.payments.refund.one"),
                  t("finance.payments.refund.few"),
                  t("finance.payments.refund.many"),
                ])}`;

                return (
                  <section key={group.yearMonth} className="border-b border-slate-100 last:border-b-0">
                    <button
                      type="button"
                      onClick={() => toggleMonth(group.yearMonth)}
                      aria-expanded={open}
                      className="w-full flex items-start sm:items-center justify-between gap-3 px-4 py-3 text-left cursor-pointer hover:bg-slate-50/80 transition-colors"
                    >
                      <div className="min-w-0 space-y-1">
                        <p className="text-sm font-semibold text-slate-800">{monthTitle}</p>
                        <p className="text-[11px] text-slate-500 font-sans">
                          <span>
                            {paymentCountLabel}
                            {" · "}
                            {formatCurrency(group.paymentSum)}
                          </span>
                          {group.refundCount > 0 ? (
                            <span className="text-rose-600">
                              {" · "}
                              {refundCountLabel}
                              {" · −"}
                              {formatCurrency(group.refundSum)}
                            </span>
                          ) : null}
                        </p>
                      </div>
                      <ChevronDown
                        className={`w-4 h-4 text-slate-400 shrink-0 mt-0.5 transition-transform duration-200 ${
                          open ? "rotate-180" : ""
                        }`}
                      />
                    </button>

                    {open ? (
                      <div className="border-t border-slate-100">
                        <div className="hidden sm:grid sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto_auto] gap-3 px-3 py-2 bg-slate-50 border-b border-slate-100 text-[10px] uppercase tracking-wider font-semibold text-slate-400 font-sans">
                          <span>{t("common.clientDate")}</span>
                          <span>{t("common.source")}</span>
                          <span>{t("common.method")}</span>
                          <span className="text-right">{t("common.amount")}</span>
                        </div>
                        <div>
                          {group.payments.map((p) => (
                            <PaymentRow
                              key={p.id}
                              payment={p}
                              formatDateTime={formatDateTime}
                              translate={t}
                              canCorrect={canCorrectPayments}
                              onCorrect={setCorrectionTarget}
                              teacherCtx={teacherCtx}
                              locationNameById={locationNameById}
                              memberNameById={memberNameById}
                              expanded={expandedPaymentId === p.id}
                              onToggle={() =>
                                setExpandedPaymentId((prev) => (prev === p.id ? null : p.id))
                              }
                            />
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </section>
                );
              })}
              </div>
            ) : null}

            {showRentalPayments && filteredRentals.length > 0 ? (
              <div className={showClientPayments && filtered.length > 0 ? "border-t border-slate-200" : ""}>
                {showClientPayments && filtered.length > 0 ? (
                  <div className="px-4 py-2 bg-amber-50/60 border-b border-amber-100">
                    <p className="text-xs font-semibold text-amber-800">{t("finance.payments.rentalSection")}</p>
                  </div>
                ) : null}
                {rentalMonthGroups.map((group) => {
                  const open = expandedRentalMonths.has(group.yearMonth);
                  const monthTitle =
                    group.yearMonth === "unknown" ? "—" : formatMonthTitle(group.yearMonth, locale);
                  const paymentCountLabel = `${group.paymentCount} ${plural(group.paymentCount, [
                    t("common.payment.one"),
                    t("common.payment.few"),
                    t("common.payment.many"),
                  ])}`;

                  return (
                    <section key={`rental-${group.yearMonth}`} className="border-b border-slate-100 last:border-b-0">
                      <button
                        type="button"
                        onClick={() => toggleRentalMonth(group.yearMonth)}
                        aria-expanded={open}
                        className="w-full flex items-start sm:items-center justify-between gap-3 px-4 py-3 text-left cursor-pointer hover:bg-slate-50/80 transition-colors"
                      >
                        <div className="min-w-0 space-y-1">
                          <p className="text-sm font-semibold text-slate-800">{monthTitle}</p>
                          <p className="text-[11px] text-slate-500 font-sans">
                            {paymentCountLabel}
                            {" · "}
                            {formatCurrency(group.paymentSum)}
                          </p>
                        </div>
                        <ChevronDown
                          className={`w-4 h-4 text-slate-400 shrink-0 mt-0.5 transition-transform duration-200 ${
                            open ? "rotate-180" : ""
                          }`}
                        />
                      </button>

                      {open ? (
                        <div className="border-t border-slate-100">
                          <div className="hidden sm:grid sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto_auto] gap-3 px-3 py-2 bg-slate-50 border-b border-slate-100 text-[10px] uppercase tracking-wider font-semibold text-slate-400 font-sans">
                            <span>{t("schedule.rental.renterLabel")}</span>
                            <span>{t("common.source")}</span>
                            <span>{t("common.method")}</span>
                            <span className="text-right">{t("common.amount")}</span>
                          </div>
                          <div>
                            {group.payments.map((p) => (
                              <RentalPaymentRow
                                key={p.id}
                                payment={p}
                                formatDateTime={formatDateTime}
                                translate={t}
                                locationNameById={locationNameById}
                                expanded={expandedRentalId === p.id}
                                onToggle={() =>
                                  setExpandedRentalId((prev) => (prev === p.id ? null : p.id))
                                }
                              />
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </section>
                  );
                })}
              </div>
            ) : null}

            <div className="px-4 py-3 border-t border-slate-100 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 bg-slate-50/60">
              <span className="text-xs text-slate-500 font-sans">
                {plural(visibleCount, [
                  t("common.records.one", { count: visibleCount }),
                  t("common.records.few", { count: visibleCount }),
                  t("common.records.many", { count: visibleCount }),
                ])}
              </span>
              <div className="text-sm font-sans font-semibold text-slate-800 text-right space-y-0.5">
                {showClientPayments && showRentalPayments && filtered.length > 0 && filteredRentals.length > 0 ? (
                  <>
                    <p className="text-xs font-normal text-slate-500">
                      {t("finance.payments.clientSubtotal", { amount: formatCurrency(clientTotal) })}
                    </p>
                    <p className="text-xs font-normal text-slate-500">
                      {t("finance.payments.rentalSubtotal", { amount: formatCurrency(rentalTotal) })}
                    </p>
                  </>
                ) : null}
                <p>{t("finance.payments.total", { amount: formatCurrency(combinedTotal) })}</p>
              </div>
            </div>
          </>
        )}
      </div>
      {toastMsg && (
        <div
          className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-[80] px-4 py-2 rounded-xl text-sm shadow-lg ${
            toastMsg.type === "error"
              ? "bg-rose-600 text-white"
              : toastMsg.type === "info"
                ? "bg-slate-700 text-white"
                : "bg-indigo-600 text-white"
          }`}
        >
          {toastMsg.msg}
        </div>
      )}
      <PaymentCorrectionDialog
        payment={correctionTarget}
        open={correctionTarget != null}
        onClose={() => setCorrectionTarget(null)}
        toast={toast}
      />
    </div>
  );
}
