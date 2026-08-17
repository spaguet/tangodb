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
import { useEffect, useState } from "react";
import type { Locale } from "../i18n";
import { parseDemoDeepLink, scrollToDemoSection, type SettingsSection } from "../lib/demoDeepLink";
import { TdbLogo } from "../components/TdbLogo";
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
import { crmStrings, type CrmStrings } from "./strings";

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

type MobileTab = {
  id: DemoPanel;
  icon: typeof LayoutDashboard;
  line1: string;
  line2: string;
};

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

function buildMobileTabs(locale: Locale): MobileTab[] {
  const s = crmStrings(locale);
  return [
    {
      id: "dashboard",
      icon: LayoutDashboard,
      line1: s.nav.mobileDashboardLine1,
      line2: s.nav.mobileDashboardLine2,
    },
    {
      id: "subscriptions",
      icon: Ticket,
      line1: s.nav.mobileSubscriptionsLine1,
      line2: s.nav.mobileSubscriptionsLine2,
    },
    {
      id: "attendance",
      icon: CalendarCheck,
      line1: s.nav.mobileAttendanceLine1,
      line2: s.nav.mobileAttendanceLine2,
    },
    {
      id: "schedule",
      icon: Calendar,
      line1: s.nav.mobileScheduleLine1,
      line2: s.nav.mobileScheduleLine2,
    },
  ];
}

function getPanelTitle(panel: DemoPanel, s: CrmStrings): string {
  switch (panel) {
    case "dashboard":
      return s.panel.dashboard;
    case "schedule":
      return s.panel.schedule;
    case "attendance":
      return s.panel.attendance;
    case "subscriptions":
      return s.panel.subscriptions;
    case "subscriptions-sell":
      return s.panel.subscriptionsSell;
    case "personal":
      return s.panel.personal;
    case "personal-sell":
      return s.panel.personalSell;
    case "finance":
      return s.panel.finance;
    case "clients":
      return s.panel.clients;
    case "prices":
      return s.panel.prices;
    case "settings":
      return s.panel.settings;
    case "team":
      return s.panel.team;
    default:
      return "TangoDB";
  }
}

function isMobileTabActive(panel: DemoPanel, tab: DemoPanel): boolean {
  if (tab === "dashboard") return panel === "dashboard";
  if (tab === "subscriptions") {
    return panel === "subscriptions" || panel === "subscriptions-sell";
  }
  return panel === tab;
}

function renderPanelContent(
  panel: DemoPanel,
  locale: Locale,
  go: (id: DemoPanel) => void,
  settingsSection?: SettingsSection,
) {
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
      return <SettingsPanel locale={locale} initialSection={settingsSection} />;
    case "team":
      return <TeamPanel locale={locale} />;
    default:
      return null;
  }
}

function resolveInitialDemoState() {
  const target = parseDemoDeepLink(window.location.hash);
  return {
    panel: target?.panel ?? "dashboard",
    settingsSection: target?.settingsSection,
  } satisfies { panel: DemoPanel; settingsSection?: SettingsSection };
}

export function CrmDemoApp({ locale }: Props) {
  const s = crmStrings(locale);
  const [panel, setPanel] = useState<DemoPanel>(() => resolveInitialDemoState().panel);
  const [settingsSection, setSettingsSection] = useState<SettingsSection | undefined>(
    () => resolveInitialDemoState().settingsSection,
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const nav = buildNav(locale);
  const mobileTabs = buildMobileTabs(locale);
  const title = getPanelTitle(panel, s);

  useEffect(() => {
    const applyDeepLink = (scroll: boolean) => {
      const target = parseDemoDeepLink(window.location.hash);
      if (!target) return;
      setPanel(target.panel);
      setSettingsSection(target.settingsSection);
      setDrawerOpen(false);
      if (scroll) scrollToDemoSection();
    };

    applyDeepLink(false);
    const onHashChange = () => applyDeepLink(true);
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const go = (id: DemoPanel) => {
    setPanel(id);
    setDrawerOpen(false);
  };

  const renderNav = (onNavigate?: () => void) => (
    <nav className="h-full overflow-y-auto px-3 py-4 space-y-4">
      {nav.map((section) => (
        <div key={section.label} className="space-y-0.5">
          <p className="text-[11px] text-ink-500 font-sans tracking-wider uppercase font-semibold px-3 mb-1">
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
                    ? "bg-gold-50 text-gold-700 font-semibold border-l-2 border-gold-600 pl-2.5"
                    : "text-ink-600 hover:bg-ink-50 hover:text-ink-950"
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="min-w-0 leading-snug">{item.label}</span>
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );

  return (
    <div className="crm-demo relative flex flex-col md:flex-row bg-ink-50 text-ink-800 antialiased font-sans h-[min(780px,88vh)] min-h-[560px] overflow-hidden rounded-xl border border-ink-200 shadow-xl">
      <aside className="hidden md:flex flex-col w-64 shrink-0 bg-white text-ink-700 border-r border-ink-200 shadow-xs">
        <button
          type="button"
          onClick={() => go("dashboard")}
          className="px-5 py-4.5 border-b border-ink-100 flex items-center gap-3.5 text-left cursor-pointer hover:bg-ink-50 transition-colors"
        >
          <TdbLogo />
          <div className="min-w-0">
            <h1 className="text-base font-semibold tracking-tight text-ink-800 leading-tight">TangoDB</h1>
            <p className="text-[11px] font-sans tracking-widest text-ink-400 uppercase mt-0.5">STUDIO CONTROLLER</p>
          </div>
        </button>
        <div className="flex-1 min-h-0">{renderNav()}</div>
        <div className="p-4 border-t border-ink-100 text-center text-[10px] text-ink-500 font-sans">
          © TangoDB Studio Controller
        </div>
      </aside>

      <main className="relative flex-1 flex flex-col min-w-0 min-h-0 pb-14 md:pb-0">
        <header className="sticky top-0 bg-white border-b border-ink-200 px-4 sm:px-6 py-3 flex items-center justify-between z-20 shadow-xs">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="md:hidden p-1.5 text-ink-600 hover:text-ink-900 hover:bg-ink-50 rounded-lg cursor-pointer transition-all"
              aria-label="Menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h2 className="text-base font-semibold text-ink-800 tracking-tight leading-tight truncate">{title}</h2>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled
              className="hidden sm:flex items-center gap-1.5 text-xs font-semibold text-ink-500 px-3 py-1.5 rounded-lg border border-ink-200 cursor-not-allowed opacity-60"
            >
              <LogOut className="w-3.5 h-3.5" />
              {s.nav.signOut}
            </button>
          </div>
        </header>

        <section className="flex-1 p-4 sm:p-5 md:p-6 xl:p-8 max-w-7xl w-full mx-auto panel-page-stack overflow-y-auto">
          <div key={panel}>{renderPanelContent(panel, locale, go, settingsSection)}</div>
        </section>

        <div className="md:hidden absolute bottom-0 left-0 right-0 h-14 bg-white border-t border-ink-200 z-40 flex justify-around items-center px-0.5 shadow-md">
          {mobileTabs.map((item) => {
            const active = isMobileTabActive(panel, item.id);
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => go(item.id)}
                className={`flex flex-col items-center justify-center gap-0.5 px-0.5 py-0 min-w-0 flex-1 cursor-pointer transition-colors ${
                  active ? "text-gold-700" : "text-ink-400"
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="text-[10px] font-semibold uppercase tracking-wide leading-none text-center">
                  {item.line1}
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-wide leading-none text-center">
                  {item.line2}
                </span>
              </button>
            );
          })}
        </div>
      </main>

      {drawerOpen && (
        <div className="absolute inset-0 z-50 flex md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-ink-950/40 backdrop-blur-xs"
            onClick={() => setDrawerOpen(false)}
            aria-label="Close"
          />
          <div className="relative flex flex-col w-72 max-w-[85vw] bg-white text-ink-700 h-full border-r border-ink-200 shadow-xl">
            <div className="flex justify-between items-start px-5 py-4 border-b border-ink-100">
              <div className="flex items-start gap-3 min-w-0">
                <TdbLogo size="sm" />
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold tracking-tight text-ink-800 leading-tight">TangoDB</h3>
                  <p className="text-[11px] font-sans tracking-widest text-ink-400 uppercase mt-0.5">STUDIO CONTROLLER</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="p-1.5 text-ink-400 hover:text-ink-600 rounded-lg bg-ink-50 cursor-pointer"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">{renderNav(() => setDrawerOpen(false))}</div>
            <div className="p-3 border-t border-ink-100">
              <button
                type="button"
                disabled
                className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-xs font-semibold text-garnet-600 opacity-60 cursor-not-allowed"
              >
                <LogOut className="w-3.5 h-3.5" /> {s.nav.signOut}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
