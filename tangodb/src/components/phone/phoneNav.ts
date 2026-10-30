import type { LucideIcon } from "lucide-react";
import {
  Calendar,
  CalendarCheck,
  Landmark,
  LayoutDashboard,
  MoreHorizontal,
  Ticket,
} from "lucide-react";
import type { MemberRole, OrgModules } from "../../types/organization";
import type { NavItem } from "../../lib/i18n/navHelpers";
import {
  canAccessFinanceNav,
  canAccessPanel,
  canAccessSettingsSection,
  panelIdFromPath,
  type PermissionOptions,
} from "../../lib/permissions";
import { capabilityForPanel, capabilityForSettingsSection, type EditionCapability } from "../../lib/orgEdition";
import type { I18nKey } from "../../lib/i18n/keys";

export type PhoneBottomTab = {
  id: string;
  icon: LucideIcon;
  labelKey: I18nKey;
  path: string;
  subTab?: "active" | "sell";
  personalSubTab?: "view" | "sell";
  moduleKey?: keyof OrgModules;
  settingsSection?: NavItem["settingsSection"];
};

type TranslateFn = (key: I18nKey) => string;

const PRIMARY_ORDER: Omit<PhoneBottomTab, "icon" | "labelKey">[] = [
  { id: "today", path: "/" },
  { id: "attendance", path: "/attendance" },
  { id: "schedule", path: "/schedule" },
  { id: "finance", path: "/finance", moduleKey: "finance_basic" },
  { id: "subscriptions", path: "/subscriptions", subTab: "active", moduleKey: "group_subscriptions" },
];

const TAB_META: Record<string, Pick<PhoneBottomTab, "icon" | "labelKey">> = {
  today: { icon: LayoutDashboard, labelKey: "phone.tab.today" },
  attendance: { icon: CalendarCheck, labelKey: "phone.tab.attendance" },
  schedule: { icon: Calendar, labelKey: "phone.tab.schedule" },
  finance: { icon: Landmark, labelKey: "phone.tab.finance" },
  subscriptions: { icon: Ticket, labelKey: "phone.tab.subscriptions" },
  more: { icon: MoreHorizontal, labelKey: "phone.tab.more" },
};

function isNavItemVisible(
  item: NavItem,
  ctx: {
    role: MemberRole;
    orgModules: OrgModules;
    permissionOptions: PermissionOptions;
    editionAllows: (capability: EditionCapability) => boolean;
    claimsMismatch: boolean;
  }
): boolean {
  const { role, orgModules, permissionOptions, editionAllows, claimsMismatch } = ctx;
  if (item.moduleKey && !orgModules[item.moduleKey]) return false;

  if (item.settingsSection) {
    const cap = capabilityForSettingsSection(item.settingsSection);
    if (cap && !editionAllows(cap)) return false;
    return canAccessSettingsSection(role, item.settingsSection, permissionOptions);
  }

  if (item.path === "/finance") {
    const cap = capabilityForPanel("finance");
    if (cap && !editionAllows(cap)) return false;
    return canAccessFinanceNav(role, orgModules, permissionOptions);
  }

  const cap = capabilityForPanel(panelIdFromPath(item.path));
  if (cap && !editionAllows(cap)) return false;
  if (claimsMismatch && (item.path === "/finance" || item.settingsSection)) return false;
  return canAccessPanel(role, panelIdFromPath(item.path), permissionOptions);
}

function buildPrimaryCandidates(ctx: Parameters<typeof isNavItemVisible>[1]): PhoneBottomTab[] {
  return PRIMARY_ORDER.flatMap((entry) => {
    const meta = TAB_META[entry.id];
    if (!meta) return [];

    const pseudoItem: NavItem = {
      icon: meta.icon,
      label: "",
      path: entry.path,
      subTab: entry.subTab,
      moduleKey: entry.moduleKey,
    };

    if (!isNavItemVisible(pseudoItem, ctx)) return [];

    return [
      {
        ...entry,
        ...meta,
      },
    ];
  });
}

export function buildPhoneNavModel(
  allNavItems: NavItem[],
  ctx: Parameters<typeof isNavItemVisible>[1]
): { bottomTabs: PhoneBottomTab[]; moreItems: NavItem[] } {
  const primary = buildPrimaryCandidates(ctx);
  const bottomPrimary = primary.slice(0, 4);
  const primaryPaths = new Set(bottomPrimary.map((tab) => tab.path));

  const moreItems = allNavItems.filter((item) => {
    if (!isNavItemVisible(item, ctx)) return false;
    if (item.path === "/" && primaryPaths.has("/")) return false;
    if (primaryPaths.has(item.path)) return false;
    return true;
  });

  const bottomTabs: PhoneBottomTab[] = [...bottomPrimary];
  if (moreItems.length > 0) {
    bottomTabs.push({
      id: "more",
      path: "__more__",
      icon: TAB_META.more.icon,
      labelKey: TAB_META.more.labelKey,
    });
  }

  return { bottomTabs, moreItems };
}

export function phoneTabLabel(tab: PhoneBottomTab, t: TranslateFn): string {
  return t(tab.labelKey);
}
