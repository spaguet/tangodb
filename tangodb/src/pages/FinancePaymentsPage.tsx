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
import { buildClassLocationMap, buildClassTeacherMap, resolvePaymentLocationId, resolvePaymentTeacherId, type TeacherRevenueContext } from "../lib/financeReports";
import {
  aggregateEffectivePaymentTotal,
  paymentEffectiveAmount,
  paymentStatusLabelKey,
  type PaymentWithCorrectionMeta,
} from "../lib/paymentCorrection";
import { formatCurrency } from "../lib/utils";
import type { PaymentMethod } from "../types";

type PaymentSourceFilter = "all" | "subscription" | "personal_lesson" | "single_visit";
type PaymentMethodFilter = "all" | PaymentMethod;

const PAYMENT_METHODS: PaymentMethod[] = ["cash", "transfer", "card", "other"];

function PaymentDetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 font-sans">{label}</dt>
      <dd className="text-xs text-slate-700 font-sans mt-0.5 break-words">{value}</dd>
    </div>
  );
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
  const effective = paymentEffectiveAmount(payment);
  const statusKey = payment.correctionStatus
    ? paymentStatusLabelKey(payment.correctionStatus)
    : null;
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
  const amountLabel = `${payment.operationKind === "storno" ? "−" : ""}${formatCurrency(Math.abs(effective))}`;

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
              {statusKey && payment.operationKind !== "storno" && (
                <p className="text-[10px] text-slate-500 mt-0.5">
                  {translate(statusKey as Parameters<typeof translate>[0])}
                </p>
              )}
            </div>
          </div>
        </button>
        <button
          type="button"
          onClick={onToggle}
          className="text-xs text-slate-500 font-sans hidden sm:block text-left cursor-pointer"
        >
          {sourceLabel}
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
            payment.operationKind === "storno" ? "text-rose-600" : "text-indigo-700"
          }`}
        >
          {amountLabel}
        </button>
        {canCorrect && payment.operationKind !== "storno" && payment.correctionStatus !== "voided" && payment.correctionStatus !== "replaced" && (
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
            <PaymentDetailItem label={translate("common.clientDate")} value={`${payment.clientDisplay || "—"} · ${acceptedAt}`} />
            <PaymentDetailItem label={translate("common.source")} value={sourceLabel} />
            <PaymentDetailItem label={translate("common.method")} value={methodLabel} />
            <PaymentDetailItem label={translate("common.amount")} value={amountLabel} />
            <PaymentDetailItem label={translate("schedule.form.teacher")} value={teacherName} />
            <PaymentDetailItem label={translate("schedule.form.location")} value={locationName} />
            <PaymentDetailItem label={translate("finance.payments.acceptedBy")} value={acceptedBy} />
            <PaymentDetailItem label={translate("finance.payments.acceptedAt")} value={acceptedAt} />
            {statusKey && payment.operationKind !== "storno" && (
              <PaymentDetailItem
                label={translate("finance.payments.status")}
                value={translate(statusKey as Parameters<typeof translate>[0])}
              />
            )}
            {payment.methodComment && (
              <PaymentDetailItem label={translate("finance.payments.methodComment")} value={payment.methodComment} />
            )}
          </dl>
        </div>
      )}
    </div>
  );
}

function matchesSourceFilter(payment: PaymentWithCorrectionMeta, source: PaymentSourceFilter): boolean {
  if (source === "all") return true;
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
  const [toastMsg, setToastMsg] = useState<{ msg: string; type: "success" | "error" | "info" } | null>(null);

  const toast = (msg: string, type: "success" | "error" | "info" = "success") => {
    setToastMsg({ msg, type });
    window.setTimeout(() => setToastMsg(null), 4000);
  };

  const paymentsQuery = usePaymentsWithCorrections(
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
      new Map(
        (teamQuery.data ?? []).map((member) => [member.id, memberListLabel(member, locale)])
      ),
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
    const singleVisitById = new Map(
      (singleVisitsQuery.data ?? []).map((visit) => [visit.id, visit])
    );
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

  const filtered = useMemo(() => {
    let items = paymentsQuery.data ?? [];

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
  }, [paymentsQuery.data, sourceFilter, methodFilter, teacherFilter, teacherCtx, search]);

  const contextLoading =
    teacherFilter !== "all" &&
    (teamQuery.isLoading ||
      personalLessonsQuery.isLoading ||
      singleVisitsQuery.isLoading ||
      scheduleQuery.isLoading ||
      subscriptionGroupsQuery.isLoading);

  if (paymentsQuery.isLoading || contextLoading) {
    return <LoadingState label={t("finance.payments.loading")} />;
  }
  if (paymentsQuery.isError) return <QueryErrorState error={paymentsQuery.error} />;

  const total = aggregateEffectivePaymentTotal(filtered);
  const hasAnyPayments = (paymentsQuery.data?.length ?? 0) > 0;
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

        {filtered.length === 0 ? (
          <div className="py-20 text-center">
            <Landmark className="w-8 h-8 text-slate-300 mx-auto mb-3" />
            <p className="text-sm text-slate-500">
              {hasAnyPayments && hasActiveFilters
                ? t("finance.payments.emptyFiltered")
                : t("finance.payments.empty")}
            </p>
          </div>
        ) : (
          <>
            <div className="hidden sm:grid sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto_auto] gap-3 px-3 py-2 bg-slate-50 border-b border-slate-100 text-[10px] uppercase tracking-wider font-semibold text-slate-400 font-sans">
              <span>{t("common.clientDate")}</span>
              <span>{t("common.source")}</span>
              <span>{t("common.method")}</span>
              <span className="text-right">{t("common.amount")}</span>
            </div>
            <div>
              {filtered.map((p) => (
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
                  onToggle={() => setExpandedPaymentId((prev) => (prev === p.id ? null : p.id))}
                />
              ))}
            </div>
            <div className="px-4 py-3 border-t border-slate-100 flex justify-between items-center bg-slate-50/60">
              <span className="text-xs text-slate-500 font-sans">
                {plural(filtered.length, [
                  t("common.records.one", { count: filtered.length }),
                  t("common.records.few", { count: filtered.length }),
                  t("common.records.many", { count: filtered.length }),
                ])}
              </span>
              <span className="text-sm font-sans font-semibold text-slate-800">
                {t("finance.payments.total", { amount: formatCurrency(total) })}
              </span>
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
