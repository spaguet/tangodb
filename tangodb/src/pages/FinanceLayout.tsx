import { NavLink, Outlet } from "react-router-dom";
import { Landmark, TrendingUp, AlertCircle, Wallet } from "lucide-react";

const FINANCE_NAV = [
  { label: "Платежи", path: "/finance/payments", icon: Landmark },
  { label: "Выручка", path: "/finance/revenue", icon: TrendingUp },
  { label: "Дебиторы", path: "/finance/debtors", icon: AlertCircle },
  { label: "Зарплаты", path: "/finance/payroll", icon: Wallet },
] as const;

export default function FinanceLayout() {
  return (
    <div className="flex flex-col lg:flex-row gap-5 lg:gap-8">
      <nav className="lg:w-52 shrink-0">
        <p className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold px-1 mb-2">
          Финансы
        </p>
        <div className="flex lg:flex-col gap-1 overflow-x-auto pb-1 lg:pb-0">
          {FINANCE_NAV.map((item) => {
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
