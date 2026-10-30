import PhoneClientsPanel from "./PhoneClientsPanel";
import PhoneSubscriptionsPanel from "./PhoneSubscriptionsPanel";
import PhonePersonalLessonsPanel from "./PhonePersonalLessonsPanel";
import PhoneRentersPanel from "./PhoneRentersPanel";
import PhoneFinancePanel from "./PhoneFinancePanel";
import PhoneSettingsPanel from "./PhoneSettingsPanel";
import PhonePricesPanel from "./PhonePricesPanel";
import PhoneTeamPanel from "./PhoneTeamPanel";
import PhoneModulePlaceholder from "./PhoneModulePlaceholder";

/** Maps workspace pathname to the phone shell panel (A2–A4). */
export function renderPhonePanel(pathname: string) {
  if (pathname === "/") return null;
  if (pathname === "/attendance" || pathname === "/schedule") return null;
  if (pathname.startsWith("/finance")) return <PhoneFinancePanel />;
  if (pathname.startsWith("/settings/team")) return <PhoneTeamPanel />;
  if (pathname.startsWith("/settings")) return <PhoneSettingsPanel />;
  if (pathname.startsWith("/prices")) return <PhonePricesPanel />;
  if (pathname === "/clients") return <PhoneClientsPanel />;
  if (pathname.startsWith("/subscriptions")) return <PhoneSubscriptionsPanel />;
  if (pathname.startsWith("/personal")) return <PhonePersonalLessonsPanel />;
  if (pathname.startsWith("/renters")) return <PhoneRentersPanel />;
  return <PhoneModulePlaceholder pathname={pathname} />;
}
