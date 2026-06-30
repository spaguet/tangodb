import { BadgePlus, ChevronLeft, ChevronRight, FolderClosed, Search, Sparkles, Ticket } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Locale } from "../../i18n";
import { formatEuro, personalLessons, personalSellForm, type DemoPersonalLesson } from "../data";
import PageTabs, { pageTabPanelCls } from "../PageTabs";
import { crmStrings } from "../strings";
import { panelStrings } from "../panelStrings";
import { fieldCls, labelCls } from "../styles";

type Props = { locale: Locale; initialTab?: "view" | "sell" };

function PaymentBadge({ lesson, locale }: { lesson: DemoPersonalLesson; locale: Locale }) {
  if (lesson.paid === "yes") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
        {locale === "ru" ? "Оплачен" : "Paid"}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
      {locale === "ru" ? "Долг" : "Unpaid"}
    </span>
  );
}

function AttendanceBadge({ lesson, locale }: { lesson: DemoPersonalLesson; locale: Locale }) {
  if (!lesson.attendance) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-50 text-slate-500 border border-slate-200">
        {locale === "ru" ? "Не отмечено" : "Not marked"}
      </span>
    );
  }
  if (lesson.attendance === "present") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
        {locale === "ru" ? "Пришёл" : "Present"}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
      {locale === "ru" ? "Не пришёл" : "Absent"}
    </span>
  );
}

export function PersonalLessonsPanel({ locale, initialTab = "view" }: Props) {
  const s = crmStrings(locale);
  const ps = panelStrings(locale);
  const [tab, setTab] = useState(initialTab);
  useEffect(() => setTab(initialTab), [initialTab]);

  const tabs = [
    { id: "view", label: s.personal.list, icon: FolderClosed },
    { id: "sell", label: s.personal.sell, icon: BadgePlus },
  ];

  const formatDate = (iso: string) => {
    const d = new Date(iso + "T12:00:00");
    return d.toLocaleDateString(locale === "ru" ? "ru-RU" : "en-GB", {
      day: "numeric",
      month: "long",
    });
  };

  const groupedByDate = useMemo(() => {
    const groups = new Map<string, DemoPersonalLesson[]>();
    for (const lesson of personalLessons) {
      const bucket = groups.get(lesson.date) ?? [];
      bucket.push(lesson);
      groups.set(lesson.date, bucket);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, lessons]) => [date, lessons.sort((a, b) => b.timeStart.localeCompare(a.timeStart))] as const);
  }, []);

  const todayISO = "2026-06-30";

  return (
    <div id="panel-personal" className="panel-page-stack">
      <div className="flex items-center gap-2">
        <Sparkles className="w-5 h-5 text-indigo-500 shrink-0" />
        <h2 className="text-base font-semibold text-slate-800 tracking-tight">{s.personal.title}</h2>
      </div>

      <PageTabs tabs={tabs} activeTab={tab} onChange={setTab} />

      {tab === "view" ? (
        <div
          className={`bg-white p-4 border border-slate-200 shadow-xs panel-card-stack demo-field-disabled ${pageTabPanelCls("view", "view")}`}
        >
          <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-xs panel-card-stack">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <div className="flex flex-wrap bg-slate-100 rounded-lg p-1 text-xs font-semibold gap-1">
                {[s.personal.periodWeek, s.personal.periodMonth, s.personal.periodRange].map((label, i) => (
                  <button
                    key={label}
                    type="button"
                    disabled
                    className={`px-3 py-1.5 rounded-md ${i === 0 ? "bg-white text-slate-900 shadow-xs" : "text-slate-500"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1">
                <button type="button" disabled className="p-1.5 rounded-lg text-slate-400">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-sm font-semibold text-slate-800 min-w-[140px] text-center">
                  {locale === "ru" ? "23–29 июня 2026" : "Jun 23–29, 2026"}
                </span>
                <button type="button" disabled className="p-1.5 rounded-lg text-slate-400">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
              <div className="flex flex-wrap bg-slate-100 rounded-lg p-1 text-xs font-semibold gap-1 ml-auto">
                {[s.personal.filterAll, s.personal.paid, s.personal.unpaid].map((label, i) => (
                  <button
                    key={label}
                    type="button"
                    disabled
                    className={`px-3 py-1.5 rounded-md ${i === 0 ? "bg-white text-slate-900 shadow-xs" : "text-slate-500"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <label className="block space-y-1">
                <span className={labelCls}>{ps.location}</span>
                <div className={fieldCls + " bg-slate-50 text-slate-600"}>{s.personal.allLocations}</div>
              </label>
              <label className="block space-y-1">
                <span className={labelCls}>{ps.discipline}</span>
                <div className={fieldCls + " bg-slate-50 text-slate-600"}>{s.personal.allDisciplines}</div>
              </label>
              <label className="block space-y-1">
                <span className={labelCls}>{ps.teacher}</span>
                <div className={fieldCls + " bg-slate-50 text-slate-600"}>{s.personal.allTeachers}</div>
              </label>
              <div className="relative">
                <label className={labelCls}>{s.personal.searchClient}</label>
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-[calc(50%+6px)] -translate-y-1/2" />
                <input
                  disabled
                  placeholder={s.personal.searchByName}
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-500"
                />
              </div>
            </div>
          </div>

          <div className="panel-card-stack">
            {groupedByDate.map(([date, dateLessons]) => {
              const isCurrentOrFuture = date >= todayISO;
              return (
                <div
                  key={date}
                  className={`bg-white rounded-xl shadow-xs overflow-hidden ${
                    isCurrentOrFuture ? "border-2 border-sky-200" : "border border-slate-200"
                  }`}
                >
                  <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50/60 flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-800">{formatDate(date)}</span>
                    <span className="text-xs text-slate-400">·</span>
                    <span className="text-xs font-semibold text-indigo-700">
                      {dateLessons.length} {locale === "ru" ? "уроков" : "lessons"}
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[960px] text-left">
                      <thead>
                        <tr className="border-b border-slate-100 text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                          <th className="py-2 px-3">{s.personal.colTime}</th>
                          <th className="py-2 px-3">{ps.location}</th>
                          <th className="py-2 px-3">{ps.discipline}</th>
                          <th className="py-2 px-3">{ps.teacher}</th>
                          <th className="py-2 px-3">{s.personal.colClients}</th>
                          <th className="py-2 px-3">{s.personal.colFormat}</th>
                          <th className="py-2 px-3">{s.personal.colStatus}</th>
                          <th className="py-2 px-3">{s.personal.colAmount}</th>
                          <th className="py-2 px-3">{s.personal.colAttendance}</th>
                          <th className="py-2 px-3">{s.personal.colActions}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dateLessons.map((lesson) => (
                          <tr key={lesson.id} className="border-b border-slate-50 text-xs text-slate-700">
                            <td className="py-2.5 px-3 font-semibold tabular-nums">
                              {lesson.timeStart}–{lesson.timeEnd}
                            </td>
                            <td className="py-2.5 px-3">{lesson.location}</td>
                            <td className="py-2.5 px-3">{lesson.discipline}</td>
                            <td className="py-2.5 px-3">{lesson.teacher}</td>
                            <td className="py-2.5 px-3 font-semibold text-slate-800">{lesson.clientDisplay}</td>
                            <td className="py-2.5 px-3 capitalize">{lesson.type}</td>
                            <td className="py-2.5 px-3">
                              <PaymentBadge lesson={lesson} locale={locale} />
                            </td>
                            <td className="py-2.5 px-3 font-semibold text-slate-800">{formatEuro(lesson.price)}</td>
                            <td className="py-2.5 px-3">
                              <AttendanceBadge lesson={lesson} locale={locale} />
                            </td>
                            <td className="py-2.5 px-3 text-slate-400">—</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div
          className={`bg-white p-4 border border-slate-200 shadow-xs panel-card-stack panel-sell-under-tabs demo-field-disabled ${pageTabPanelCls("sell", "view")}`}
        >
          <div className="panel-form-header panel-form-header-wide-md mb-4">
            <div className="panel-form-header-icon">
              <Ticket className="w-5 h-5 text-indigo-600" />
            </div>
            <div className="panel-form-header-text">
              <h2 className="text-base font-semibold tracking-tight text-slate-900">{ps.personalSellTitle}</h2>
              <p className="text-slate-400 text-[11px] leading-snug">{ps.personalSellSubtitle}</p>
            </div>
          </div>
          <div className="panel-form-stack md:grid md:grid-cols-2 md:gap-x-4 md:gap-y-3 max-w-3xl">
            {(
              [
                [ps.client, personalSellForm.client],
                [ps.teacher, personalSellForm.teacher],
                [ps.location, personalSellForm.location],
                [ps.discipline, personalSellForm.discipline],
                [ps.date, personalSellForm.date],
                [ps.time, `${personalSellForm.timeStart} – ${personalSellForm.timeEnd}`],
                [ps.tariff, personalSellForm.tariff],
                [ps.payment, `${personalSellForm.payment} · ${formatEuro(personalSellForm.price)}`],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="field-stack">
                <label className={labelCls}>{label}</label>
                <div className={fieldCls + " bg-slate-50"}>{value}</div>
              </div>
            ))}
          </div>
          <button
            type="button"
            disabled
            className="mt-4 w-full max-w-md py-3 bg-indigo-600/50 text-white text-xs font-semibold uppercase tracking-wider rounded-lg cursor-not-allowed"
          >
            {ps.saveLesson}
          </button>
          <p className="text-center text-[10px] text-slate-400 mt-2">{s.subs.demoHint}</p>
        </div>
      )}
    </div>
  );
}
