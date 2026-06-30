import {
  Calendar,
  CalendarCheck,
  Coins,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  Sparkles,
  Ticket,
  TicketPlus,
  UserCog,
  Users,
  X,
} from "lucide-react";
import { useState } from "react";
import type { Locale } from "../i18n";
import { TdbLogo } from "../components/TdbLogo";
import { STUDIO_NAME } from "./data";
import { AttendancePanel } from "./panels/AttendancePanel";
import { ClientsPanel } from "./panels/ClientsPanel";
import { DashboardPanel } from "./panels/DashboardPanel";
import { FinancePanel } from "./panels/FinancePanel";
import { PersonalLessonsPanel } from "./panels/PersonalLessonsPanel";
import { PricesPanel } from "./panels/PricesPanel";
import { SchedulePanel } from "./panels/SchedulePanel";
import { SettingsPanel } from "./panels/SettingsPanel";
import { SubscriptionsPanel } from "./panels/SubscriptionsPanel";
import { TeamPanel } from "./panels/TeamPanel";
import { crmStrings } from "./strings";

export type DemoPanel =
  | "dashboard"
  | "schedule"
  | "attendance"
  | "subscriptions"
  | "subscriptions-sell"
  | "personal"
  | "personal-sell"
  | "finance"
  | "clients"
  | "prices"
  | "settings"
  | "team";

type NavItem = { id: DemoPanel; icon: typeof LayoutDashboard; label: string };

type NavSection = { label: string; items: NavItem[] };

type Props = { locale: Locale };

function buildNav(locale: Locale): NavSection[] {
  const s = crmStrings(locale);
  return [
    { label: s.nav.analytics, items: [{ id: "dashboard", icon: LayoutDashboard, label: s.nav.dashboard }] },
    { label: s.nav.finance, items: [{ id: "finance", icon: Landmark, label: s.nav.financeItem }] },
    { label: s.nav.clients, items: [{ id: "clients", icon: Users, label: s.nav.clientsItem }] },
    {
      label: s.nav.groupSubs,
      items: [
        { id: "subscriptions", icon: Ticket, label: s.nav.subscriptions },
        { id: "subscriptions-sell", icon: TicketPlus, label: s.nav.subscriptionsSell },
      ],
    },
    {
      label: s.nav.scheduleJournal,
      items: [
        { id: "schedule", icon: Calendar, label: s.nav.schedule },
        { id: "attendance", icon: CalendarCheck, label: s.nav.attendance },
      ],
    },
    {
      label: s.nav.personal,
      items: [
        { id: "personal", icon: Sparkles, label: s.nav.personalLessons },
        { id: "personal-sell", icon: TicketPlus, label: s.nav.personalSell },
      ],
    },
    { label: s.nav.prices, items: [{ id: "prices", icon: Coins, label: s.nav.pricesItem }] },
    {
      label: s.nav.settings,
      items: [
        { id: "team", icon: UserCog, label: s.nav.team },
        { id: "settings", icon: Settings, label: s.nav.settingsItem },
      ],
    },
  ];
}

const panelTitles: Record<DemoPanel, keyof ReturnType<typeof crmStrings>["panel"]> = {
  dashboard: "dashboard",
  schedule: "schedule",
  attendance: "attendance",
  subscriptions: "subscriptions",
  "subscriptions-sell": "subscriptionsSell",
  personal: "personal",
  "personal-sell": "personalSell",
  finance: "finance",
  clients: "clients",
  prices: "prices",
  settings: "settings",
  team: "team",
};

function renderPanelContent(panel: DemoPanel, locale: Locale, go: (id: DemoPanel) => void) {
  switch (panel) {
    case "dashboard":
      return <DashboardPanel locale={locale} onNavigate={(p) => go(p as DemoPanel)} />;
    case "schedule":
      return <SchedulePanel locale={locale} />;
    case "attendance":
      return <AttendancePanel locale={locale} />;
    case "subscriptions":
      return <SubscriptionsPanel locale={locale} initialTab="active" />;
    case "subscriptions-sell":
      return <SubscriptionsPanel locale={locale} initialTab="sell" />;
    case "personal":
      return <PersonalLessonsPanel locale={locale} initialTab="view" />;
    case "personal-sell":
      return <PersonalLessonsPanel locale={locale} initialTab="sell" />;
    case "finance":
      return <FinancePanel locale={locale} />;
    case "clients":
      return <ClientsPanel locale={locale} />;
    case "prices":
      return <PricesPanel locale={locale} />;
    case "settings":
      return <SettingsPanel locale={locale} />;
    case "team":
      return <TeamPanel locale={locale} />;
    default:
      return null;
  }
}

export function CrmDemoApp({ locale }: Props) {
  const s = crmStrings(locale);
  const [panel, setPanel] = useState<DemoPanel>("dashboard");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const nav = buildNav(locale);
  const title = s.panel[panelTitles[panel]];

  const go = (id: DemoPanel) => {
    setPanel(id);
    setDrawerOpen(false);
  };

  const renderNav = (onNavigate?: () => void) => (
    <nav className="h-full overflow-y-auto px-3 py-4 space-y-4">
      {nav.map((section) => (
        <div key={section.label} className="space-y-0.5">
          <p className="text-[11px] text-slate-400 font-sans tracking-wider uppercase font-semibold px-3 mb-1">
            {section.label}
          </p>
          {section.items.map((item) => {
            const active = panel === item.id;
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  go(item.id);
                  onNavigate?.();
                }}
                className={`w-full flex items-center justify-start gap-3 px-3 py-2 rounded-md text-xs font-semibold tracking-wide text-left transition-all cursor-pointer ${
                  active
                    ? "bg-indigo-50 text-indigo-700 font-semibold border-l-2 border-indigo-600 pl-2.5"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span className="min-w-0 leading-snug">{item.label}</span>
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );

  const renderPanel = () => renderPanelContent(panel, locale, go);

  return (
    <div className="crm-demo flex flex-col md:flex-row bg-slate-50 text-slate-800 antialiased font-sans h-[min(780px,88vh)] min-h-[560px] overflow-hidden rounded-xl border border-slate-200 shadow-xl">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-64 shrink-0 bg-white text-slate-700 border-r border-slate-200 shadow-xs">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3.5">
          <TdbLogo />
          <div className="min-w-0">
            <h1 className="text-base font-semibold tracking-tight text-slate-800 leading-tight">TangoDB</h1>
            <p className="text-[11px] font-sans tracking-widest text-slate-400 uppercase mt-0.5">STUDIO CONTROLLER</p>
          </div>
        </div>
        <div className="flex-1 min-h-0">{renderNav()}</div>
        <div className="p-4 border-t border-slate-100 text-center text-[10px] text-slate-400 font-sans">
          © TangoDB Studio Controller
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 min-h-0">
        <header className="shrink-0 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between z-20 shadow-xs">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="md:hidden p-1.5 text-slate-600 hover:bg-slate-50 rounded-lg cursor-pointer"
              aria-label="Menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h2 className="text-base font-semibold text-slate-800 tracking-tight leading-tight truncate">{title}</h2>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="hidden sm:flex items-center gap-2 max-w-[200px] rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600">
              <span className="truncate">{STUDIO_NAME}</span>
            </span>
            <span className="text-[10px] font-bold uppercase tracking-wide text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-1 rounded-md">
              {s.demo.readOnly}
            </span>
            <button
              type="button"
              disabled
              className="hidden sm:flex items-center gap-1.5 text-xs font-semibold text-slate-400 px-3 py-1.5 rounded-lg border border-slate-200 cursor-not-allowed opacity-60"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </header>

        <div className="shrink-0 bg-amber-50 border-b border-amber-100 px-4 py-1.5 text-center">
          <p className="text-[10px] font-semibold text-amber-800">{s.demo.banner}</p>
          <p className="text-[10px] text-amber-700/80">tangodb.app · {STUDIO_NAME}</p>
        </div>

        <section className="flex-1 p-4 sm:p-5 overflow-y-auto panel-page-stack">
          <div key={panel}>{renderPanel()}</div>
        </section>
      </main>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <button
            type="button"
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs"
            onClick={() => setDrawerOpen(false)}
            aria-label="Close"
          />
          <div className="relative flex flex-col w-72 max-w-[85vw] bg-white h-full border-r border-slate-200 shadow-xl">
            <div className="flex justify-between items-start px-5 py-4 border-b border-slate-100">
              <div className="flex items-start gap-3">
                <TdbLogo size="sm" />
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">TangoDB</h3>
                  <p className="text-[10px] text-slate-400 uppercase tracking-wider">tangodb.app</p>
                </div>
              </div>
              <button type="button" onClick={() => setDrawerOpen(false)} className="p-1.5 text-slate-400 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">{renderNav(() => setDrawerOpen(false))}</div>
          </div>
        </div>
      )}
    </div>
  );
}
