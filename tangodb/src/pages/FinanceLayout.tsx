import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Landmark,
  TrendingUp,
  AlertCircle,
  Wallet,
  Receipt,
  History,
  FileBarChart,
  Inbox,
  Banknote,
  ChevronDown,
} from "lucide-react";
import { useI18n } from "../hooks/useI18n";
import { usePermissions } from "../hooks/usePermissions";
import { useFinanceRentalScreensEnabled } from "../hooks/useFinanceRentalScreensEnabled";
import { useRenterTopupInbox } from "../hooks/useRenterTopupInbox";
import { isRentalInboxOnly } from "../lib/permissions";
import { isFinancePrimaryPath, isFinanceRentalPath } from "../lib/financeNavPaths";
import { getFinanceNav } from "../lib/i18n";

const FINANCE_NAV_ICONS: Record<string, typeof Landmark> = {
  "/finance/payments": Landmark,
  "/finance/revenue": TrendingUp,
  "/finance/debtors": AlertCircle,
  "/finance/expenses": Receipt,
  "/finance/payroll": Wallet,
  "/finance/corrections": History,
  "/finance/rental-accruals": FileBarChart,
  "/finance/rental-inbox": Inbox,
  "/finance/renter-topup": Banknote,
};

const navLinkCls = (isActive: boolean) =>
  `flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-colors shrink-0 whitespace-nowrap ${
    isActive
      ? "bg-indigo-50 text-indigo-700 border border-indigo-100"
      : "text-slate-600 hover:bg-slate-50 border border-transparent"
  }`;

function activeFinanceNavPath(pathname: string): string {
  const segment = pathname.replace(/^\/finance\/?/, "").split("/")[0];
  if (!segment) return "/finance/payments";
  return `/finance/${segment}`;
}

export default function FinanceLayout() {
  const { t } = useI18n();
  const location = useLocation();
  const { can, role, options } = usePermissions();
  const { enabled: rentalScreensEnabled } = useFinanceRentalScreensEnabled();
  const canFinanceRead = can("finance.read");
  const canExpensesRead = can("expenses.read");
  const canPayrollRead = can("payroll.read");
  const canPayrollReadOwn = can("payroll.read.own");
  const canRentalsPaymentsWrite = can("rentals.payments.write");
  const teacherPayrollOnly = canPayrollReadOwn && !canFinanceRead;
  const rentalInboxOnly = isRentalInboxOnly(role, options);
  const showTopupNav =
    rentalScreensEnabled && !teacherPayrollOnly && (rentalInboxOnly || canRentalsPaymentsWrite);
  const pendingTopupQuery = useRenterTopupInbox({
    status: "pending",
    limit: 1,
    offset: 0,
    enabled: showTopupNav,
  });
  const pendingTopupCount = pendingTopupQuery.data?.total ?? 0;

  const financeNav = useMemo(() => {
    const items = getFinanceNav(t).map((item) => ({
      ...item,
      icon: FINANCE_NAV_ICONS[item.path] ?? Landmark,
    }));

    if (teacherPayrollOnly) {
      return items.filter((item) => item.path === "/finance/payroll");
    }

    if (rentalInboxOnly) {
      if (!rentalScreensEnabled) return [];
      return items.filter(
        (item) => item.path === "/finance/rental-inbox" || item.path === "/finance/renter-topup"
      );
    }

    return items.filter((item) => {
      if (isFinanceRentalPath(item.path)) {
        return rentalScreensEnabled;
      }
      if (item.path === "/finance/corrections") return canFinanceRead;
      if (item.path === "/finance/expenses") return canExpensesRead;
      if (item.path === "/finance/payroll") {
        return canPayrollRead || canPayrollReadOwn;
      }
      return canFinanceRead;
    });
  }, [
    t,
    teacherPayrollOnly,
    rentalInboxOnly,
    rentalScreensEnabled,
    canFinanceRead,
    canExpensesRead,
    canPayrollRead,
    canPayrollReadOwn,
  ]);

  const useSimpleNav = !teacherPayrollOnly && !rentalInboxOnly && canFinanceRead;

  const primaryNav = useMemo(() => {
    if (!useSimpleNav) return financeNav;
    return financeNav
      .filter((item) => isFinancePrimaryPath(item.path))
      .map((item) =>
        item.path === "/finance/debtors" ? { ...item, label: t("finance.nav.debtorsWhoOwes") } : item
      );
  }, [financeNav, useSimpleNav, t]);

  const moreNav = useMemo(() => {
    if (!useSimpleNav) return [];
    return financeNav.filter((item) => !isFinancePrimaryPath(item.path));
  }, [financeNav, useSimpleNav]);

  const activePath = activeFinanceNavPath(location.pathname);
  const moreRouteActive = moreNav.some((item) => activePath === item.path);

  const [moreOpen, setMoreOpen] = useState(moreRouteActive);

  useEffect(() => {
    if (moreRouteActive) setMoreOpen(true);
  }, [moreRouteActive]);

  const renderNavItem = (item: (typeof financeNav)[number]) => {
    const Icon = item.icon ?? Landmark;
    return (
      <NavLink key={item.path} to={item.path} className={({ isActive }) => navLinkCls(isActive)}>
        <Icon className="w-3.5 h-3.5 shrink-0" />
        {item.label}
        {item.path === "/finance/renter-topup" && pendingTopupCount > 0 ? (
          <span className="inline-flex min-w-4 h-4 items-center justify-center rounded-full bg-indigo-600 px-1 text-[10px] font-semibold text-white">
            {pendingTopupCount}
          </span>
        ) : null}
      </NavLink>
    );
  };

  return (
    <div className="flex flex-col gap-5 min-w-0 max-w-full">
      {!teacherPayrollOnly && (
        <nav className="shrink-0 min-w-0">
          <p className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold px-1 mb-2">
            {t("finance.nav.title")}
          </p>

          {useSimpleNav ? (
            <div className="space-y-2">
              <div
                className={`grid gap-1.5 ${
                  moreNav.length > 0 ? "grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]" : "grid-cols-2"
                }`}
              >
                {primaryNav.map((item) => renderNavItem(item))}
                {moreNav.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setMoreOpen((open) => !open)}
                    aria-expanded={moreOpen}
                    className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer border ${
                      moreOpen || moreRouteActive
                        ? "bg-slate-100 text-slate-800 border-slate-200"
                        : "text-slate-600 hover:bg-slate-50 border-transparent"
                    }`}
                  >
                    {t("finance.nav.more")}
                    <ChevronDown
                      className={`w-3.5 h-3.5 shrink-0 transition-transform ${moreOpen ? "rotate-180" : ""}`}
                      aria-hidden
                    />
                  </button>
                ) : null}
              </div>
              {moreOpen && moreNav.length > 0 ? (
                <div className="flex overflow-x-auto gap-1.5 pb-0.5 -mx-0.5 px-0.5 snap-x snap-mandatory">
                  {moreNav.map((item) => renderNavItem(item))}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex overflow-x-auto gap-1.5 pb-0.5 -mx-0.5 px-0.5 snap-x snap-mandatory">
              {financeNav.map((item) => renderNavItem(item))}
            </div>
          )}
        </nav>
      )}

      <div className="flex-1 min-w-0">
        <Outlet />
      </div>
    </div>
  );
}
