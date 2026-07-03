import { Calendar, CalendarCheck, LayoutDashboard, Menu, Ticket } from "lucide-react";
import type { Locale } from "../i18n";
import { DashboardPanel } from "../crm/panels/DashboardPanel";
import { crmStrings } from "../crm/strings";

type Props = {
  locale: Locale;
  alt: string;
};

const PREVIEW_WIDTH = 390;

/** Static mobile CRM frame for the platform section — uses the real dashboard panel. */
export function CrmMobilePreview({ locale, alt }: Props) {
  const s = crmStrings(locale);
  const mobileTabs = [
    {
      icon: LayoutDashboard,
      line1: s.nav.mobileDashboardLine1,
      line2: s.nav.mobileDashboardLine2,
      active: true,
    },
    {
      icon: Ticket,
      line1: s.nav.mobileSubscriptionsLine1,
      line2: s.nav.mobileSubscriptionsLine2,
      active: false,
    },
    {
      icon: CalendarCheck,
      line1: s.nav.mobileAttendanceLine1,
      line2: s.nav.mobileAttendanceLine2,
      active: false,
    },
    {
      icon: Calendar,
      line1: s.nav.mobileScheduleLine1,
      line2: s.nav.mobileScheduleLine2,
      active: false,
    },
  ];

  return (
    <figure className="mx-auto w-full max-w-[240px]">
      <div className="rounded-[2rem] border-[3px] border-slate-800 bg-slate-800 p-1.5 shadow-xl shadow-slate-300/50">
        <div className="relative overflow-hidden rounded-[1.6rem] bg-slate-50">
          <div className="flex justify-center pt-2" aria-hidden="true">
            <span className="h-1 w-10 rounded-full bg-slate-300" />
          </div>

          <div className="relative h-[420px] overflow-hidden">
            <div
              className="pointer-events-none absolute left-1/2 top-0 origin-top -translate-x-1/2 select-none scale-[0.58]"
              style={{ width: PREVIEW_WIDTH }}
              aria-hidden="true"
            >
              <div className="flex h-[720px] flex-col overflow-hidden bg-slate-50 text-slate-800">
                <header className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 shadow-xs">
                  <Menu className="h-5 w-5 shrink-0 text-slate-600" />
                  <h3 className="truncate text-base font-semibold text-slate-800">{s.panel.dashboard}</h3>
                </header>

                <section className="flex-1 overflow-hidden p-4">
                  <DashboardPanel locale={locale} onNavigate={() => {}} />
                </section>

                <div className="flex h-14 shrink-0 items-center justify-around border-t border-slate-200 bg-white px-0.5 shadow-md">
                  {mobileTabs.map(({ icon: Icon, line1, line2, active }) => (
                    <div
                      key={`${line1}-${line2}`}
                      className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-0.5 py-0 ${
                        active ? "text-indigo-600" : "text-slate-400"
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="text-center text-[8px] font-semibold uppercase leading-none tracking-wide">
                        {line1}
                      </span>
                      <span className="text-center text-[8px] font-semibold uppercase leading-none tracking-wide">
                        {line2}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <figcaption className="sr-only">{alt}</figcaption>
    </figure>
  );
}
