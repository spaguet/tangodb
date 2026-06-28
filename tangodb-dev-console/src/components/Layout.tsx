import { Outlet, NavLink } from "react-router-dom";
import { Key, LayoutDashboard, Building2, ArrowLeftRight, LogOut, CreditCard, TriangleAlert, Wallet, Users, Inbox } from "lucide-react";
import { supabaseEnvError } from "../lib/supabase";

interface LayoutProps {
  onSignOut: () => void;
}

export default function Layout({ onSignOut }: LayoutProps) {
  const linkCls = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
      isActive ? "bg-indigo-600/20 text-indigo-300" : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
    }`;

  return (
    <div className="min-h-screen flex">
      <aside className="w-56 border-r border-slate-800 p-4 flex flex-col gap-1">
        <div className="mb-6 px-2">
          <p className="text-xs uppercase tracking-widest text-slate-500 font-semibold">TangoDB</p>
          <h1 className="text-lg font-bold text-white">Dev Console</h1>
        </div>
        <NavLink to="/" end className={linkCls}>
          <LayoutDashboard className="w-4 h-4" /> Metrics
        </NavLink>
        <NavLink to="/inbox" className={linkCls}>
          <Inbox className="w-4 h-4" /> Inbox
        </NavLink>
        <NavLink to="/keys" className={linkCls}>
          <Key className="w-4 h-4" /> Keys
        </NavLink>
        <NavLink to="/payment-methods" className={linkCls}>
          <Wallet className="w-4 h-4" /> Payment methods
        </NavLink>
        <NavLink to="/orgs" className={linkCls}>
          <Building2 className="w-4 h-4" /> Tenants
        </NavLink>
        <NavLink to="/users" className={linkCls}>
          <Users className="w-4 h-4" /> Users
        </NavLink>
        <NavLink to="/billing" className={linkCls}>
          <CreditCard className="w-4 h-4" /> Billing
        </NavLink>
        <NavLink to="/migrations" className={linkCls}>
          <ArrowLeftRight className="w-4 h-4" /> Migrations
        </NavLink>
        <NavLink to="/errors" className={linkCls}>
          <TriangleAlert className="w-4 h-4" /> Errors
        </NavLink>
        <button
          type="button"
          onClick={onSignOut}
          className="mt-auto flex items-center gap-2 px-3 py-2 text-sm text-slate-500 hover:text-rose-400 cursor-pointer"
        >
          <LogOut className="w-4 h-4" /> Sign out
        </button>
      </aside>
      <main className="flex-1 p-6 overflow-y-auto">
        {supabaseEnvError && (
          <p className="mb-4 text-sm text-amber-400 bg-amber-950/40 border border-amber-900 rounded-lg px-3 py-2">
            {supabaseEnvError}
          </p>
        )}
        <Outlet />
      </main>
    </div>
  );
}
