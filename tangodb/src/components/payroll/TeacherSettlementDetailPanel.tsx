import { useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import LoadingState from "../ui/LoadingState";
import QueryErrorState from "../ui/QueryErrorState";
import { useI18n } from "../../hooks/useI18n";
import { useTeacherSettlementDetail } from "../../hooks/usePayroll";
import {
  formatLineFormula,
  groupSettlementLinesBySection,
  type SettlementLineSectionKey,
} from "../../lib/payrollSettlementDetail";
import { formatCurrency } from "../../lib/utils";
import type { PayrollPayMode, TeacherSettlementLineItem } from "../../types/payroll";

const SECTION_LABEL_KEYS: Record<SettlementLineSectionKey, import("../../lib/i18n/keys").I18nKey> = {
  fixed: "finance.payroll.breakdownFixed",
  group: "finance.payroll.breakdownGroup",
  personal: "finance.payroll.breakdownPersonal",
  single_visit: "finance.payroll.breakdownSingleVisit",
  adjustment: "finance.payroll.detail.sectionAdjustment",
};

const CATEGORY_LABEL_KEYS: Record<SettlementLineSectionKey, import("../../lib/i18n/keys").I18nKey> = {
  fixed: "finance.payroll.detail.typeFixed",
  group: "finance.payroll.detail.typeGroup",
  personal: "finance.payroll.detail.typePersonal",
  single_visit: "finance.payroll.detail.typeSingleVisit",
  adjustment: "finance.payroll.detail.typeAdjustment",
};

function payModeLabel(
  payMode: PayrollPayMode | null,
  t: ReturnType<typeof useI18n>["t"]
): string {
  if (!payMode) return "—";
  if (payMode === "percent") return t("finance.payroll.detail.payModePercent");
  if (payMode === "fixed") return t("finance.payroll.detail.payModeFixed");
  return t("finance.payroll.detail.payModeFixedPlusPercent");
}

function SettlementLineRow({
  line,
  showClientTitle,
}: {
  line: TeacherSettlementLineItem;
  showClientTitle: boolean;
}) {
  const { t, formatDate } = useI18n();
  const dateLabel = line.lineDate
    ? formatDate(line.lineDate, { day: "numeric", month: "short", year: "numeric" })
    : "—";
  const timeLabel =
    line.timeStart && line.timeEnd ? `${line.timeStart}–${line.timeEnd}` : line.timeStart ?? "";

  return (
    <li className="rounded-lg border border-ink-100 bg-white px-3 py-2.5 space-y-1.5 text-xs font-sans">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <p className="font-semibold text-ink-800">
            {t(CATEGORY_LABEL_KEYS[line.lineCategory])}
            {showClientTitle && line.title ? ` · ${line.title}` : line.title ? ` · ${line.title}` : ""}
          </p>
          <p className="text-ink-500">
            {dateLabel}
            {timeLabel ? ` · ${timeLabel}` : ""}
          </p>
          {(line.disciplineName || line.locationName) && (
            <p className="text-ink-400">
              {[line.disciplineName, line.locationName].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
        <p className="font-semibold text-gold-700 whitespace-nowrap">{formatCurrency(line.accrualAmount)}</p>
      </div>
      <p className="text-[10px] text-ink-500">{formatLineFormula(line, t)}</p>
    </li>
  );
}

function ExcludedLineRow({ line }: { line: TeacherSettlementLineItem }) {
  const { t, formatDate } = useI18n();
  const dateLabel = line.lineDate
    ? formatDate(line.lineDate, { day: "numeric", month: "short", year: "numeric" })
    : "—";

  return (
    <li className="rounded-lg border border-amber-200 bg-amber-50/10 px-3 py-2 text-xs font-sans text-amber-700">
      <p className="font-semibold">
        {line.title ?? t(CATEGORY_LABEL_KEYS[line.lineCategory])} · {dateLabel}
      </p>
      <p className="text-[10px] mt-0.5">
        {t("finance.payroll.detail.excludedReason", {
          reason: line.exclusionReason ?? t("finance.payroll.detail.notInCalculation"),
        })}
      </p>
    </li>
  );
}

export default function TeacherSettlementDetailPanel({
  settlementId,
}: {
  settlementId: string;
}) {
  const { t, formatDate } = useI18n();
  const detailQuery = useTeacherSettlementDetail(settlementId);

  const sections = useMemo(
    () => groupSettlementLinesBySection(detailQuery.data?.lines ?? []),
    [detailQuery.data?.lines]
  );

  if (detailQuery.isLoading) {
    return <LoadingState label={t("finance.payroll.detail.loading")} />;
  }
  if (detailQuery.isError) {
    return <QueryErrorState error={detailQuery.error} />;
  }

  const detail = detailQuery.data;
  if (!detail) {
    return (
      <p className="text-xs text-ink-500 py-3 text-center">{t("finance.payroll.detail.empty")}</p>
    );
  }

  const hasLines = detail.lines.length > 0;
  const { reconciliation } = detail;

  return (
    <div className="mt-3 pt-3 border-t border-ink-200 space-y-3">
      <div
        className={`rounded-lg px-3 py-2 text-xs font-sans ${
          reconciliation.matches
            ? "bg-gold-50 border border-gold-100 text-gold-800"
            : "bg-amber-50 border border-amber-200 text-amber-700"
        }`}
      >
        <div className="flex items-start gap-2">
          {!reconciliation.matches && <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}
          <div className="space-y-0.5">
            <p className="font-semibold">
              {reconciliation.matches
                ? t("finance.payroll.detail.reconciliationOk")
                : t("finance.payroll.detail.reconciliationMismatch")}
            </p>
            <p>
              {t("finance.payroll.detail.reconciliationFormula", {
                linesTotal: formatCurrency(reconciliation.linesTotal),
                accrued: formatCurrency(reconciliation.amountAccrued),
              })}
            </p>
            {!reconciliation.matches && (
              <p className="text-[10px]">{t("finance.payroll.detail.reconciliationHint")}</p>
            )}
          </div>
        </div>
      </div>

      {!hasLines ? (
        <p className="text-xs text-ink-500 py-2 text-center">{t("finance.payroll.detail.noLines")}</p>
      ) : (
        sections.map((section) => {
          if (section.lines.length === 0) return null;
          return (
            <section key={section.key} className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h4 className="text-xs font-semibold text-ink-800">
                    {t(SECTION_LABEL_KEYS[section.key])}
                  </h4>
                  {section.payModes.length > 0 && (
                    <p className="text-[10px] text-ink-500 mt-0.5">
                      {section.payModes.map((mode) => payModeLabel(mode, t)).join(" · ")}
                    </p>
                  )}
                </div>
                <p className="text-xs font-semibold text-ink-700">
                  {formatCurrency(section.subtotal)}
                </p>
              </div>
              <ul className="space-y-1.5">
                {section.lines.map((line) => (
                  <SettlementLineRow
                    key={line.id}
                    line={line}
                    showClientTitle={section.key !== "fixed"}
                  />
                ))}
              </ul>
            </section>
          );
        })
      )}

      {detail.excludedLines.length > 0 && (
        <section className="space-y-2">
          <h4 className="text-xs font-semibold text-amber-700">
            {t("finance.payroll.detail.excludedTitle")}
          </h4>
          <ul className="space-y-1.5">
            {detail.excludedLines.map((line) => (
              <ExcludedLineRow key={line.id} line={line} />
            ))}
          </ul>
        </section>
      )}

      <p className="text-[10px] text-ink-500">
        {t("finance.payroll.detail.computedAt", {
          date: formatDate(reconciliation.computedAt.slice(0, 10), {
            day: "numeric",
            month: "short",
            year: "numeric",
          }),
        })}
      </p>
    </div>
  );
}
