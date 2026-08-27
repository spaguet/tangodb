import type { I18nKey } from "./i18n/keys";
import type {
  PayrollPayMode,
  SettlementLineCategory,
  TeacherSettlement,
  TeacherSettlementDetail,
  TeacherSettlementLineItem,
} from "../types/payroll";

function num(value: unknown): number {
  return Number(value) || 0;
}

function str(value: unknown): string | null {
  if (value == null || value === "") return null;
  return String(value);
}

function mapLine(row: Record<string, unknown>): TeacherSettlementLineItem {
  return {
    id: String(row.id),
    lineCategory: row.lineCategory as SettlementLineCategory,
    sourceType: row.sourceType as TeacherSettlementLineItem["sourceType"],
    sourceId: str(row.sourceId),
    lineDate: str(row.lineDate),
    timeStart: str(row.timeStart),
    timeEnd: str(row.timeEnd),
    title: str(row.title),
    disciplineName: str(row.disciplineName),
    locationName: str(row.locationName),
    monetaryBase: num(row.monetaryBase),
    payMode: (str(row.payMode) as PayrollPayMode | null) ?? null,
    fixedRateAmount: num(row.fixedRateAmount),
    percentRate: num(row.percentRate),
    accrualAmount: num(row.accrualAmount),
    includedInTotal: row.includedInTotal !== false,
    exclusionReason: str(row.exclusionReason),
    sortAt: String(row.sortAt ?? ""),
  };
}

export function mapTeacherSettlementDetail(raw: unknown): TeacherSettlementDetail {
  const data = raw as Record<string, unknown>;
  const settlementRaw = data.settlement as Record<string, unknown>;
  const reconciliationRaw = data.reconciliation as Record<string, unknown>;

  const settlement: TeacherSettlement = {
    id: String(settlementRaw.id),
    memberId: String(settlementRaw.memberId),
    periodYear: Number(settlementRaw.periodYear),
    periodMonth: Number(settlementRaw.periodMonth),
    amountAccrued: num(settlementRaw.amountAccrued),
    amountPaid: num(settlementRaw.amountPaid),
    computedAt: String(settlementRaw.computedAt ?? ""),
  };

  const lines = ((data.lines as unknown[]) ?? []).map((row) =>
    mapLine(row as Record<string, unknown>)
  );
  const excludedLines = ((data.excludedLines as unknown[]) ?? []).map((row) =>
    mapLine(row as Record<string, unknown>)
  );

  return {
    settlement,
    lines,
    excludedLines,
    reconciliation: {
      linesTotal: num(reconciliationRaw.linesTotal),
      amountAccrued: num(reconciliationRaw.amountAccrued),
      matches: reconciliationRaw.matches === true,
      computedAt: String(reconciliationRaw.computedAt ?? ""),
    },
  };
}

export type SettlementLineSectionKey = "fixed" | "group" | "personal" | "single_visit" | "adjustment";

export interface SettlementLineSection {
  key: SettlementLineSectionKey;
  subtotal: number;
  lines: TeacherSettlementLineItem[];
  payModes: PayrollPayMode[];
}

export function groupSettlementLinesBySection(
  lines: TeacherSettlementLineItem[]
): SettlementLineSection[] {
  const order: SettlementLineSectionKey[] = [
    "fixed",
    "group",
    "personal",
    "single_visit",
    "adjustment",
  ];

  return order.map((key) => {
    const sectionLines = lines.filter((line) => line.lineCategory === key);
    const payModes = [
      ...new Set(
        sectionLines.map((line) => line.payMode).filter((mode): mode is PayrollPayMode => !!mode)
      ),
    ];
    return {
      key,
      subtotal: sectionLines.reduce((sum, line) => sum + line.accrualAmount, 0),
      lines: sectionLines,
      payModes,
    };
  });
}

export function formatLineFormula(
  line: TeacherSettlementLineItem,
  translate: (key: I18nKey, params?: Record<string, string | number>) => string
): string {
  if (line.lineCategory === "fixed") {
    const amount = line.fixedRateAmount > 0 ? line.fixedRateAmount : line.accrualAmount;
    return translate("finance.payroll.detail.formulaFixed", {
      amount,
    });
  }
  if (line.percentRate > 0 && line.monetaryBase > 0) {
    return translate("finance.payroll.detail.formulaPercent", {
      base: line.monetaryBase,
      percent: line.percentRate,
      amount: line.accrualAmount,
    });
  }
  return translate("finance.payroll.detail.formulaPlain", { amount: line.accrualAmount });
}
