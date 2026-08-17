import { Calendar, Landmark, LayoutDashboard, Users } from "lucide-react";
import type { Locale } from "../i18n";
import { STUDIO_NAME } from "../crm/data";
import { DashboardPanel } from "../crm/panels/DashboardPanel";
import { crmStrings } from "../crm/strings";
import { TdbLogo } from "./TdbLogo";

type Props = {
  locale: Locale;
  alt: string;
};

const PREVIEW_WIDTH = 960;

/** Static desktop CRM frame for the platform section — uses the real dashboard panel. */
export function CrmDesktopPreview({ locale, alt }: Props) {
  const s = crmStrings(locale);
  const navItems = [
    { icon: LayoutDashboard, label: s.nav.dashboard, active: true },
    { icon: Landmark, label: s.nav.financeItem, active: false },
    { icon: Calendar, label: s.nav.schedule, active: false },
    { icon: Users, label: s.nav.clientsItem, active: false },
  ];

  return (
    <figure className="overflow-hidden rounded-xl border border-ink-200 bg-white shadow-lg shadow-ink-200/10">
      <div className="flex items-center gap-2 border-b border-ink-100 bg-ink-50 px-3 py-2">
        <div className="flex gap-1.5" aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full bg-garnet-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-200" />
          <span className="h-2.5 w-2.5 rounded-full bg-sage-300" />
        </div>
        <span className="mx-auto truncate text-[10px] text-ink-500">tangodb.app · {STUDIO_NAME}</span>
      </div>

      <div className="relative h-[220px] overflow-hidden bg-ink-50 sm:h-[260px] lg:h-[300px]">
        <div
          className="pointer-events-none absolute left-1/2 top-0 origin-top -translate-x-1/2 select-none scale-[0.36] sm:scale-[0.42] lg:scale-[0.48]"
          style={{ width: PREVIEW_WIDTH }}
          aria-hidden="true"
        >
          <div className="flex h-[540px] overflow-hidden border border-ink-200 bg-ink-50">
            <aside className="flex w-52 shrink-0 flex-col border-r border-ink-200 bg-white">
              <div className="flex items-center gap-3 border-b border-ink-100 px-4 py-3">
                <TdbLogo size="sm" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink-800">TangoDB</p>
                  <p className="text-[9px] uppercase tracking-wider text-ink-400">Studio Controller</p>
                </div>
              </div>
              <nav className="flex-1 space-y-0.5 px-2 py-3">
                {navItems.map(({ icon: Icon, label, active }) => (
                  <div
                    key={label}
                    className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-xs font-semibold ${
                      active
                        ? "border-l-2 border-gold-600 bg-gold-50 pl-2 text-gold-700"
                        : "text-ink-600"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{label}</span>
                  </div>
                ))}
              </nav>
            </aside>

            <main className="flex min-w-0 flex-1 flex-col">
              <header className="flex shrink-0 items-center justify-between border-b border-ink-200 bg-white px-4 py-2.5">
                <h3 className="truncate text-sm font-semibold text-ink-800">{s.panel.dashboard}</h3>
              </header>
              <section className="flex-1 overflow-hidden p-3">
                <DashboardPanel locale={locale} onNavigate={() => {}} />
              </section>
            </main>
          </div>
        </div>
      </div>

      <figcaption className="sr-only">{alt}</figcaption>
    </figure>
  );
}
