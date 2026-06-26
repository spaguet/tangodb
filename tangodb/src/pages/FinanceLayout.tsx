import { useMemo } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { Landmark, TrendingUp, AlertCircle, Wallet } from "lucide-react";
import { useI18n } from "../hooks/useI18n";
import { getFinanceNav } from "../lib/i18n";

const FINANCE_NAV_ICONS: Record<string, typeof Landmark> = {
  "/finance/payments": Landmark,
  "/finance/revenue": TrendingUp,
  "/finance/debtors": AlertCircle,
  "/finance/payroll": Wallet,
};

export default function FinanceLayout() {
  const { t } = useI18n();
  const financeNav = useMemo(
    () =>
      getFinanceNav(t).map((item) => ({
        ...item,
        icon: FINANCE_NAV_ICONS[item.path] ?? Landmark,
      })),
    [t]
  );

  return (
    <div className="flex flex-col lg:flex-row gap-5 lg:gap-8">
      <nav className="lg:w-52 shrink-0">
        <p className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold px-1 mb-2">
          {t("finance.nav.title")}
        </p>
        <div className="flex lg:flex-col gap-1 overflow-x-auto pb-1 lg:pb-0">
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

      <div className="flex-1 min-w-0">
        <Outlet />
      </div>
    </div>
  );
}
