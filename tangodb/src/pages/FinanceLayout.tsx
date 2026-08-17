import { useMemo, Fragment } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { Landmark, TrendingUp, AlertCircle, Wallet, Receipt, History, FileBarChart, Inbox } from "lucide-react";
import { useI18n } from "../hooks/useI18n";
import { usePermissions } from "../hooks/usePermissions";
import { isRentalInboxOnly } from "../lib/permissions";
import { getFinanceNav, type FinanceNavSection } from "../lib/i18n";
import type { I18nKey } from "../lib/i18n/keys";

const FINANCE_SECTION_LABEL: Record<FinanceNavSection, I18nKey> = {
  income: "finance.nav.section.income",
  expenses: "finance.nav.section.expenses",
  operations: "finance.nav.section.operations",
};

const FINANCE_NAV_ICONS: Record<string, typeof Landmark> = {
  "/finance/payments": Landmark,
  "/finance/revenue": TrendingUp,
  "/finance/debtors": AlertCircle,
  "/finance/expenses": Receipt,
  "/finance/payroll": Wallet,
  "/finance/corrections": History,
  "/finance/rental-accruals": FileBarChart,
  "/finance/rental-inbox": Inbox,
};

export default function FinanceLayout() {
  const { t } = useI18n();
  const { can, role, options } = usePermissions();
  const teacherPayrollOnly = can("payroll.read.own") && !can("finance.read");
  const rentalInboxOnly = isRentalInboxOnly(role, options);

  const financeNav = useMemo(() => {
    const items = getFinanceNav(t).map((item) => ({
      ...item,
      icon: FINANCE_NAV_ICONS[item.path] ?? Landmark,
    }));

    if (teacherPayrollOnly) {
      return items.filter((item) => item.path === "/finance/payroll");
    }

    if (rentalInboxOnly) {
      return items.filter((item) => item.path === "/finance/rental-inbox");
    }

    return items.filter((item) => {
      if (item.path === "/finance/rental-inbox") return can("rentals.payments.write");
      if (item.path === "/finance/corrections") return can("finance.read");
      if (item.path === "/finance/expenses") return can("expenses.read");
      if (item.path === "/finance/payroll") {
        return can("payroll.read") || can("payroll.read.own");
      }
      return can("finance.read");
    });
  }, [t, teacherPayrollOnly, rentalInboxOnly, can]);

  return (
    <div className="flex flex-col gap-5">
      {!teacherPayrollOnly && (
        <nav className="shrink-0">
          <p className="text-[10px] text-ink-500 font-sans uppercase tracking-wider font-semibold px-1 mb-2">
            {t("finance.nav.title")}
          </p>
          <div className="flex gap-1 overflow-x-auto pb-1">
            {financeNav.map((item, index) => {
              const Icon = item.icon;
              const prev = financeNav[index - 1];
              const showSectionDivider = index > 0 && prev?.section !== item.section;
              return (
                <Fragment key={item.path}>
                  {showSectionDivider ? (
                    <div
                      className="w-px h-6 bg-ink-200 shrink-0 self-center mx-0.5"
                      role="separator"
                      aria-label={t(FINANCE_SECTION_LABEL[item.section])}
                    />
                  ) : null}
                  <NavLink
                    to={item.path}
                    className={({ isActive }) =>
                      `flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                        isActive
                          ? "bg-gold-50 text-gold-700 border border-gold-100"
                          : "text-ink-600 hover:bg-ink-50 border border-transparent"
                      }`
                    }
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    {item.label}
                  </NavLink>
                </Fragment>
              );
            })}
          </div>
        </nav>
      )}

      <div className="flex-1 min-w-0">
        <Outlet />
      </div>
    </div>
  );
}
