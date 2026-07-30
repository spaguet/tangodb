import { useMemo } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { Landmark, TrendingUp, AlertCircle, Wallet, Receipt, History } from "lucide-react";
import { useI18n } from "../hooks/useI18n";
import { usePermissions } from "../hooks/usePermissions";
import { getFinanceNav } from "../lib/i18n";

const FINANCE_NAV_ICONS: Record<string, typeof Landmark> = {
  "/finance/payments": Landmark,
  "/finance/revenue": TrendingUp,
  "/finance/debtors": AlertCircle,
  "/finance/expenses": Receipt,
  "/finance/payroll": Wallet,
  "/finance/corrections": History,
};

export default function FinanceLayout() {
  const { t } = useI18n();
  const { can } = usePermissions();
  const teacherPayrollOnly = can("payroll.read.own") && !can("finance.read");

  const financeNav = useMemo(() => {
    const items = getFinanceNav(t).map((item) => ({
      ...item,
      icon: FINANCE_NAV_ICONS[item.path] ?? Landmark,
    }));

    if (teacherPayrollOnly) {
      return items.filter((item) => item.path === "/finance/payroll");
    }

    return items.filter((item) => {
      if (item.path === "/finance/corrections") return can("finance.read");
      if (item.path === "/finance/expenses") return can("expenses.read");
      if (item.path === "/finance/payroll") {
        return can("payroll.read") || can("payroll.read.own");
      }
      return can("finance.read");
    });
  }, [t, teacherPayrollOnly, can]);

  return (
    <div className="flex flex-col gap-5">
      {!teacherPayrollOnly && (
        <nav className="shrink-0">
          <p className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold px-1 mb-2">
            {t("finance.nav.title")}
          </p>
          <div className="flex gap-1 overflow-x-auto pb-1">
            {financeNav.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive }) =>
                    `flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                      isActive
                        ? "bg-indigo-50 text-indigo-700 border border-indigo-100"
                        : "text-slate-600 hover:bg-slate-50 border border-transparent"
                    }`
                  }
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  {item.label}
                </NavLink>
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
