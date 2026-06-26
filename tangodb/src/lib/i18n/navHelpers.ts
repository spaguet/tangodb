import type { LucideIcon } from "lucide-react";
import {
  Users,
  Ticket,
  TicketPlus,
  Calendar,
  CalendarCheck,
  Coins,
  LayoutDashboard,
  Landmark,
  Settings,
  Sparkles,
} from "lucide-react";
import type { OrgModules } from "../../types/organization";
import type { I18nKey } from "./keys";

type TranslateFn = (key: I18nKey) => string;

export interface NavItem {
  icon: LucideIcon;
  label: string;
  path: string;
  subTab?: "active" | "sell";
  personalSubTab?: "view" | "sell";
}

export interface NavSection {
  label: string;
  items: NavItem[];
  moduleKey?: keyof OrgModules;
}

export interface MobileTabItem {
  icon: LucideIcon;
  line1: string;
  line2: string;
  path: string;
  subTab?: "active" | "sell";
  moduleKey?: keyof OrgModules;
}

export function getNavSections(t: TranslateFn): NavSection[] {
  return [
    {
      label: t("nav.section.analytics"),
      items: [{ icon: LayoutDashboard, label: t("nav.item.dashboard"), path: "/" }],
    },
    {
      label: t("nav.section.finance"),
      moduleKey: "finance_basic",
      items: [{ icon: Landmark, label: t("nav.item.finance"), path: "/finance" }],
    },
    {
      label: t("nav.section.clients"),
      items: [{ icon: Users, label: t("nav.item.clients"), path: "/clients" }],
    },
    {
      label: t("nav.section.groupSubscriptions"),
      moduleKey: "group_subscriptions",
      items: [
        { icon: Ticket, label: t("nav.item.subscriptions"), path: "/subscriptions", subTab: "active" },
        { icon: TicketPlus, label: t("nav.item.subscriptionsSell"), path: "/subscriptions/sell", subTab: "sell" },
      ],
    },
    {
      label: t("nav.section.scheduleJournal"),
      items: [
        { icon: Calendar, label: t("nav.item.schedule"), path: "/schedule" },
        { icon: CalendarCheck, label: t("nav.item.attendance"), path: "/attendance" },
      ],
    },
    {
      label: t("nav.section.personalLessons"),
      moduleKey: "personal_lessons",
      items: [
        { icon: Sparkles, label: t("nav.item.personalLessons"), path: "/personal", personalSubTab: "view" },
        { icon: TicketPlus, label: t("nav.item.personalSell"), path: "/personal/sell", personalSubTab: "sell" },
      ],
    },
    {
      label: t("nav.section.prices"),
      items: [{ icon: Coins, label: t("nav.item.prices"), path: "/prices" }],
    },
    {
      label: t("nav.section.settings"),
      items: [{ icon: Settings, label: t("nav.item.settings"), path: "/settings" }],
    },
  ];
}

export function getMobileTabs(t: TranslateFn): MobileTabItem[] {
  return [
    { icon: LayoutDashboard, line1: t("nav.mobile.dashboardLine1"), line2: t("nav.mobile.dashboardLine2"), path: "/" },
    {
      icon: Ticket,
      line1: t("nav.mobile.subscriptionsLine1"),
      line2: t("nav.mobile.subscriptionsLine2"),
      path: "/subscriptions",
      subTab: "active",
      moduleKey: "group_subscriptions",
    },
    {
      icon: CalendarCheck,
      line1: t("nav.mobile.attendanceLine1"),
      line2: t("nav.mobile.attendanceLine2"),
      path: "/attendance",
    },
    {
      icon: Calendar,
      line1: t("nav.mobile.scheduleLine1"),
      line2: t("nav.mobile.scheduleLine2"),
      path: "/schedule",
    },
  ];
}

export function getPanelTitle(pathname: string, subscriptionsTab: string, t: TranslateFn): string {
  if (pathname === "/") return t("nav.panel.dashboard");
  if (pathname.startsWith("/finance")) return t("nav.panel.finance");
  if (pathname === "/clients") return t("nav.panel.clients");
  if (pathname.startsWith("/subscriptions")) {
    if (subscriptionsTab === "sell") return t("nav.panel.subscriptionsSell");
    if (subscriptionsTab === "history") return t("nav.panel.subscriptionsHistory");
    return t("nav.panel.subscriptionsActive");
  }
  if (pathname === "/schedule") return t("nav.panel.schedule");
  if (pathname === "/personal/sell") return t("nav.panel.personalSell");
  if (pathname.startsWith("/personal")) return t("nav.panel.personalLessons");
  if (pathname === "/attendance") return t("nav.panel.attendance");
  if (pathname === "/prices") return t("nav.panel.prices");
  if (pathname.startsWith("/settings/general")) return t("nav.panel.settingsGeneral");
  if (pathname.startsWith("/settings/organization")) return t("nav.panel.settingsOrganization");
  if (pathname.startsWith("/settings/subscriptions")) return t("nav.panel.settingsSubscriptions");
  if (pathname.startsWith("/settings/disciplines")) return t("nav.panel.settingsDisciplines");
  if (pathname.startsWith("/settings/locations")) return t("nav.panel.settingsLocations");
  if (pathname.startsWith("/settings/data")) return t("nav.panel.settingsData");
  if (pathname.startsWith("/settings/team")) return t("nav.panel.settingsTeam");
  if (pathname.startsWith("/settings/license")) return t("nav.panel.settingsLicense");
  if (pathname.startsWith("/settings")) return t("nav.panel.settings");
  return "TangoDB";
}

export function getSettingsNav(t: TranslateFn): { id: string; label: string; path: string }[] {
  return [
    { id: "general", label: t("settings.section.general"), path: "/settings/general" },
    { id: "organization", label: t("settings.section.organization"), path: "/settings/organization" },
    { id: "subscriptions", label: t("settings.section.subscriptions"), path: "/settings/subscriptions" },
    { id: "disciplines", label: t("settings.section.disciplines"), path: "/settings/disciplines" },
    { id: "locations", label: t("settings.section.locations"), path: "/settings/locations" },
    { id: "data", label: t("settings.section.data"), path: "/settings/data" },
    { id: "team", label: t("settings.section.team"), path: "/settings/team" },
    { id: "license", label: t("settings.section.license"), path: "/settings/license" },
  ];
}

export function getFinanceNav(t: TranslateFn): { label: string; path: string }[] {
  return [
    { label: t("finance.nav.payments"), path: "/finance/payments" },
    { label: t("finance.nav.revenue"), path: "/finance/revenue" },
    { label: t("finance.nav.debtors"), path: "/finance/debtors" },
    { label: t("finance.nav.payroll"), path: "/finance/payroll" },
  ];
}

export function getDashboardTabs(t: TranslateFn) {
  return [
    { id: "operational" as const, label: t("dashboard.tab.operational") },
    { id: "financial" as const, label: t("dashboard.tab.financial") },
  ];
}

export function getLocaleOptions(t: TranslateFn) {
  return [
    { value: "ru-RU", label: t("common.locale.ru") },
    { value: "en-US", label: t("common.locale.en") },
    { value: "vi-VN", label: t("common.locale.vi") },
  ];
}

export function getWeekStartOptions(t: TranslateFn) {
  return [
    { value: "1", label: t("settings.general.weekStart.monday") },
    { value: "7", label: t("settings.general.weekStart.sunday") },
  ];
}

export function getTeamRolePresets(t: TranslateFn) {
  return [
    { value: "admin" as const, label: t("team.role.admin") },
    { value: "reception" as const, label: t("team.role.reception") },
    { value: "teacher" as const, label: t("team.role.teacher") },
    { value: "accountant" as const, label: t("team.role.accountant") },
  ];
}
